import { z } from 'zod'; 

export const createTeamSchema = z.object({
    name: z.string().trim().min(1).max(100), 
    description: z.string().trim().max(500).optional(), 
    managerId: z.uuidv4().optional(),
}); 

export type CreateTeamInput = z.infer<typeof createTeamSchema>; 