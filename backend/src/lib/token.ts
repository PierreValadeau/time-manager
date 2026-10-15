import crypto from 'node:crypto'; 

export const hashToken = (token: string) => 
    crypto.createHash('sha256').update(token).digest('hex'); 

//the token generation duplicated in auth.service.ts and user.service.ts before the commit
export const generateToken = () => crypto.randomBytes(32).toString('base64url'); 

//refresh token
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; 
