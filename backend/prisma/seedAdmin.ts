import type { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/password'

/***
 * Environment variables search 
 * name: string -> name of the var
 * 
 * return the value inside the env var
 * throw an error with the name of the var passes as parameter
 *  specifying that it hasnt been found
 */
function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return value;
}

/**
 * Separation of responsabilities, seed of the admin in the .env
 * @param prisma 
 */
export async function seedAdmin(prisma: Pick<PrismaClient, 'user'>, env: NodeJS.ProcessEnv) {
    const email = requireEnv(env, 'ADMIN_EMAIL').trim().toLowerCase();
    const password = requireEnv(env, 'ADMIN_PASSWORD');
    const firstName = env.ADMIN_FIRST_NAME ?? 'Admin';
    const lastName = env.ADMIN_LAST_NAME ?? 'Système';

    const passwordHash = await hashPassword(password);

    return prisma.user.upsert({
    where: { email },
    update: { role: 'admin', deletedAt: null },
    create: { email, firstName, lastName, role: 'admin', passwordHash },
  });

}