import type { RequestHandler } from "express";
import AppError from '../errors/AppError';
import { login, refresh, logout, getMe } from '../services/auth.service'; 
import { ACCESS_TOKEN_COOKIE } from "../lib/jwt";
import { REFRESH_TOKEN_COOKIE, accessCookieOptions, clearAccessCookieOptions, clearRefreshCookieOptions, refreshCookieOptions } from "../lib/cookie";

//POST /auth/login
export const loginHandler: RequestHandler = async (req, res) => {
    const { accessToken, refreshToken, user } = await login(req.body); 
    res.cookie(ACCESS_TOKEN_COOKIE, accessToken, accessCookieOptions); 
    res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, refreshCookieOptions); 

    res.status(200).json(user); 
}

// POST /auth/refresh
export const refreshHandler: RequestHandler = async (req, res) => {
    const { accessToken, refreshToken } = await refresh(req.cookies?.[REFRESH_TOKEN_COOKIE]); 
    res.cookie(ACCESS_TOKEN_COOKIE, accessToken, accessCookieOptions); 
    res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, refreshCookieOptions); 

    res.sendStatus(204); 
}

// POST /auth/logout
export const logoutHandler: RequestHandler = async (req, res) => {
    await logout(req.cookies?.[REFRESH_TOKEN_COOKIE]); 
    res.clearCookie(ACCESS_TOKEN_COOKIE, clearAccessCookieOptions); 
    res.clearCookie(REFRESH_TOKEN_COOKIE, clearRefreshCookieOptions);

    res.sendStatus(204);
}

// GET /auth/me
export const meHandler: RequestHandler = async (req, res) => {
    // Mounted after authenticate: fail closed if it is ever missing
    if (!req.user) {
        throw new AppError(401, 'UNAUTHENTICATED', 'Session absente ou expirée');
    }
    res.status(200).json(await getMe(req.user.id));
}