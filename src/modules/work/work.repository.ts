import { Prisma } from "@prisma/client";

import { prisma } from "../../lib/prisma";

const userSelect = { id: true, name: true, email: true } as const;

const workUnitInclude = {
  user: { select: userSelect },
  steps: { orderBy: { deadline: "asc" as const } }
} as const;

function listOrderBy(status?: string): Prisma.WorkUnitOrderByWithRelationInput[] {
  if (status === "OPEN") {
    return [
      { nextDueAt: { sort: "asc", nulls: "last" } },
      { createdAt: "desc" }
    ];
  }

  if (status === "CLOSED") {
    return [
      { firstDueAt: { sort: "asc", nulls: "last" } },
      { closedAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" }
    ];
  }

  return [{ createdAt: "desc" }];
}

export async function createWorkUnit(data: {
  userId: string;
  title: string;
  context: string;
  status: string;
  isPrivate: boolean;
  closedAt?: Date | null;
  nextDueAt?: Date | null;
  firstDueAt?: Date | null;
  steps: Array<{ description: string; deadline?: Date | null; done?: boolean }>;
}) {
  return prisma.workUnit.create({
    data: {
      userId: data.userId,
      title: data.title,
      context: data.context,
      status: data.status,
      isPrivate: data.isPrivate,
      closedAt: data.closedAt ?? null,
      nextDueAt: data.nextDueAt ?? null,
      firstDueAt: data.firstDueAt ?? null,
      steps: {
        create: data.steps.map((step) => ({
          description: step.description,
          deadline: step.deadline ?? null,
          done: step.done ?? false
        }))
      }
    },
    include: workUnitInclude
  });
}

export async function findWorkUnitById(id: string) {
  return prisma.workUnit.findUnique({
    where: { id },
    include: workUnitInclude
  });
}

export async function findWorkUnits(options: {
  userId?: string;
  status?: string;
  from?: Date;
  to?: Date;
  isPrivateVisibleForUserId?: string;
  page: number;
  pageSize: number;
}) {
  const where: Record<string, unknown> = {};

  if (options.userId) where.userId = options.userId;
  if (options.status) where.status = options.status;

  if (options.from || options.to) {
    const dateFilter: Record<string, Date> = {};
    if (options.from) dateFilter.gte = options.from;
    if (options.to) dateFilter.lte = options.to;
    where.createdAt = dateFilter;
  }

  if (options.isPrivateVisibleForUserId) {
    where.OR = [
      { isPrivate: false },
      { userId: options.isPrivateVisibleForUserId }
    ];
  }

  const [items, total] = await Promise.all([
    prisma.workUnit.findMany({
      where,
      include: workUnitInclude,
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
      orderBy: listOrderBy(options.status)
    }),
    prisma.workUnit.count({ where })
  ]);

  return { items, total };
}

export async function updateWorkUnit(
  id: string,
  data: {
    title?: string;
    context?: string;
    status?: string;
    isPrivate?: boolean;
    closedAt?: Date | null;
    nextDueAt?: Date | null;
    firstDueAt?: Date | null;
    steps?: Array<{ description: string; deadline?: Date | null; done?: boolean }>;
  }
) {
  const { steps, ...scalarFields } = data;

  if (steps !== undefined) {
    await prisma.$transaction([
      prisma.workStep.deleteMany({ where: { workUnitId: id } }),
      prisma.workUnit.update({
        where: { id },
        data: {
          ...scalarFields,
          steps: {
            create: steps.map((step) => ({
              description: step.description,
              deadline: step.deadline ?? null,
              done: step.done ?? false
            }))
          }
        }
      })
    ]);
    return findWorkUnitById(id);
  }

  return prisma.workUnit.update({
    where: { id },
    data: scalarFields,
    include: workUnitInclude
  });
}

export async function deleteWorkUnit(id: string) {
  return prisma.workUnit.delete({ where: { id } });
}

export async function findWorkUnitsByUserAndDateRange(userId: string, from: Date, to: Date) {
  return prisma.workUnit.findMany({
    where: {
      userId,
      createdAt: { gte: from, lte: to }
    },
    include: workUnitInclude,
    orderBy: { createdAt: "desc" }
  });
}

export async function findWorkStepsByUserAndDeadlineRange(userId: string, from: Date, to: Date) {
  return prisma.workStep.findMany({
    where: {
      deadline: { gte: from, lte: to },
      workUnit: { userId }
    },
    include: {
      workUnit: {
        select: { id: true, title: true, status: true, isPrivate: true }
      }
    },
    orderBy: { deadline: "asc" }
  });
}
