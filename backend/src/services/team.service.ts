import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import AppError from '../errors/AppError';
import type { Caller } from './scope.service';
import type { CreateTeamInput } from '../schemas/team.schema';

//verify if it's a manager -> contract: managerId defaults to the creator for a manager
function resolveManagerId(actor: Caller, managerId: string | undefined) {
    if (actor.role === 'admin') {
        if (!managerId) {
            throw new AppError(400, 'VALIDATION_ERROR', 'managerId est requis', [
                { field: 'managerId', issue: 'required' }, 
            ]); 
        }

        return managerId; 
    }

    return managerId ?? actor.id; 
} 

async function assertActiveManager(managerId: string): Promise<void> {
    const manager = await prisma.user.findUnique({
        where: { id: managerId }, 
        select: { role: true, deletedAt: true },
    }); 

    if (!manager || manager.deletedAt || manager.role !== 'manager') {
        throw new AppError(400, 'VALIDATION_ERROR', 'managerId doit désigner un manager actif', [
            {field: 'managerId', issue: 'invalid' }, 
        ]); 
    }
} 

export async function createTeam(actor: Caller, input: CreateTeamInput) {
    const managerId = resolveManagerId(actor, input.managerId); 
    await assertActiveManager(managerId); 

    try {
        return await prisma.team.create({
            data: { ...input, managerId }, 
        }); 
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            throw new AppError(409, 'CONFLICT', 'Une équipe avec ce nom existe déjà')
        }
        throw err; 
    }
}