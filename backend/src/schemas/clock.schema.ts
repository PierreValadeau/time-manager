import { z } from 'zod';
import { paginationSchema } from './common.schema';

// /users/:id/clocks...: a UUID v4, or "me" for the caller
export const userIdParamSchema = z.object({
  id: z.union([z.literal('me'), z.uuidv4()]),
});

// GET /users/:id/clocks?from=2026-10-05&to=2026-10-11&status=anomaly&page=1&limit=20
// from and to are local days (APP_TIMEZONE), both inclusive
export const clockHistoryQuerySchema = paginationSchema
  .extend({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    status: z.enum(['open', 'closed', 'anomaly']).optional(),
  })
  // YYYY-MM-DD strings compare like dates
  .refine(query => !query.from || !query.to || query.from <= query.to, {
    path: ['to'],
    message: 'to must not be before from',
  });

export type ClockHistoryQuery = z.infer<typeof clockHistoryQuerySchema>;
