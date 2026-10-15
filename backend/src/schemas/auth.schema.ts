import { z } from 'zod'; 

// POST /auth/login
export const loginSchema = z.object({
    //normalize
    email: z.string().trim().toLowerCase().max(255).pipe(z.email()),
    //we just check the password 
    password: z.string().min(1).max(128),
}); 

export type LoginInput = z.infer<typeof loginSchema>; 