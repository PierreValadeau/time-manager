import { PrismaClient } from '@prisma/client';
import { seedAdmin } from './seedAdmin';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;

/**
 * Apply the real logic on this 
 */
seedAdmin(prisma, process.env)
.then((admin) => console.log(`Compte admin prêt : ${admin.email}`))
.catch((error) => {
  console.error(error); 
  process.exitCode = 1; 
})
.finally(() => prisma.$disconnect())