import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';

export type AccessTokenPayload = { id: string; role: UserRole };

// Name of the httpOnly cookie that carries the access token (set at login, read by authenticate)
export const ACCESS_TOKEN_COOKIE = 'access_token';

// Contract, section 1: the access token lives 15 minutes
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
// Pinned algorithm: a token claiming another one (e.g. "none") is rejected
const ALGORITHM = 'HS256';
const MIN_SECRET_LENGTH = 32;

// Read at call time so a missing or weak secret fails loudly instead of signing weak tokens
const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters long`);
  }
  return secret;
};

export function signAccessToken(user: AccessTokenPayload): string {
  return jwt.sign({ role: user.role }, getSecret(), {
    subject: user.id,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    algorithm: ALGORITHM,
  });
}

// Returns null for any invalid, expired or tampered token
export function verifyAccessToken(token: string): AccessTokenPayload | null {
  const secret = getSecret();
  let payload: string | jwt.JwtPayload;
  // Only token errors (bad signature, expired, malformed) mean "invalid token";
  // anything else must surface instead of silently rejecting every user
  try {
    payload = jwt.verify(token, secret, { algorithms: [ALGORITHM] });
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) return null;
    throw err;
  }
  if (typeof payload === 'string' || !payload.sub) return null;
  if (!Object.values(UserRole).includes(payload.role)) return null;
  return { id: payload.sub, role: payload.role };
}
