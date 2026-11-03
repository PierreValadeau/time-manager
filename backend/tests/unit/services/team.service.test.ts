import { Prisma } from '@prisma/client'; 
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'; 
import prisma from '../../../src/lib/prisma';
import { createTeam, listTeams, getTeam, updateTeam, deleteTeam, addTeamMember, removeTeamMember } from '../../../src/services/team.service'; 
import { isTeamManager, type Caller } from '../../../src/services/scope.service'; 

vi.mock('../../../src/lib/prisma', () => ({
    default: { 
        user: { findUnique: vi.fn() }, 
        team: { create: vi.fn(), findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() } , 
        teamMember: { upsert: vi.fn(), deleteMany: vi.fn() }, 
    },
}));
vi.mock('../../../src/services/scope.service', () => ({ isTeamManager: vi.fn() })); 

const findUserMock = prisma.user.findUnique as unknown as Mock; 
const createTeamMock = prisma.team.create as unknown as Mock; 
const findManyMock = prisma.team.findMany as unknown as Mock;
const findTeamMock = prisma.team.findUnique as unknown as Mock; 
const isTeamManagerMock = isTeamManager as unknown as Mock; 
const updateTeamMock = prisma.team.update as unknown as Mock; 
const deleteTeamMock = prisma.team.delete as unknown as Mock; 
const countMock = prisma.team.count as unknown as Mock;
const employee: Caller = { id: 'employee-id', role: 'employee' };
const upsertMemberMock = prisma.teamMember.upsert as unknown as Mock; 
const deleteMembersMock = prisma.teamMember.deleteMany as unknown as Mock; 

const admin: Caller = { id: 'admin-id', role: 'admin' }; 
const manager: Caller = { id: 'manager-id', role: 'manager' }; 

const createdManagerId = () => createTeamMock.mock.lastCall![0].data.managerId; 

//Prisma error ...
const uniqueViolation = (column: string) =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: [column] },
});

const dbTeam = {
    id: 'team-id', 
    name: 'Team A', 
    description: null,
    createdAt: new Date('2026-10-30T08:00:00Z'),
    updatedAt: new Date('2026-10-30T08:00:00Z'),
    manager: { id: 'manager-id', firstName: 'Nadia', lastName: 'Benali' },
    members: [],
}; 

beforeEach(() => {
    vi.clearAllMocks(); 

    findUserMock.mockResolvedValue({ role: 'manager', deleteAt: null }); 
    createTeamMock.mockResolvedValue(dbTeam); 
}); 

describe('createTeam: managerId', () => {
    it('defaults to the creator when a manager sends none', async () => {
        await createTeam(manager, { name: 'Team A' });
        expect(createdManagerId()).toBe('manager-id');
    });

    it('keeps the managerId sent by the admin', async () => {
        await createTeam(admin, { name: 'Team A', managerId: 'other-manager-id' });
        expect(createdManagerId()).toBe('other-manager-id');
    });

    it('answers 400 when the admin sends no managerId, before touching the database', async () => {
        await expect(createTeam(admin, { name: 'Team A' })).rejects.toMatchObject({
            status: 400,
            code: 'VALIDATION_ERROR',
        });
        expect(createTeamMock).not.toHaveBeenCalled();
    });

    it('answers 409 when the name is already taken by another team', async () => {
        createTeamMock.mockRejectedValueOnce(uniqueViolation('name'));     
    
        await expect(createTeam(manager, { name: 'Team A' })).rejects.toMatchObject({
            status: 409, 
            code: 'CONFLICT', 
        });
    });

    it('answers 400 when its an unknown managerId', async () => {
        findUserMock.mockResolvedValueOnce(null); 

        await expect(
            createTeam(admin, { name: 'Team A', managerId: 'unknownId' }), 
        ).rejects.toMatchObject({
            status: 400, 
            code: 'VALIDATION_ERROR', 
        }); 
        //rejected before the write 
        expect(createTeamMock).not.toHaveBeenCalled(); 
    });

    it('answers 400 for a deleted account', async () => {
        findUserMock.mockResolvedValueOnce({ role: 'manager', deletedAt: new Date() });
        
        await expect(
            createTeam(admin, { name: 'Team A', managerId: 'deleted-manager-id' }), 
        ).rejects.toMatchObject({
            status: 400, 
            code: 'VALIDATION_ERROR',
        }); 

        expect(createTeamMock).not.toHaveBeenCalled(); 
    }); 

    it('answers 400 when managerId is not a manager', async () => {
        findUserMock.mockResolvedValueOnce({ role: 'employee', deletedAt: null });

        await expect(
            createTeam(admin, { name: 'Team A', managerId: 'employee-id' }),
        ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
        
        expect(createTeamMock).not.toHaveBeenCalled();
    }); 

    it('returns members as plain users, as in the contract', async () => {
        createTeamMock.mockResolvedValue({
            ...dbTeam,
            members: [{ user: { id: 'u1', firstName: 'Camille', lastName: 'Durand' } }],
        });
        const team = await createTeam(manager, { name: 'Team A' });
    expect(team.members).toEqual([{ id: 'u1', firstName: 'Camille', lastName: 'Durand' }]);
    });

}); 

describe('listTeams', () => {
  const dbListTeam = {
    id: 'team-id', name: 'Team A', description: null,
    createdAt: new Date('2026-10-30T08:00:00Z'), updatedAt: new Date('2026-10-30T08:00:00Z'),
    manager: { id: 'manager-id', firstName: 'Nadia', lastName: 'Benali' },
    _count: { members: 3 },
  };

  // where passed to findMany on the last call
  const listWhere = () => findManyMock.mock.lastCall![0].where;

  beforeEach(() => {
    findManyMock.mockResolvedValue([dbListTeam]);
    countMock.mockResolvedValue(1);
  });

  it('only returns the teams of an employee', async () => {
    await listTeams(employee, { page: 1, limit: 20 });
    expect(listWhere()).toEqual({ members: { some: { userId: 'employee-id' } } });
  });

  it('does not filter for a manager or the admin', async () => {
    await listTeams(manager, { page: 1, limit: 20 });
    expect(listWhere()).toEqual({});
    await listTeams(admin, { page: 1, limit: 20 });
    expect(listWhere()).toEqual({});
  });

  it('searches the name, case-insensitive, combined with the employee filter', async () => {
    await listTeams(employee, { page: 1, limit: 20, search: 'sup' });
    expect(listWhere()).toEqual({
      members: { some: { userId: 'employee-id' } },
      name: { contains: 'sup', mode: 'insensitive' },
    });
  });

  it('counts with the same filter as the page', async () => {
    await listTeams(employee, { page: 1, limit: 20, search: 'sup' });
    expect(countMock.mock.lastCall![0].where).toEqual(listWhere());
  });

  it('skips the previous pages', async () => {
    await listTeams(admin, { page: 3, limit: 10 });
    expect(findManyMock.mock.lastCall![0]).toMatchObject({ skip: 20, take: 10 });
  });

  it('returns data with memberCount and the pagination meta', async () => {
    const result = await listTeams(admin, { page: 1, limit: 20 });
    expect(result.meta).toEqual({ page: 1, limit: 20, total: 1 });
    expect(result.data[0]).toMatchObject({ id: 'team-id', memberCount: 3 });
    expect(result.data[0]).not.toHaveProperty('_count');
  });
});

describe('getTeam', () => {
  // Team with one member, as Prisma returns it with teamSelect
  const dbTeamWithMember = {
    ...dbTeam,
    members: [{ user: { id: 'employee-id', firstName: 'Camille', lastName: 'Durand' } }],
  };

  beforeEach(() => {
    findTeamMock.mockResolvedValue(dbTeamWithMember);
  });

  it('looks the team up by its id with the full select', async () => {
    await getTeam(admin, 'team-id');
    expect(findTeamMock.mock.lastCall![0].where).toEqual({ id: 'team-id' });
  });

  it('answers 404 when the team does not exist, whatever the role', async () => {
    findTeamMock.mockResolvedValue(null);
    await expect(getTeam(employee, 'missing-id')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('returns the team to a member employee, in the contract format', async () => {
    const team = await getTeam(employee, 'team-id');
    expect(team.members).toEqual([{ id: 'employee-id', firstName: 'Camille', lastName: 'Durand' }]);
  });

  it('answers 403 to an employee who is not a member', async () => {
    const outsider: Caller = { id: 'outsider-id', role: 'employee' };
    await expect(getTeam(outsider, 'team-id')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('lets any manager read the team, even one who does not manage it', async () => {
    const otherManager: Caller = { id: 'other-manager-id', role: 'manager' };
    await expect(getTeam(otherManager, 'team-id')).resolves.toMatchObject({ id: 'team-id' });
  });

  it('lets the admin read any team', async () => {
    await expect(getTeam(admin, 'team-id')).resolves.toMatchObject({ id: 'team-id' });
  });
});

describe('updateTeam', () => {
  const input = { name: 'Team B', description: null, managerId: 'new-manager-id' };

  beforeEach(() => {
    findTeamMock.mockResolvedValue({ id: 'team-id' });
    isTeamManagerMock.mockResolvedValue(true);
    updateTeamMock.mockResolvedValue({ ...dbTeam, name: 'Team B' });
  });

  it('answers 404 when the team does not exist, before checking rights', async () => {
    findTeamMock.mockResolvedValue(null);
    await expect(updateTeam(manager, 'missing-id', input)).rejects.toMatchObject({ status: 404 });
    expect(isTeamManagerMock).not.toHaveBeenCalled();
  });

  it('answers 403 to a manager of another team, without writing', async () => {
    isTeamManagerMock.mockResolvedValue(false);
    await expect(updateTeam(manager, 'team-id', input)).rejects.toMatchObject({ status: 403 });
    expect(updateTeamMock).not.toHaveBeenCalled();
  });

  it('checks rights before the new manager (no probing of manager ids)', async () => {
    isTeamManagerMock.mockResolvedValue(false);
    await expect(updateTeam(manager, 'team-id', input)).rejects.toMatchObject({ status: 403 });
    expect(findUserMock).not.toHaveBeenCalled();
  });

  it('answers 400 when the new manager is not an active manager', async () => {
    findUserMock.mockResolvedValue({ role: 'employee', deletedAt: null });
    await expect(updateTeam(admin, 'team-id', input)).rejects.toMatchObject({ status: 400 });
    expect(updateTeamMock).not.toHaveBeenCalled();
  });

  it('lets the admin reassign a team to another manager', async () => {
    await updateTeam(admin, 'team-id', input);
    expect(updateTeamMock.mock.lastCall![0]).toMatchObject({
      where: { id: 'team-id' },
      data: { managerId: 'new-manager-id' },
    });
  });

  it('answers 409 when the new name is taken', async () => {
    updateTeamMock.mockRejectedValue(uniqueViolation('name'));
    await expect(updateTeam(manager, 'team-id', input)).rejects.toMatchObject({ status: 409 });
  });

  it('returns the updated team in the contract format', async () => {
    const team = await updateTeam(manager, 'team-id', input);
    expect(team).toMatchObject({ name: 'Team B', members: [] });
  });
});

describe('deleteTeam', () => {
  beforeEach(() => {
    findTeamMock.mockResolvedValue({ id: 'team-id' });
    isTeamManagerMock.mockResolvedValue(true);
    deleteTeamMock.mockResolvedValue({});
  });

  it('deletes the team when the caller manages it', async () => {
    await deleteTeam(manager, 'team-id');
    expect(deleteTeamMock).toHaveBeenCalledWith({ where: { id: 'team-id' } });
  });

  it('answers 404 when the team does not exist', async () => {
    findTeamMock.mockResolvedValue(null);
    await expect(deleteTeam(manager, 'missing-id')).rejects.toMatchObject({ status: 404 });
    expect(deleteTeamMock).not.toHaveBeenCalled();
  });

  it('answers 403 to a manager of another team, without deleting', async () => {
    isTeamManagerMock.mockResolvedValue(false);
    await expect(deleteTeam(manager, 'team-id')).rejects.toMatchObject({ status: 403 });
    expect(deleteTeamMock).not.toHaveBeenCalled();
  });
});

describe('addTeamMember', () => {
  beforeEach(() => {
    findTeamMock.mockResolvedValue({ id: 'team-id' });
    isTeamManagerMock.mockResolvedValue(true);
    findUserMock.mockResolvedValue({ deletedAt: null });
    upsertMemberMock.mockResolvedValue({});
  });

  it('upserts the membership on the composite key, without changing an existing one', async () => {
    await addTeamMember(manager, 'team-id', 'user-id');
    expect(upsertMemberMock).toHaveBeenCalledWith({
      where: { teamId_userId: { teamId: 'team-id', userId: 'user-id' } },
      create: { teamId: 'team-id', userId: 'user-id' },
      update: {},
    });
  });

  it('answers 404 when the team does not exist', async () => {
    findTeamMock.mockResolvedValue(null);
    await expect(addTeamMember(manager, 'missing-id', 'user-id')).rejects.toMatchObject({ status: 404 });
    expect(upsertMemberMock).not.toHaveBeenCalled();
  });

  it('answers 403 to a manager of another team, before looking the user up', async () => {
    isTeamManagerMock.mockResolvedValue(false);
    await expect(addTeamMember(manager, 'team-id', 'user-id')).rejects.toMatchObject({ status: 403 });
    expect(findUserMock).not.toHaveBeenCalled();
  });

  it('answers 404 when the user does not exist', async () => {
    findUserMock.mockResolvedValue(null);
    await expect(addTeamMember(manager, 'team-id', 'missing-id')).rejects.toMatchObject({ status: 404 });
    expect(upsertMemberMock).not.toHaveBeenCalled();
  });

  it('answers 404 for an anonymized user', async () => {
    findUserMock.mockResolvedValue({ deletedAt: new Date() });
    await expect(addTeamMember(manager, 'team-id', 'user-id')).rejects.toMatchObject({ status: 404 });
  });
});

describe('removeTeamMember', () => {
  beforeEach(() => {
    findTeamMock.mockResolvedValue({ id: 'team-id' });
    isTeamManagerMock.mockResolvedValue(true);
    findUserMock.mockResolvedValue({ deletedAt: null });
    deleteMembersMock.mockResolvedValue({ count: 1 });
  });

  it('deletes only the membership row', async () => {
    await removeTeamMember(manager, 'team-id', 'user-id');
    expect(deleteMembersMock).toHaveBeenCalledWith({ where: { teamId: 'team-id', userId: 'user-id' } });
  });

  it('does not fail when the user is not a member', async () => {
    deleteMembersMock.mockResolvedValue({ count: 0 });
    await expect(removeTeamMember(manager, 'team-id', 'user-id')).resolves.toBeUndefined();
  });

  it('answers 403 to a manager of another team, without deleting', async () => {
    isTeamManagerMock.mockResolvedValue(false);
    await expect(removeTeamMember(manager, 'team-id', 'user-id')).rejects.toMatchObject({ status: 403 });
    expect(deleteMembersMock).not.toHaveBeenCalled();
  });

  it('answers 404 when the user does not exist', async () => {
    findUserMock.mockResolvedValue(null);
    await expect(removeTeamMember(manager, 'team-id', 'missing-id')).rejects.toMatchObject({ status: 404 });
  });
});

