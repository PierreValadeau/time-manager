import { z } from 'zod';
import { paginationSchema } from './common.schema';

// E.164 format, e.g. +33612345678
const phoneNumberSchema = z.string().trim().regex(/^\+[1-9]\d{1,14}$/);

// Admin is never assignable through the API (contract, section 2).
const assignableRoleSchema = z.enum(['employee', 'manager']);

export const createUserSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  // Always stored lowercase so the unique constraint is case-insensitive
  email: z.string().trim().toLowerCase().pipe(z.email().max(255)),
  phoneNumber: phoneNumberSchema.optional(),
  role: assignableRoleSchema.default('employee'),
});

// GET /users...
export const listUsersQuerySchema = paginationSchema.extend({
  search: z.string().trim().min(1).max(100).optional(), 
  role: z.enum(['employee', 'manager', 'admin']).optional(), 
  teamId: z.uuidv4().optional(),
}); 

// PUT /users/:id
export const updateUserSchema = createUserSchema.extend({
  phoneNumber: phoneNumberSchema.nullable().optional(),
  role: assignableRoleSchema.optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>; 
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
