import { z } from 'zod';

export const createUserSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  // Always stored lowercase so the unique constraint is case-insensitive
  email: z.string().trim().toLowerCase().pipe(z.email().max(255)),
  // E.164 format, e.g. +33612345678
  phoneNumber: z.string().trim().regex(/^\+[1-9]\d{1,14}$/).optional(),
  role: z.enum(['employee', 'manager']).default('employee'),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
