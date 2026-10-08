import type { UserRole } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      // Authenticated caller, set by the authenticate middleware
      user?: { id: string; role: UserRole };
    }
  }
}

export {};
