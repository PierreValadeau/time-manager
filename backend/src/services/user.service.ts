import crypto from 'node:crypto';
import { Prisma, type UserRole } from '@prisma/client';
import prisma from '../lib/prisma';
import AppError from '../errors/AppError';
import { sendSetupLink } from './mail.service';
import type { CreateUserInput } from '../schemas/user.schema';

export type Actor = { id: string; role: UserRole };

// Roles each caller may assign (contract, section 2); admin is never assignable
const CREATABLE_ROLES: Record<UserRole, UserRole[]> = {
  admin: ['employee', 'manager'],
  manager: ['employee'],
  employee: [],
};

// The link is single-use (used_at, see /auth/password/reset) and expires after 72 hours
const SETUP_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

const userSelect = {
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

export async function createUser(actor: Actor, input: CreateUserInput) {
  if (!CREATABLE_ROLES[actor.role].includes(input.role)) {
    throw new AppError(403, 'FORBIDDEN', `Vous ne pouvez pas créer un utilisateur de rôle ${input.role}`);
  }

  // The raw token is only sent in the link; the database keeps its SHA-256 hash
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

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
    // Unique constraint on the (lowercased) email
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'CONFLICT', 'Un utilisateur avec cet email existe déjà');
    }
    throw err;
  }

  await sendSetupLink(user.email, `${process.env.FRONTEND_URL}/reset-password?token=${token}`);

  // A new user belongs to no team yet, so a manager only gets the reduced profile
  return actor.role === 'admin' ? toFullUser(user) : toReducedUser(user);
}
