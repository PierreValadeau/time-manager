import { Prisma, type Clock } from '@prisma/client';
import AppError from '../errors/AppError';
import prisma from '../lib/prisma';
import { sessionMinutes, sessionStatus, type SessionStatus } from './hours.service';

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
      // request closed the session first, it matches no row instead of overwriting it
      const close = async (clock: Clock) => {
        const { count } = await tx.clock.updateMany({
          where: { id: clock.id, clockOut: null },
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
