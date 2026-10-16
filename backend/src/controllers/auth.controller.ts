import type { RequestHandler } from "express";
import { login, refresh } from '../services/auth.service'; 
import { ACCESS_TOKEN_COOKIE } from "../lib/jwt";
import { REFRESH_TOKEN_COOKIE, accessCookieOptions, refreshCookieOptions } from "../lib/cookie";

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