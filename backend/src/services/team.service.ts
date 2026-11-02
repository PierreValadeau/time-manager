import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import AppError from '../errors/AppError';
import type { Caller } from './scope.service';
import type { CreateTeamInput, ListTeamsQuery } from '../schemas/team.schema';

//Contract section 5
export const teamSelect = {
    id: true, 
    name: true, 
    description: true, 
    createdAt: true, 
    updatedAt: true, 
    manager: { select: { id: true, firstName: true, lastName: true } }, 
    members: { select: { user: { select : { id: true, firstName: true, lastName: true }}}}, 
} satisfies Prisma.TeamSelect; 

//List item contrat section 5 -> memberCount instead of members
export const teamListSelect = {
    id: true, 
    name: true, 
    description: true, 
    createdAt: true, 
    updatedAt: true, 
    manager: { select: { id: true, firstName: true, lastName: true }}, 
    _count: { select: { members: true }}, 
} satisfies Prisma.TeamSelect; 

type TeamRecord = Prisma.TeamGetPayload<{ select: typeof teamSelect }>; 
type TeamListRecord = Prisma.TeamGetPayload<{ select: typeof teamListSelect }>; 

export const toTeam = ({ members, ...team }: TeamRecord) => ({
    ...team, 
    members: members.map(member => member.user),
}); 

export const toTeamListItem = ({ _count, ...team }: TeamListRecord) => ({
    ...team, 
    memberCount: _count.members,
}); 

//filter
function teamListWhere(actor: Caller, search: string | undefined): Prisma.TeamWhereInput {
    const where: Prisma.TeamWhereInput = {}; 

    if (actor.role === 'employee') {
        where.members = { some: { userId: actor.id } }; 
    }

    if (search) {
        where.name = { contains: search, mode: 'insensitive' }; 
    }

    return where; 
}

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
        const team = await prisma.team.create({
            data: { ...input, managerId }, 
            select: teamSelect,
        }); 
        return toTeam(team); 
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            throw new AppError(409, 'CONFLICT', 'Une équipe avec ce nom existe déjà')
        }
        throw err; 
    }
}

//paginated sorted by name
export async function listTeams(actor: Caller, { page, limit, search }: ListTeamsQuery) {
    const where = teamListWhere(actor, search); 
    const skip = (page - 1) * limit; 

    const [rows, total] = await Promise.all([
        prisma.team.findMany({ where, select: teamListSelect, orderBy: { name: 'asc' }, skip, take: limit }), 
        prisma.team.count({ where }), 
    ]); 

    return { data: rows.map(toTeamListItem), meta: { page, limit, total } }; 
}