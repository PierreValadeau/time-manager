import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { Request, Response } from 'express';
import AppError from '../../../src/errors/AppError';
import { createTeam, getTeam, listTeams, updateTeam, deleteTeam } from '../../../src/services/team.service';
import { createTeamHandler, listTeamsHandler, getTeamHandler, updateTeamHandler, deleteTeamHandler } from '../../../src/controllers/team.controller';

// The service is tested on its own: here we only check the HTTP layer
vi.mock('../../../src/services/team.service', () => ({ createTeam: vi.fn(), listTeams: vi.fn(), getTeam: vi.fn(), updateTeam: vi.fn(), deleteTeam: vi.fn() }));

const createTeamMock = createTeam as unknown as Mock;
const listTeamsMock = listTeams as unknown as Mock; 
const getTeamMock = getTeam as unknown as Mock; 
const updateTeamMock = updateTeam as unknown as Mock;
const deleteTeamMock = deleteTeam as unknown as Mock;

const manager = { id: 'manager-id', role: 'manager' as const };
const body = { name: 'Team A' };
const created = { id: 'team-id', name: 'Team A', managerId: 'manager-id' };

const makeRes = () => {
  const res = { status: vi.fn(), json: vi.fn(), sendStatus: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
};

const call = (req: Partial<Request>, res = makeRes()) =>
  Promise.resolve(createTeamHandler(req as Request, res as unknown as Response, vi.fn())).then(() => res);

const callList = (req: Partial<Request>, res = makeRes()) => 
  Promise.resolve(listTeamsHandler(req as Request, res as unknown as Response, vi.fn())).then(() => res); 

const callGet = (req: Partial<Request>, res = makeRes()) => 
  Promise.resolve(getTeamHandler(req as Request, res as unknown as Response, vi.fn())).then(() => res); 

const callUpdate = (req: Partial<Request>, res = makeRes()) =>
  Promise.resolve(updateTeamHandler(req as Request, res as unknown as Response, vi.fn())).then(() => res);

const callDelete = (req: Partial<Request>, res = makeRes()) =>
  Promise.resolve(deleteTeamHandler(req as Request, res as unknown as Response, vi.fn())).then(() => res);


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

describe('listTeamsHandler', () => {
  const employee = { id: 'employee-id', role: 'employee' as const };
  // What validate() leaves in req.query: numbers and defaults already applied
  const query = { page: 2, limit: 5, search: 'sup' };
  const page = { data: [{ id: 'team-id', name: 'Team A', memberCount: 3 }], meta: { page: 2, limit: 5, total: 6 } };

  beforeEach(() => {
    listTeamsMock.mockResolvedValue(page);
  });

  it('responds with the page returned by the service (200 by default)', async () => {
    const res = await callList({ user: employee, query });
    expect(res.json).toHaveBeenCalledWith(page);
    // No explicit status: Express answers 200
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes the authenticated caller and the validated query to the service', async () => {
    await callList({ user: employee, query });
    expect(listTeamsMock).toHaveBeenCalledWith(employee, query);
  });

  it('rejects with 401 when no user is authenticated', async () => {
    await expect(callList({ query })).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(listTeamsMock).not.toHaveBeenCalled();
  });

  it('lets service errors reach the error handler', async () => {
    listTeamsMock.mockRejectedValue(new Error('database down'));
    await expect(callList({ user: employee, query })).rejects.toThrow('database down');
  });
});

describe('getTeamHandler', () => {
  const team = { id: 'team-id', name: 'Team A', members: [] };

  beforeEach(() => {
    getTeamMock.mockResolvedValue(team);
  });

  it('responds with the team returned by the service', async () => {
    const res = await callGet({ user: manager, params: { id: 'team-id' } });
    expect(res.json).toHaveBeenCalledWith(team);
  });

  it('passes the caller and the id from the URL to the service', async () => {
    await callGet({ user: manager, params: { id: 'team-id' } });
    expect(getTeamMock).toHaveBeenCalledWith(manager, 'team-id');
  });

  it('rejects with 401 when no user is authenticated', async () => {
    await expect(callGet({ params: { id: 'team-id' } })).rejects.toMatchObject({ status: 401 });
    expect(getTeamMock).not.toHaveBeenCalled();
  });
});

describe('updateTeamHandler', () => {
  // What validate() leaves in req.body: every editable field
  const update = { name: 'Team B', description: null, managerId: 'other-manager-id' };
  const updated = { id: 'team-id', name: 'Team B', members: [] };

  beforeEach(() => {
    updateTeamMock.mockResolvedValue(updated);
  });

  it('responds with the updated team (200 by default)', async () => {
    const res = await callUpdate({ user: manager, params: { id: 'team-id' }, body: update });
    expect(res.json).toHaveBeenCalledWith(updated);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes the caller, the id from the URL and the body to the service', async () => {
    await callUpdate({ user: manager, params: { id: 'team-id' }, body: update });
    expect(updateTeamMock).toHaveBeenCalledWith(manager, 'team-id', update);
  });

  it('rejects with 401 when no user is authenticated', async () => {
    await expect(callUpdate({ params: { id: 'team-id' }, body: update })).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(updateTeamMock).not.toHaveBeenCalled();
  });

  it('lets service errors reach the error handler', async () => {
    updateTeamMock.mockRejectedValue(new AppError(403, 'FORBIDDEN', 'Pas votre équipe'));
    await expect(callUpdate({ user: manager, params: { id: 'team-id' }, body: update })).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('deleteTeamHandler', () => {
  beforeEach(() => {
    deleteTeamMock.mockResolvedValue(undefined);
  });

  it('responds 204 with no body', async () => {
    const res = await callDelete({ user: manager, params: { id: 'team-id' } });
    expect(res.sendStatus).toHaveBeenCalledWith(204);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('passes the caller and the id from the URL to the service', async () => {
    await callDelete({ user: manager, params: { id: 'team-id' } });
    expect(deleteTeamMock).toHaveBeenCalledWith(manager, 'team-id');
  });

  it('rejects with 401 when no user is authenticated', async () => {
    await expect(callDelete({ params: { id: 'team-id' } })).rejects.toMatchObject({ status: 401 });
    expect(deleteTeamMock).not.toHaveBeenCalled();
  });

  it('does not answer 204 when the service fails', async () => {
    deleteTeamMock.mockRejectedValue(new AppError(404, 'NOT_FOUND', 'Équipe introuvable'));
    const res = makeRes();
    await expect(callDelete({ user: manager, params: { id: 'team-id' } }, res)).rejects.toMatchObject({
      status: 404,
    });
    expect(res.sendStatus).not.toHaveBeenCalled();
  });
});



