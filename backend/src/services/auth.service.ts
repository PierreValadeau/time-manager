import prisma from '../lib/prisma';
import AppError from '../errors/AppError';
import { hashPassword, verifyPassword } from '../lib/password';
import { signAccessToken } from '../lib/jwt';
import { hashToken, generateToken, REFRESH_TOKEN_TTL_MS } from '../lib/token'; 
import type { LoginInput } from '../schemas/auth.schema';

async function issueRefreshToken(userId: string) {
    const token = generateToken(); 
    await prisma.refreshToken.create({
        data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) },
    }); 

    return token; 
}
//same error for every failure 
const invalidCredentials = () => 
    new AppError(401, 'UNAUTHENTICATED', 'Email ou mot de passe incorrect'); 

//compare against when no usable hash exists
const dummyHash = hashPassword('dummy-password'); 

// POST /auth/login
export async function login({ email, password }: LoginInput) {
    const user = await prisma.user.findUnique({
        where: { email }, 
        select: { id: true, firstName: true, lastName: true, email: true, role: true, passwordHash: true, deletedAt: true },
    }); 

    const hash = user && !user.deletedAt && user.passwordHash ? user.passwordHash : await dummyHash; //we hash the dummy if anything not going well
    const valid = await verifyPassword(password, hash); 

    if (!user || user.deletedAt || !user.passwordHash || !valid) throw invalidCredentials(); 
 
    return { 
        accessToken: signAccessToken({ id: user.id, role: user.role }), 
        refreshToken: await issueRefreshToken(user.id),
        user: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role }, 
    }; 
}