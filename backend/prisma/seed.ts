import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;

/***
 * Recherche de variables d'environnement
 * name: string -> il s'agit du nom de la variable
 * 
 * return la valeur contenue dans la variable d'environnement
 * throw une erreur avec le nom de la variable passée en paramètre 
 *  spécifiant qu'elle n'a pas été trouvée 
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return value;
}

/**
 * le seed 
 */
async function main() {
  const email = requireEnv('ADMIN_EMAIL').toLowerCase();
  const password = requireEnv('ADMIN_PASSWORD');
  const firstName = process.env.ADMIN_FIRST_NAME ?? 'Admin';
  const lastName = process.env.ADMIN_LAST_NAME ?? 'Système';

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // upsert sur l'email : relancer le seed ne crée jamais de doublon
  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: 'admin' },
    create: { email, firstName, lastName, role: 'admin', passwordHash },
  });

  console.log(`Compte admin prêt : ${admin.email}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });