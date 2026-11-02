import { z } from 'zod'; 
import { paginationSchema } from './common.schema';

export const createTeamSchema = z.object({
    name: z.string().trim().min(1).max(100), 
    description: z.string().trim().max(500).optional(), 
    managerId: z.uuidv4().optional(),
}); 

//GET /api/v1/teams?pages=2&limit=10&search=support
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
export type UpdateTeamSchema = z.infer<typeof updateTeamSchema>;  