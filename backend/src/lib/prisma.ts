import { PrismaClient } from '@prisma/client';

// Single instance for the whole app (shared connection pool)
const prisma = new PrismaClient();

export default prisma;
