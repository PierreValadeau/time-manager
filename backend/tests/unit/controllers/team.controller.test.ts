import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { Request, Response } from 'express';
import AppError from '../../../src/errors/AppError';
import { createTeam } from '../../../src/services/team.service';
import { createTeamHandler } from '../../../src/controllers/team.controller';

// The service is tested on its own: here we only check the HTTP layer
vi.mock('../../../src/services/team.service', () => ({ createTeam: vi.fn() }));

const createTeamMock = createTeam as unknown as Mock;

const manager = { id: 'manager-id', role: 'manager' as const };
const body = { name: 'Team A' };
const created = { id: 'team-id', name: 'Team A', managerId: 'manager-id' };

const makeRes = () => {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
};

const call = (req: Partial<Request>, res = makeRes()) =>
  Promise.resolve(createTeamHandler(req as Request, res as unknown as Response, vi.fn())).then(() => res);

beforeEach(() => {
  vi.clearAllMocks();
  createTeamMock.mockResolvedValue(created);
});

describe('createTeamHandler', () => {
  it('responds 201 with the created team', async () => {
    const res = await call({ user: manager, body });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(created);
  });

  it('passes the authenticated caller and the body to the service', async () => {
    await call({ user: manager, body });
    expect(createTeamMock).toHaveBeenCalledWith(manager, body);
  });

  it('rejects with 401 when no user is authenticated', async () => {
    await expect(call({ body })).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(createTeamMock).not.toHaveBeenCalled();
  });

  it('lets service errors reach the error handler', async () => {
    createTeamMock.mockRejectedValue(new AppError(409, 'CONFLICT', 'Nom déjà pris'));
    await expect(call({ user: manager, body })).rejects.toMatchObject({ status: 409 });
  });
});
