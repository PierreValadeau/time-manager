import { z } from 'zod';

// /users/:id, /teams/:id… (contrat : identifiants UUID v4)
export const idParamSchema = z.object({
  id: z.uuidv4(),
});

// /users/:id, /users/:id/clocks UUIDv4 or me for the caller
export const userIdParamSchema = z.object({
  id: z.union([z.literal('me'), z.uuidv4()]),
});

// ?page=1&limit=20 (contrat : limite maximale 100)
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
