import { Prisma, type UserRole } from '@prisma/client';
import prisma from '../lib/prisma';
import AppError from '../errors/AppError';
import { sendSetupLink } from './mail.service';
import { isManagerOfEmployee, isSelf, resolveUserId, type Caller } from './scope.service';
import type { CreateUserInput, ListUsersQuery } from '../schemas/user.schema';
import { generateToken, hashToken } from '../lib/token'; 

// Roles each caller may assign (contract, section 2); admin is never assignable
const CREATABLE_ROLES: Record<UserRole, UserRole[]> = {
  admin: ['employee', 'manager'],
  manager: ['employee'],
  employee: [],
};

// The link is single-use (used_at, see /auth/password/reset) and expires after 72 hours
const SETUP_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

// Read at call time; a missing or invalid value must fail before anything is written
const getFrontendUrl = () => {
  const value = process.env.FRONTEND_URL;
  if (!value || !URL.canParse(value)) {
    throw new Error('FRONTEND_URL must be set to a valid URL');
  }
  return value.replace(/\/+$/, '');
};

const forbidden = () => new AppError(403, 'FORBIDDEN', 'Droits insuffisants pour cette action');

// P2002 on the email column (tokenHash is unique too)
const isEmailTaken = (err: unknown) => {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const target = err.meta?.target;
  const fields = Array.isArray(target) ? target : [target];
  return fields.some(field => String(field).includes('email'));
};

export const userSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phoneNumber: true,
  role: true,
  createdAt: true,
  updatedAt: true,
  memberships: { select: { team: { select: { id: true, name: true } } } },
} satisfies Prisma.UserSelect;

type UserRecord = Prisma.UserGetPayload<{ select: typeof userSelect }>;

// Full profile (contract, section 4)
export const toFullUser = ({ memberships, ...user }: UserRecord) => ({
  ...user,
  teams: memberships.map(membership => membership.team),
});

// Reduced profile, for users outside the manager's teams
export const toReducedUser = ({ id, firstName, lastName, role }: UserRecord) => ({
  id,
  firstName,
  lastName,
  role,
});

export async function createUser(actor: Caller, input: CreateUserInput) {
  if (!CREATABLE_ROLES[actor.role].includes(input.role)) {
    throw new AppError(403, 'FORBIDDEN', `Vous ne pouvez pas créer un utilisateur de rôle ${input.role}`);
  }

  const frontendUrl = getFrontendUrl();

  // The raw token is only sent in the link; the database keeps its SHA-256 hash
  const token = generateToken(); 
  const tokenHash = hashToken(token); 

  let user: UserRecord;
  try {
    // Nested write: the user and the token are created in the same transaction
    user = await prisma.user.create({
      data: {
        ...input,
        passwordResetTokens: {
          create: { tokenHash, expiresAt: new Date(Date.now() + SETUP_TOKEN_TTL_MS) },
        },
      },
      select: userSelect,
    });
  } catch (err) {
    if (isEmailTaken(err)) {
      throw new AppError(409, 'CONFLICT', 'Un utilisateur avec cet email existe déjà');
    }
    throw err;
  }

  // The user exists now: a mail failure must not turn into a 500 (a retry would hit a 409).
  // The user can still get a new link through "forgot password"
  try {
    await sendSetupLink(user.email, `${frontendUrl}/reset-password?token=${token}`);
  } catch (err) {
    // Never log the link: it carries the token
    console.error(`[mail] Setup link not sent to user ${user.id}`, err);
  }

  // A new user belongs to no team yet, so a manager only gets the reduced profile
  return actor.role === 'admin' ? toFullUser(user) : toReducedUser(user);
}

//GET /users filters
function userListWhere({ search, role, teamId }: ListUsersQuery): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = { deletedAt: null }; 

  if (role) {
    where.role = role; 
  }

  if (teamId) {
    where.memberships = { some: { teamId }}; 
  }

  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: 'insensitive' } }, 
      { lastName: { contains: search, mode: 'insensitive' } }, 
      { email: { contains: search, mode: 'insensitive' } },
    ]; 
  }

  return where; 
}

//Teams managerd by the Caller
async function managedTeamIds(actor: Caller): Promise<Set<string>> {
  if (actor.role !== 'manager') return new Set(); 
  const teams = await prisma.team.findMany({ where: { managerId: actor.id }, select: { id: true } }); 
  return new Set(teams.map(team => team.id)); 
}

//GET /users 
export async function listUsers(actor: Caller, query: ListUsersQuery) {
  const { page, limit } = query; 
  const where = userListWhere(query); 
  const skip = (page - 1) * limit; 

  const [rows, total, teamIds] = await Promise.all([
    prisma.user.findMany({
      where, 
      select: userSelect, 
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], 
      skip, 
      take: limit,
    }),
    prisma.user.count({ where }), 
    managedTeamIds(actor),
  ]); 

  //full profile for the admin only
  const isInScope = (user: UserRecord) => 
    actor.role === 'admin' ||
    isSelf(actor, user.id) ||
    user.memberships.some(memberShip => teamIds.has(memberShip.team.id)); 

    return {
      data: rows.map(user => (isInScope(user) ? toFullUser(user) : toReducedUser(user))), 
      meta: { page, limit, total }
    }
}

// GET /users/:id: the full profile for self, a manager of the user and the admin
// the reduced one for any other manager (contract, section 4)
export async function getUser(actor: Caller, id: string) {
  const userId = resolveUserId(actor, id);
  const self = isSelf(actor, userId); 

  // An employee only reads their own account. Refused before the lookup, so 
  // the answer is the same wether the user exists or not.
  if (!self && actor.role === 'employee') throw forbidden();

  // Anonymized accounts no longer exist for the API (contract, section 4)
  const user = await prisma.user.findUnique({ where: { 
    id: userId, 
    deletedAt: null 
  }, select: userSelect });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'Utilisateur introuvable');

  // isManagerOfEmployee is also true for the admin
  const fullProfile = self || (await isManagerOfEmployee(actor, userId));
  return fullProfile ? toFullUser(user) : toReducedUser(user);
}
