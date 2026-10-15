import { Prisma, type Clock } from '@prisma/client';
import { DateTime } from 'luxon';
import AppError from '../errors/AppError';
import prisma from '../lib/prisma';
import type { ClockHistoryQuery, ClockSummaryQuery } from '../schemas/clock.schema';
import {
  sessionMinutes,
  sessionStatus,
  summarizeSessions,
  type HoursSummary,
  type SessionStatus,
} from './hours.service';
import { isManagerOfEmployee, isSelf, type Caller } from './scope.service';

// Session object of the contract, section 6
export type SessionDto = {
  id: string;
  userId: string;
  clockIn: Date;
  clockOut: Date | null;
  workedMinutes: number | null;
  status: SessionStatus;
};

export type ToggleResult = { action: 'clockIn' | 'clockOut'; session: SessionDto };

export function toSessionDto(clock: Clock, now: Date, anomalyThresholdHours: number): SessionDto {
  const status = sessionStatus(clock, now, anomalyThresholdHours);
  return {
    id: clock.id,
    userId: clock.userId,
    clockIn: clock.clockIn,
    clockOut: clock.clockOut,
    // Only a finished, trusted session has a duration
    workedMinutes: status === 'closed' ? sessionMinutes(clock, now) : null,
    status,
  };
}

const concurrentClock = () =>
  new AppError(409, 'CONFLICT', 'Un pointage est déjà en cours de traitement, réessayez');

// POST /clocks: clock in without an open session, clock out otherwise.
export async function toggleClock(
  userId: string,
  now: Date,
  anomalyThresholdHours: number
): Promise<ToggleResult> {
  try {
    return await prisma.$transaction(async tx => {
      const open = await tx.clock.findFirst({ where: { userId, clockOut: null } });

      // updateMany is a single UPDATE ... WHERE clock_out IS NULL: if a concurrent
      // request closed the session first, it matches no row instead of overwriting it.
      // now is read before the transaction: a session opened by a later concurrent
      // request must not be closed before its start (CHECK clocks_out_after_in)
      const close = async (clock: Clock) => {
        const { count } = await tx.clock.updateMany({
          where: { id: clock.id, clockOut: null, clockIn: { lt: now } },
          data: { clockOut: now },
        });
        if (count === 0) throw concurrentClock();
        return { ...clock, clockOut: now };
      };

      if (open && sessionStatus(open, now, anomalyThresholdHours) === 'open') {
        const closed = await close(open);
        return { action: 'clockOut', session: toSessionDto(closed, now, anomalyThresholdHours) };
      }

      // Forgotten clock-out: close it so the employee is not blocked. It stays an anomaly,
      // until a manager corrects it (PUT /clocks/:id)
      if (open) await close(open);

      const created = await tx.clock.create({ data: { userId, clockIn: now } });
      return { action: 'clockIn', session: toSessionDto(created, now, anomalyThresholdHours) };
    });
  } catch (err) {
    // Unique index clocks_one_open_session_per_user: a concurrent request opened a session first
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw concurrentClock();
    }
    throw err;
  }
}

const forbidden = () => new AppError(403, 'FORBIDDEN', 'Droits insuffisants pour cette action');

// GET /users/:id/clocks...
export async function authorizeClockRead(caller: Caller, id: string): Promise<string> {
  const userId = id === 'me' ? caller.id : id;
  if (isSelf(caller, userId)) return userId;

  // An employee only reads their own clocks. Deliberately before the 404 check (unlike
  // scope.service.ts): the answer is the same whether the user exists or not
  if (caller.role === 'employee') throw forbidden();

  // A missing user is a 404, not a 403 (see scope.service.ts)
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'Utilisateur introuvable');

  if (!(await isManagerOfEmployee(caller, userId))) throw forbidden();
  return userId;
}

// GET /users/:id/clocks/current: the open session, or null.
export async function getCurrentSession(
  userId: string,
  now: Date,
  anomalyThresholdHours: number
): Promise<SessionDto | null> {
  const open = await prisma.clock.findFirst({ where: { userId, clockOut: null } });
  return open ? toSessionDto(open, now, anomalyThresholdHours) : null;
}

// Local days (YYYY-MM-DD, both inclusive) to UTC bounds on clockIn
export function clockInRange(
  from: string | undefined,
  to: string | undefined,
  timezone: string
): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;

  const range: Prisma.DateTimeFilter = {};
  if (from) range.gte = DateTime.fromISO(from, { zone: timezone }).startOf('day').toJSDate();

  if (to)
    range.lt = DateTime.fromISO(to, { zone: timezone }).plus({ days: 1 }).startOf('day').toJSDate();
  return range;
}

export type Paginated<T> = {
  data: T[];
  meta: { page: number; limit: number; total: number };
};

export type HistoryOptions = {
  now: Date;
  anomalyThresholdHours: number;
  timezone: string;
};

// GET /users/:id/clocks: paginated, most recent first
export async function listSessions(
  userId: string,
  filters: ClockHistoryQuery,
  options: HistoryOptions
): Promise<Paginated<SessionDto>> {
  const { from, to, status, page, limit } = filters;
  const { now, anomalyThresholdHours, timezone } = options;

  const where: Prisma.ClockWhereInput = { userId, clockIn: clockInRange(from, to, timezone) };
  const orderBy: Prisma.ClockOrderByWithRelationInput[] = [{ clockIn: 'desc' }, { id: 'desc' }];
  const skip = (page - 1) * limit;
  const toDto = (clock: Clock) => toSessionDto(clock, now, anomalyThresholdHours);

  if (!status) {
    const [rows, total] = await Promise.all([
      prisma.clock.findMany({ where, orderBy, skip, take: limit }),
      prisma.clock.count({ where }),
    ]);
    return { data: rows.map(toDto), meta: { page, limit, total } };
  }

  // The status depends on `now` and on the session length, which Prisma cannot filter on:
  // it is computed by sessionStatus
  const rows = await prisma.clock.findMany({ where, orderBy });
  const matching = rows.map(toDto).filter(session => session.status === status);
  return {
    data: matching.slice(skip, skip + limit),
    meta: { page, limit, total: matching.length },
  };
}

export type ClockSummary = HoursSummary & {
  userId: string;
  from: string;
  to: string;
  groupBy: ClockSummaryQuery['groupBy'];
};

// GET /users/:id/clocks/summary: worked minutes per local day or ISO week
export async function getClockSummary(
  userId: string,
  query: ClockSummaryQuery,
  options: HistoryOptions
): Promise<ClockSummary> {
  const { from, to, groupBy } = query;
  const { now, anomalyThresholdHours, timezone } = options;

  // Same rule as the history: a session belongs to the day of its clock-in
  const sessions = await prisma.clock.findMany({
    where: { userId, clockIn: clockInRange(from, to, timezone) },
    select: { clockIn: true, clockOut: true, correctedById: true },
    orderBy: { clockIn: 'asc' },
  });

  const summary = summarizeSessions(sessions, { groupBy, timezone, now, anomalyThresholdHours });
  return { userId, from, to, groupBy, ...summary };
}
