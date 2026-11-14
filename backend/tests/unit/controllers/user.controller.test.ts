import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { Request, Response } from 'express';
import AppError from '../../../src/errors/AppError';
import { createUser, getUser, listUsers, updateUser } from '../../../src/services/user.service';
import {
  createUserHandler,
  getUserHandler,
  listUsersHandler,
  updateUserHandler,
} from '../../../src/controllers/user.controller';

// The service is tested on its own: here we only check the HTTP layer
vi.mock('../../../src/services/user.service', () => ({
  createUser: vi.fn(),
  listUsers: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
}));

const createUserMock = createUser as unknown as Mock;
const listUsersMock = listUsers as unknown as Mock;
const getUserMock = getUser as unknown as Mock;
const updateUserMock = updateUser as unknown as Mock;

const body = { firstName: 'Jean', lastName: 'Dupont', email: 'jean.dupont@trinity.com', role: 'employee' };
const created = { id: 'new-user-id', firstName: 'Jean', lastName: 'Dupont', role: 'employee' };

const makeRes = () => {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
};

const call = (req: Partial<Request>, res = makeRes()) =>
  Promise.resolve(createUserHandler(req as Request, res as unknown as Response, vi.fn())).then(() => res);

const callList = (req: Partial<Request>, res = makeRes()) =>
  Promise.resolve(listUsersHandler(req as Request, res as unknown as Response, vi.fn())).then(() => res);

// The :id handlers are typed RequestHandler<{ id: string }>, hence the Request<{ id: string }> cast
const callGet = (req: Partial<Request<{ id: string }>>, res = makeRes()) =>
  Promise.resolve(
    getUserHandler(req as Request<{ id: string }>, res as unknown as Response, vi.fn()),
  ).then(() => res);

const callUpdate = (req: Partial<Request<{ id: string }>>, res = makeRes()) =>
  Promise.resolve(
    updateUserHandler(req as Request<{ id: string }>, res as unknown as Response, vi.fn()),
  ).then(() => res);

beforeEach(() => {
  vi.clearAllMocks();
  createUserMock.mockResolvedValue(created);
});

describe('createUserHandler', () => {
  it('responds 201 with the created user', async () => {
    const res = await call({ user: { id: 'manager-id', role: 'manager' }, body });

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(created);
  });

  it('passes the authenticated caller and the body to the service', async () => {
    await call({ user: { id: 'manager-id', role: 'manager' }, body });

    expect(createUserMock).toHaveBeenCalledWith({ id: 'manager-id', role: 'manager' }, body);
  });

  it('rejects with 401 when no user is authenticated', async () => {
    await expect(call({ body })).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('lets service errors reach the error handler', async () => {
    createUserMock.mockRejectedValue(new AppError(403, 'FORBIDDEN', 'Interdit'));

    await expect(call({ user: { id: 'manager-id', role: 'manager' }, body })).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('listUsersHandler', () => {
  const manager = { id: 'manager-id', role: 'manager' as const };
  // What validate() leaves in req.query: numbers and defaults already applied
  const query = { page: 2, limit: 5, search: 'dup', role: 'employee' };
  const page = {
    data: [{ id: 'user-id', firstName: 'Jean', lastName: 'Dupont', role: 'employee' }],
    meta: { page: 2, limit: 5, total: 6 },
  };

  beforeEach(() => {
    listUsersMock.mockResolvedValue(page);
  });

  it('responds with the page returned by the service (200 by default)', async () => {
    const res = await callList({ user: manager, query });
    expect(res.json).toHaveBeenCalledWith(page);
    // No explicit status: Express answers 200
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes the authenticated caller and the validated query to the service', async () => {
    await callList({ user: manager, query });
    expect(listUsersMock).toHaveBeenCalledWith(manager, query);
  });

  it('rejects with 401 when no user is authenticated', async () => {
    await expect(callList({ query })).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(listUsersMock).not.toHaveBeenCalled();
  });

  it('lets service errors reach the error handler', async () => {
    listUsersMock.mockRejectedValue(new Error('database down'));
    await expect(callList({ user: manager, query })).rejects.toThrow('database down');
  });
});

describe('getUserHandler', () => {
  const employee = { id: 'employee-id', role: 'employee' as const };
  const profile = { id: 'employee-id', firstName: 'Jean', lastName: 'Dupont', role: 'employee' };

  beforeEach(() => {
    getUserMock.mockResolvedValue(profile);
  });

  it('responds with the profile returned by the service (200 by default)', async () => {
    const res = await callGet({ user: employee, params: { id: 'me' } });
    expect(res.json).toHaveBeenCalledWith(profile);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes the caller and the raw id to the service, which resolves "me" itself', async () => {
    await callGet({ user: employee, params: { id: 'me' } });
    expect(getUserMock).toHaveBeenCalledWith(employee, 'me');
  });

  it('rejects with 401 when no user is authenticated', async () => {
    await expect(callGet({ params: { id: 'me' } })).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it('lets service errors reach the error handler', async () => {
    getUserMock.mockRejectedValue(new AppError(404, 'NOT_FOUND', 'Utilisateur introuvable'));
    await expect(callGet({ user: employee, params: { id: 'gone-id' } })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('updateUserHandler', () => {
  const employee = { id: 'employee-id', role: 'employee' as const };
  // What validate() leaves in req.body
  const input = { firstName: 'Jean', lastName: 'Dupont', email: 'jean.dupont@trinity.com' };
  const profile = { ...input, id: 'employee-id', role: 'employee', teams: [] };

  beforeEach(() => {
    updateUserMock.mockResolvedValue(profile);
  });

  it('responds with the updated profile (200 by default)', async () => {
    const res = await callUpdate({ user: employee, params: { id: 'me' }, body: input });
    expect(res.json).toHaveBeenCalledWith(profile);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes the caller, the raw id and the validated body to the service', async () => {
    await callUpdate({ user: employee, params: { id: 'me' }, body: input });
    expect(updateUserMock).toHaveBeenCalledWith(employee, 'me', input);
  });

  it('rejects with 401 when no user is authenticated', async () => {
    await expect(callUpdate({ params: { id: 'me' }, body: input })).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('lets service errors reach the error handler', async () => {
    updateUserMock.mockRejectedValue(new AppError(409, 'CONFLICT', 'Email déjà pris'));
    await expect(
      callUpdate({ user: employee, params: { id: 'me' }, body: input }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

