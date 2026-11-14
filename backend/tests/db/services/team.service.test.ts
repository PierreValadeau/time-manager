import { describe, it, expect } from 'vitest';
import prisma from '../../../src/lib/prisma';
import AppError from '../../../src/errors/AppError';
import { createTeam, deleteTeam } from '../../../src/services/team.service';

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
});
