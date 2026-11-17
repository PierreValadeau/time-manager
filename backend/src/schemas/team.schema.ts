import { z } from 'zod'; 
import { paginationSchema } from './common.schema';

export const createTeamSchema = z.object({
    name: z.string().trim().min(1).max(100), 
    description: z.string().trim().max(500).optional(), 
    managerId: z.uuidv4().optional(),
}); 

export const listTeamsQuerySchema = paginationSchema
    .extend({
        search: z.string().trim().min(1).max(100).optional(),
    }); 

export const updateTeamSchema = z.object({
    name: z.string().trim().min(1).max(100), 
    description: z.string().trim().max(500).nullable(), 
    managerId: z.uuidv4(),
}); 

export type CreateTeamInput = z.infer<typeof createTeamSchema>; 
export type ListTeamsQuery = z.infer<typeof listTeamsQuerySchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;  