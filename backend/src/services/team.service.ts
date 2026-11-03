import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import AppError from '../errors/AppError';
import { isTeamManager, Caller } from './scope.service';
import type { CreateTeamInput, ListTeamsQuery, UpdateTeamInput } from '../schemas/team.schema';

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

//P2002 on the team name
const isTeamNameTaken = (err: unknown) => {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false; 
    const target = err.meta?.target; 
    const fields = Array.isArray(target) ? target : [target]; 
    return fields.some(field => String(field).includes('name')); 
}; 

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

//verify if the user exist: 404 if not or anonymized
async function assertUserExist(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({
        where: { id: userId }, 
        select: { deletedAt: true }
    }); 

    if (!user || user.deletedAt) {
        throw new AppError(404, 'NOT_FOUND', 'Utilisateur introuvable'); 
    }
}

async function assertCanManageTeam(actor: Caller, teamId: string): Promise<void> {
    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true }}); 
    if (!team) {
        throw new AppError(404, 'NOT_FOUND', 'Équipe introuvable'); 
    }

    if (!(await isTeamManager(actor, teamId))) {
        throw new AppError(403, 'FORBIDDEN', "Seul le manager de l'équipe peut modifier l'équipe"); 
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
        if (isTeamNameTaken(err)) {
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

// GET /teams/:id -> members, any manager and the admin
export async function getTeam(actor: Caller, teamId: string) {
    const team = await prisma.team.findUnique({
        where: { id: teamId }, 
        select: teamSelect,
    }); 

    if (!team) {
        throw new AppError(404, 'NOT_FOUND', 'Équipe introuvable'); 
    }

    const isMember = team.members.some(member => member.user.id === actor.id); 
    if (actor.role === 'employee' && !isMember) {
        throw new AppError(403, 'FORBIDDEN', 'Vous ne faites pas partie de cette équipe'); 
    }

    return toTeam(team); 
} 

// PUT /teams/:id
export async function updateTeam(actor: Caller, teamId: string, input: UpdateTeamInput) {
    await assertCanManageTeam(actor, teamId); 
    await assertActiveManager(input.managerId);
    
    try {
        const team = await prisma.team.update({
            where: { id: teamId }, 
            data: input, 
            select: teamSelect,
        }); 
        return toTeam(team); 
    } catch (err) {
        if (isTeamNameTaken(err)) {
            throw new AppError(409, 'CONFLICT', 'Une équipe avec ce nom existe déjà'); 
        } 
        throw err; 
    }
}

//DELETE /teams/:id
export async function deleteTeam(actor: Caller, teamId: string): Promise<void> {
    await assertCanManageTeam(actor, teamId); 
    await prisma.team.delete({ where: { id: teamId }}); 
}

//add a member to a team PUT /teams/:id/members/:userId, idempotent
export async function addTeamMember(actor: Caller, teamId: string, userId: string): Promise<void> { 
    await assertCanManageTeam(actor, teamId); 
    await assertUserExist(userId);

    await prisma.teamMember.upsert({
        where: { teamId_userId: { teamId, userId } }, 
        create: { teamId, userId }, 
        update: {}, 
    }); 
}

//remove a member, DELETE /teams//:id/members/:userId -> the user account itself is untouched
export async function removeTeamMember(actor: Caller, teamId: string, userId: string): Promise<void> {
    await assertCanManageTeam(actor, teamId);
    await assertUserExist(userId);

    await prisma.teamMember.deleteMany({ where: { teamId, userId }}); 
}