import { z } from 'zod'; 

// Normalized so it matches the email stored in the database
export const emailSchema = z.string().trim().toLowerCase().max(255).pipe(z.email());

// POST /auth/login
export const loginSchema = z.object({
    email: emailSchema,
    //we just check the password 
    password: z.string().min(1).max(128),
});

// Contract, section 3: at least 12 characters; 128 max like the login
export const passwordSchema = z.string().min(12).max(128);

// PUT /auth/password
export const changePasswordSchema = z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
});

// POST /auth/password/forgot
export const forgotPasswordSchema = z.object({
    email: emailSchema,
});

// POST /auth/password/reset
export const resetPasswordSchema = z.object({
    token: z.string().min(1).max(256),
    newPassword: passwordSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
