import { prisma } from "../../lib/prisma";

const userSelect = { id: true, name: true, email: true } as const;

export async function createAdhocWork(data: {
  userId: string;
  description: string;
  output?: string;
  effortHours?: number;
}) {
  return prisma.adhocWork.create({
    data,
    include: { user: { select: userSelect } }
  });
}

export async function findAdhocWorkById(id: string) {
  return prisma.adhocWork.findUnique({
    where: { id },
    include: { user: { select: userSelect } }
  });
}

export async function findAdhocWorkEntries(options: {
  userId?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}) {
  const where: Record<string, unknown> = {};

  if (options.userId) where.userId = options.userId;

  if (options.from || options.to) {
    const dateFilter: Record<string, Date> = {};
    if (options.from) dateFilter.gte = options.from;
    if (options.to) dateFilter.lte = options.to;
    where.createdAt = dateFilter;
  }

  const [items, total] = await Promise.all([
    prisma.adhocWork.findMany({
      where,
      include: { user: { select: userSelect } },
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
      orderBy: { createdAt: "desc" }
    }),
    prisma.adhocWork.count({ where })
  ]);

  return { items, total };
}

export async function updateAdhocWork(
  id: string,
  data: {
    description?: string;
    output?: string | null;
    effortHours?: number | null;
  }
) {
  return prisma.adhocWork.update({
    where: { id },
    data,
    include: { user: { select: userSelect } }
  });
}

export async function deleteAdhocWork(id: string) {
  return prisma.adhocWork.delete({ where: { id } });
}

export async function findAdhocWorkByUserAndDateRange(userId: string, from: Date, to: Date) {
  return prisma.adhocWork.findMany({
    where: {
      userId,
      createdAt: { gte: from, lte: to }
    },
    include: { user: { select: userSelect } },
    orderBy: { createdAt: "desc" }
  });
}
