import type { CookieOptions } from 'express'; 
import {  ACCESS_TOKEN_TTL_SECONDS } from './jwt';
import { REFRESH_TOKEN_TTL_MS } from './token';

export const REFRESH_TOKEN_COOKIE = 'refresh_token'; 

const baseOptions: CookieOptions = {
    httpOnly: true, 
    secure: true, 
    sameSite: 'strict',
}

export const accessCookieOptions: CookieOptions = {
    ...baseOptions, 
    path: '/', 
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000
}; 

//for /auth/refresh and /auth/logout 
export const refreshCookieOptions: CookieOptions = {
    ...baseOptions, 
    path: '/api/v1/auth', 
    maxAge: REFRESH_TOKEN_TTL_MS, 
}; 