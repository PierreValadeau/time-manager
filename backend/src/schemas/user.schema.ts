import { z } from 'zod';
import { paginationSchema } from './common.schema';

// E.164 format, e.g. +33612345678
const phoneNumberSchema = z.string().trim().regex(/^\+[1-9]\d{1,14}$/);

const roleSchema = z.enum(['employee', 'manager', 'admin']);

// Roles accepted at creation: admin is never assignable through the API (contract, section 2)
const assignableRoleSchema = z.enum(['employee', 'manager']);

export const createUserSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  // Always stored lowercase so the unique constraint is case-insensitive
  email: z.string().trim().toLowerCase().pipe(z.email().max(255)),
  phoneNumber: phoneNumberSchema.optional(),
  role: assignableRoleSchema.default('employee'),
});

// GET /users query: pagination, search, role and team filters
export const listUsersQuerySchema = paginationSchema.extend({
  search: z.string().trim().min(1).max(100).optional(),
  role: roleSchema.optional(),
  teamId: z.uuidv4().optional(),
});

// PUT /users/:id. Any existing role is valid here, so the admin can send back their own profile;
// the service refuses an actual change to admin (KAN-22)
export const updateUserSchema = createUserSchema.extend({
  phoneNumber: phoneNumberSchema.nullable().optional(),
  role: roleSchema.optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
