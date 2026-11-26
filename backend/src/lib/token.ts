import crypto from 'node:crypto'; 

export const hashToken = (token: string) => 
    crypto.createHash('sha256').update(token).digest('hex'); 

// The token generation duplicated in auth.service.ts and user.service.ts before the commit
export const generateToken = () => crypto.randomBytes(32).toString('base64url'); 

// Refresh token
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// The contract sets no lifetime: a reset link is used right away and can be requested again 
// 15 minutes; the account setup link keeps 72 hours
export const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
