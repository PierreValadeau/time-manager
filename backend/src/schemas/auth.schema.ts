import { z } from 'zod'; 

// POST /auth/login
export const loginSchema = z.object({
    //normalize
    email: z.string().trim().toLowerCase().max(255).pipe(z.email()),
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

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
