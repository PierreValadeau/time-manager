import { Prisma } from '@prisma/client'; 
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'; 
import prisma from '../../../src/lib/prisma';
import { createTeam, listTeams } from '../../../src/services/team.service'; 
import type { Caller } from '../../../src/services/scope.service'; 

vi.mock('../../../src/lib/prisma', () => ({
    default: { 
        user: { findUnique: vi.fn() }, 
        team: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() } 
    },
}));

const findUserMock = prisma.user.findUnique as unknown as Mock; 
const createTeamMock = prisma.team.create as unknown as Mock; 
const findManyMock = prisma.team.findMany as unknown as Mock;
const countMock = prisma.team.count as unknown as Mock;
const employee: Caller = { id: 'employee-id', role: 'employee' };

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
