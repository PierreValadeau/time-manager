import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { Request, Response } from 'express';
import AppError from '../../../src/errors/AppError';
import { createUser } from '../../../src/services/user.service';
import { createUserHandler } from '../../../src/controllers/user.controller';

// The service is tested on its own: here we only check the HTTP layer
vi.mock('../../../src/services/user.service', () => ({ createUser: vi.fn() }));

const createUserMock = createUser as unknown as Mock;

const body = { firstName: 'Jean', lastName: 'Dupont', email: 'jean.dupont@trinity.com', role: 'employee' };
const created = { id: 'new-user-id', firstName: 'Jean', lastName: 'Dupont', role: 'employee' };

const makeRes = () => {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
};

const call = (req: Partial<Request>, res = makeRes()) =>
  Promise.resolve(createUserHandler(req as Request, res as unknown as Response, vi.fn())).then(() => res);

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
