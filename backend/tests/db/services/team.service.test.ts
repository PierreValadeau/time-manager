import { describe, it, expect } from 'vitest';
import prisma from '../../../src/lib/prisma';
import AppError from '../../../src/errors/AppError';
import { createTeam, deleteTeam, getTeam, listTeams, addTeamMember, removeTeamMember } from '../../../src/services/team.service';

// Real database, nothing mocked: the cascade and the unique constraint come from PostgreSQL
const admin = { id: 'admin-id', role: 'admin' as const };

// setup.ts empties every table before each test: each test creates its own rows
const createUser = (email: string, role: 'employee' | 'manager') =>
  prisma.user.create({ data: { firstName: 'Test', lastName: role, email, role } });

describe('deleteTeam (PostgreSQL)', () => {
  it('deletes the memberships but keeps the users', async () => {
    // Arrange: a manager, an employee, a team with the employee as member
    const manager = await createUser('manager@trinity.com', 'manager');
    const employee = await createUser('employee@trinity.com', 'employee');
    const team = await prisma.team.create({
      data: {
        name: 'Team A',
        managerId: manager.id,
        members: { create: { userId: employee.id } },
      },
    });

    // Act
    await deleteTeam(admin, team.id);

    // Assert: the team and its team_members rows are gone, both users are still there
    expect(await prisma.team.findUnique({ where: { id: team.id } })).toBeNull();
    expect(await prisma.teamMember.count({ where: { teamId: team.id } })).toBe(0);
    expect(await prisma.user.count()).toBe(2);
  });
});

describe('createTeam (PostgreSQL)', () => {
  it('turns the unique violation on name into a 409', async () => {
    const manager = await createUser('manager@trinity.com', 'manager');
    await createTeam(admin, { name: 'Team A', managerId: manager.id });

    const err = await createTeam(admin, { name: 'Team A', managerId: manager.id }).catch(e => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(await prisma.team.count()).toBe(1);
  });

  it('stores description null', async () => {
    const manager = await createUser('manager@trinity.com', 'manager');
    const team = await createTeam(admin, { name: 'Team A', description: null, managerId: manager.id });

    expect(team.description).toBeNull();
    expect((await prisma.team.findUnique({ where: { id: team.id } }))!.description).toBeNull();
  });
});

describe('getTeam (PostgreSQL)', () => {
  it('sorts the members by last name, first name, then id for namesakes', async () => {
    const manager = await createUser('manager@trinity.com', 'manager');
    // Ids in the reverse order of the names, so sorting by id alone gives the wrong answer;
    // the two Camille Martin only differ by id
    const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    const people = [
      { id: id(1), firstName: 'Camille', lastName: 'Martin', email: 'c1@trinity.com' },
      { id: id(2), firstName: 'Camille', lastName: 'Martin', email: 'c2@trinity.com' },
      { id: id(3), firstName: 'Zoé', lastName: 'Durand', email: 'zoe@trinity.com' },
      { id: id(4), firstName: 'Anna', lastName: 'Durand', email: 'anna@trinity.com' },
    ];
    await prisma.user.createMany({ data: people });
    const team = await prisma.team.create({
      data: {
        name: 'Team A',
        managerId: manager.id,
        members: { create: people.map(person => ({ userId: person.id })) },
      },
    });

    const result = await getTeam(admin, team.id);

    expect(result.members.map(member => member.id)).toEqual([id(4), id(3), id(1), id(2)]);
  });
});

describe('listTeams (PostgreSQL)', () => {
  it('matches _ and % literally in search', async () => {
    const manager = await createUser('manager@trinity.com', 'manager');
    for (const name of ['Team_A', 'TeamBA', 'Sales']) {
      await prisma.team.create({ data: { name, managerId: manager.id } });
    }

    const underscore = await listTeams(admin, { page: 1, limit: 20, search: 'm_' });
    expect(underscore.data.map(team => team.name)).toEqual(['Team_A']);

    const percent = await listTeams(admin, { page: 1, limit: 20, search: '%' });
    expect(percent.data).toEqual([]);
    expect(percent.meta.total).toBe(0);
  });
});

describe('team members (PostgreSQL)', () => {
  it('adds a member once, however many times it is called', async () => {
    const manager = await createUser('manager@trinity.com', 'manager');
    const employee = await createUser('employee@trinity.com', 'employee');
    const team = await prisma.team.create({ data: { name: 'Team A', managerId: manager.id } });

    await addTeamMember(admin, team.id, employee.id);
    await addTeamMember(admin, team.id, employee.id);

    expect(await prisma.teamMember.count({ where: { teamId: team.id } })).toBe(1);
  });

  it('removes the membership but keeps the user', async () => {
    const manager = await createUser('manager@trinity.com', 'manager');
    const employee = await createUser('employee@trinity.com', 'employee');
    const team = await prisma.team.create({
      data: { name: 'Team A', managerId: manager.id, members: { create: { userId: employee.id } } },
    });

    await removeTeamMember(admin, team.id, employee.id);

    expect(await prisma.teamMember.count({ where: { teamId: team.id } })).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: employee.id } })).not.toBeNull();
  });
});
