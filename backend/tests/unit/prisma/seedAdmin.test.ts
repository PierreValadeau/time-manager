import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { seedAdmin } from '../../../prisma/seedAdmin';

const upsert = vi.fn(); 
const prisma = { user: { upsert } } as unknown as Pick<PrismaClient, 'user'>; 

const env = { ADMIN_EMAIL: 'admin@test.local', ADMIN_PASSWORD: 'Secret123!' };

beforeEach(() => {
  upsert.mockReset();
  upsert.mockImplementation(async ({ create }) => create); // pretend he database returns the created user
}); 

describe('seedAdmin', () => {
  it('upserts the admin on its email', async () => {
    await seedAdmin(prisma, env);

    expect(upsert).toHaveBeenCalledOnce();
    const args = upsert.mock.calls[0][0];
    expect(args.where).toEqual({ email: 'admin@test.local' });
    expect(args.update).toEqual({ role: 'admin', deletedAt: null });
    expect(args.create).toMatchObject({
      email: 'admin@test.local',
      firstName: 'Admin',
      lastName: 'Système',
      role: 'admin',
    });
  });

  it('trims and lowercases the email so no duplicate admin is created', async () => {
    await seedAdmin(prisma, { ...env, ADMIN_EMAIL: '  Admin@Test.LOCAL  ' });

    const args = upsert.mock.calls[0][0];
    expect(args.where).toEqual({ email: 'admin@test.local' });
    expect(args.create.email).toBe('admin@test.local');
  });

  it('stores a bcrypt hash, never the plain password', async () => {
    await seedAdmin(prisma, env);

    const { passwordHash } = upsert.mock.calls[0][0].create;
    expect(passwordHash).not.toBe('Secret123!');
    expect(await bcrypt.compare('Secret123!', passwordHash)).toBe(true);
  });

  it('uses ADMIN_FIRST_NAME and ADMIN_LAST_NAME when provided', async () => {
    await seedAdmin(prisma, { ...env, ADMIN_FIRST_NAME: 'Jane', ADMIN_LAST_NAME: 'Doe' });

    expect(upsert.mock.calls[0][0].create).toMatchObject({ firstName: 'Jane', lastName: 'Doe' });
  });

  it.each(['ADMIN_EMAIL', 'ADMIN_PASSWORD'])('throws when %s is missing', async (name) => {
    await expect(seedAdmin(prisma, { ...env, [name]: undefined })).rejects.toThrow(name);
    expect(upsert).not.toHaveBeenCalled();
  });
});

