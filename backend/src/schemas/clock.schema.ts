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

// Contract, section 6: at most 366 days, both bounds included (a full leap year)
export const MAX_SUMMARY_DAYS = 366;
const DAY_MS = 86_400_000;

// GET /users/:id/clocks/summary?from=2026-10-05&to=2026-10-11&groupBy=week
// from and to are required local days (APP_TIMEZONE), both inclusive
export const clockSummaryQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    groupBy: z.enum(['day', 'week']).default('day'),
  })
  .refine(query => query.from <= query.to, {
    path: ['to'],
    message: 'to must not be before from',
  })
  // Calendar days: Date.parse reads YYYY-MM-DD as UTC midnight, so no DST hour is lost
  .refine(query => (Date.parse(query.to) - Date.parse(query.from)) / DAY_MS < MAX_SUMMARY_DAYS, {
    path: ['to'],
    message: `the period must not exceed ${MAX_SUMMARY_DAYS} days`,
  });

export type ClockSummaryQuery = z.infer<typeof clockSummaryQuerySchema>;
