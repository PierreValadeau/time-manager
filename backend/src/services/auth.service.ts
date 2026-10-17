import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import AppError from '../errors/AppError';
import { hashPassword, verifyPassword } from '../lib/password';
import { signAccessToken } from '../lib/jwt';
import { hashToken, generateToken, REFRESH_TOKEN_TTL_MS } from '../lib/token'; 
import { toFullUser, userSelect } from './user.service';
import type { LoginInput } from '../schemas/auth.schema';


// db: pass the transaction client (tx) to write inside a transaction, defaults to prisma
async function issueRefreshToken(userId: string, db: Prisma.TransactionClient = prisma) {
    const token = generateToken();
    await db.refreshToken.create({
        data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) },
    }); 

    return token; 
}
//same error for every failure 
const invalidCredentials = () => 
    new AppError(401, 'UNAUTHENTICATED', 'Email ou mot de passe incorrect'); 

const invalidSession = () => 
    new AppError(401, 'UNAUTHENTICATED', 'Session absente ou expirée');

//compare against when no usable hash exists
const dummyHash = hashPassword('dummy-password'); 

// POST /auth/login
export async function login({ email, password }: LoginInput) {
    const user = await prisma.user.findUnique({
        where: { email }, 
        select: { ...userSelect, passwordHash: true, deletedAt: true },
    }); 

    const hash = user && !user.deletedAt && user.passwordHash ? user.passwordHash : await dummyHash; //we hash the dummy if anything not going well
    const valid = await verifyPassword(password, hash); 

    if (!user || user.deletedAt || !user.passwordHash || !valid) throw invalidCredentials(); 

    const { passwordHash, deletedAt, ...profile } = user; 
    if (deletedAt || !passwordHash) throw invalidCredentials(); 
 
    return { 
        accessToken: signAccessToken({ id: user.id, role: user.role }), 
        refreshToken: await issueRefreshToken(user.id),
        user: toFullUser(profile), 
    }; 
}

// POST /auth/refresh
export async function refresh(refreshToken: unknown) {
    if (typeof refreshToken !== 'string') throw invalidSession(); 

    const row = await prisma.refreshToken.findUnique({
        where: { tokenHash: hashToken(refreshToken) }, 
        include: {
            user: {
                select: {
                    id: true, 
                    role: true, 
                    deletedAt: true
                }
            }
        }
    });

    if (!row || row.revokedAt || row.expiresAt < new Date() || row.user.deletedAt) throw invalidSession();

    // Revoke the old token and issue the new one as a single unit:
    // if the insert fails, PostgreSQL rolls the revocation back and the old token stays valid
    const newRefreshToken = await prisma.$transaction(async tx => {
        // revokedAt: null in the filter: of two concurrent refreshes, only one gets count === 1
        const revoked = await tx.refreshToken.updateMany({
            where: { id: row.id, revokedAt: null },
            data: { revokedAt: new Date() }
        });

        if (revoked.count !== 1) throw invalidSession();

        return issueRefreshToken(row.user.id, tx);
    });

    return {
        accessToken: signAccessToken({ id: row.user.id, role: row.user.role }),
        refreshToken: newRefreshToken,
    };
}

// POST /auth/logout: never fails
export async function logout(refreshToken: unknown) {
    if (typeof refreshToken !== 'string') return; 

    await prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(refreshToken), revokedAt: null }, 
        data: { revokedAt: new Date() },
    }); 
} 

// GET /auth/me
export async function getMe(userId: string) {
    const user = await prisma.user.findUnique({
        where: { id: userId }, 
        select: { ...userSelect, deletedAt: true },
    }); 

    if (!user) throw invalidSession(); 

    const { deletedAt, ...profile } = user;

    if (deletedAt) throw invalidSession(); 

    return toFullUser(profile); 
}