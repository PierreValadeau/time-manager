import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import prisma from '../../../src/lib/prisma';
import {
  isSelf,
  isTeamManager,
  isManagerOfEmployee,
  type Caller,
} from '../../../src/services/scope.service';

// No database: Prisma is replaced by mocks
vi.mock('../../../src/lib/prisma', () => ({
  default: {
    team: { findUnique: vi.fn() },
    teamMember: { findFirst: vi.fn() },
  },
}));

const findTeamMock = prisma.team.findUnique as unknown as Mock;
const findMembershipMock = prisma.teamMember.findFirst as unknown as Mock;

// Bob manages the "Caisse" team, Alice manages "Logistique"
const bob: Caller = { id: 'bob-id', role: 'manager' };
const alice: Caller = { id: 'alice-id', role: 'manager' };
const admin: Caller = { id: 'admin-id', role: 'admin' };
const employee: Caller = { id: 'employee-id', role: 'employee' };

const CAISSE = 'caisse-team-id';
const LOGISTIQUE = 'logistique-team-id';

beforeEach(() => {
  vi.clearAllMocks();
  findTeamMock.mockImplementation(async ({ where }: { where: { id: string } }) => {
    if (where.id === CAISSE) return { managerId: bob.id };
    if (where.id === LOGISTIQUE) return { managerId: alice.id };
    return null;
  });
});

describe('isSelf', () => {
  it('is true for the caller own id', () => {
    expect(isSelf(employee, 'employee-id')).toBe(true);
  });

  it("is false for someone else's id", () => {
    expect(isSelf(employee, 'colleague-id')).toBe(false);
  });
});

describe('isTeamManager', () => {
  it('is true for the manager of the team', async () => {
    expect(await isTeamManager(bob, CAISSE)).toBe(true);
    expect(findTeamMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: CAISSE } }));
  });

  it("is false for a manager of another team (Bob on Alice's team)", async () => {
    expect(await isTeamManager(bob, LOGISTIQUE)).toBe(false);
  });

  it('is false when the team does not exist (the route must answer 404 before)', async () => {
    expect(await isTeamManager(bob, 'unknown-team-id')).toBe(false);
  });

  it('is false for an employee, without querying the database', async () => {
    expect(await isTeamManager(employee, CAISSE)).toBe(false);
    expect(findTeamMock).not.toHaveBeenCalled();
  });

  it('is false for a demoted manager still recorded as the team manager', async () => {
    const demotedBob: Caller = { id: bob.id, role: 'employee' };
    expect(await isTeamManager(demotedBob, CAISSE)).toBe(false);
  });

  it.each([CAISSE, LOGISTIQUE, 'unknown-team-id'])('lets the admin through for team %s', async teamId => {
    expect(await isTeamManager(admin, teamId)).toBe(true);
    expect(findTeamMock).not.toHaveBeenCalled();
  });
});

describe('isManagerOfEmployee', () => {
  it('is true when the employee belongs to one of the manager teams', async () => {
    findMembershipMock.mockResolvedValue({ teamId: CAISSE });

    expect(await isManagerOfEmployee(bob, 'cashier-id')).toBe(true);
    expect(findMembershipMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'cashier-id', team: { managerId: bob.id } } }),
    );
  });

  it('is false when the employee is in none of the manager teams', async () => {
    findMembershipMock.mockResolvedValue(null);
    expect(await isManagerOfEmployee(bob, 'warehouse-worker-id')).toBe(false);
  });

  it('is false for an employee, without querying the database', async () => {
    expect(await isManagerOfEmployee(employee, 'colleague-id')).toBe(false);
    expect(findMembershipMock).not.toHaveBeenCalled();
  });

  it('is false for a demoted manager even if still recorded as a team manager', async () => {
    findMembershipMock.mockResolvedValue({ teamId: CAISSE });
    const demotedBob: Caller = { id: bob.id, role: 'employee' };
    expect(await isManagerOfEmployee(demotedBob, 'cashier-id')).toBe(false);
  });

  it('lets the admin through for any user', async () => {
    expect(await isManagerOfEmployee(admin, 'anyone-id')).toBe(true);
    expect(findMembershipMock).not.toHaveBeenCalled();
  });
});

describe('combining helpers: "self or manager of the employee"', () => {
  const canSeeClocks = async (caller: Caller, userId: string) =>
    isSelf(caller, userId) || (await isManagerOfEmployee(caller, userId));

  it('lets an employee see their own clocks', async () => {
    expect(await canSeeClocks(employee, employee.id)).toBe(true);
  });

  it("forbids an employee to see a colleague's clocks", async () => {
    expect(await canSeeClocks(employee, 'colleague-id')).toBe(false);
  });

  it("forbids Bob to see the clocks of Alice's employee", async () => {
    findMembershipMock.mockResolvedValue(null);
    expect(await canSeeClocks(bob, 'warehouse-worker-id')).toBe(false);
  });
});
