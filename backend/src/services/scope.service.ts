import prisma from '../lib/prisma';

// The authenticated caller, as set by the authenticate middleware
export type Caller = NonNullable<Express.Request['user']>;

// Scope helpers (contract, section 2): is the requested resource within the caller's scope?
// They answer true/false so rules can be combined, e.g. "self or manager of the employee".
// The route must check that the resource exists first: a missing resource is a 404, not a 403.

// "Soi": the caller acts on their own account
export const isSelf = (caller: Caller, userId: string) => caller.id === userId;

// Alias me (contract, section 1): the caller's own id
export const resolveUserId = (caller: Caller, id: string) => id === 'me' ? caller.id : id;

// "Manager de l'équipe": the designated manager of the team, or the admin
export async function isTeamManager(caller: Caller, teamId: string) {
  if (caller.role === 'admin') return true;
  // A demoted manager loses these rights even before their team is reassigned
  if (caller.role !== 'manager') return false;

  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { managerId: true } });
  return team?.managerId === caller.id;
}

// "Manager du salarié": manager of at least one team the user belongs to, or the admin
export async function isManagerOfEmployee(caller: Caller, userId: string) {
  if (caller.role === 'admin') return true;
  if (caller.role !== 'manager') return false;

  const membership = await prisma.teamMember.findFirst({
    where: { userId, team: { managerId: caller.id } },
    select: { teamId: true },
  });
  return membership !== null;
}

// Teams managed by the caller: one query for the whole page
// Admin and employee receive a empty set
export async function managedTeamIds(actor: Caller): Promise<Set<string>> {
  if (actor.role !== 'manager') return new Set();
  const teams = await prisma.team.findMany({ where: { managerId: actor.id }, select: { id: true } });
  return new Set(teams.map(team => team.id));
}
