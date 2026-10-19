import type { CookieOptions } from 'express'; 
import {  ACCESS_TOKEN_TTL_SECONDS } from './jwt';
import { REFRESH_TOKEN_TTL_MS } from './token';

export const REFRESH_TOKEN_COOKIE = 'refresh_token'; 

const baseOptions: CookieOptions = {
    httpOnly: true, 
    secure: true, 
    sameSite: 'strict',
}

const accessCookieBase: CookieOptions = { ...baseOptions, path: '/' };
// for /auth/refresh and /auth/logout
const refreshCookieBase: CookieOptions = { ...baseOptions, path: '/api/v1/auth' };

export const accessCookieOptions: CookieOptions = {
    ...accessCookieBase,
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
};

export const refreshCookieOptions: CookieOptions = {
    ...refreshCookieBase,
    maxAge: REFRESH_TOKEN_TTL_MS,
};

// clearCookie must get the same path as when the cookie was set, without maxAge
export const clearAccessCookieOptions = accessCookieBase;
export const clearRefreshCookieOptions = refreshCookieBase;

