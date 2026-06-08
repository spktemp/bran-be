import { prisma } from "../../lib/prisma";

export type AiQueryScope = "user" | "team";

export async function createAiQuery(data: {
  userId: string;
  rawQuery: string;
  normalizedQuery: string;
  scope: AiQueryScope;
  targetUserId?: string | null;
  targetName?: string | null;
  rangeFrom: Date;
  rangeTo: Date;
  report: string;
  meta?: unknown;
  cached?: boolean;
  expiresAt?: Date | null;
}) {
  return prisma.aiQuery.create({
    data: {
      userId: data.userId,
      rawQuery: data.rawQuery,
      normalizedQuery: data.normalizedQuery,
      scope: data.scope,
      targetUserId: data.targetUserId ?? null,
      targetName: data.targetName ?? null,
      rangeFrom: data.rangeFrom,
      rangeTo: data.rangeTo,
      report: data.report,
      meta: data.meta != null ? JSON.stringify(data.meta) : null,
      cached: data.cached ?? false,
      expiresAt: data.expiresAt ?? null
    }
  });
}

export async function findAiQueryById(id: string) {
  return prisma.aiQuery.findUnique({ where: { id } });
}

/**
 * Exact-match cache lookup. Matches a previously-saved answer for the SAME
 * resolved date range, scope, subject, and normalized query text — and only
 * if it has not expired. This works without Pinecone and is the reliable
 * fallback for the semantic cache.
 */
export async function findReusableAiQuery(params: {
  scope: AiQueryScope;
  targetUserId?: string | null;
  rangeFrom: Date;
  rangeTo: Date;
  normalizedQuery: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  return prisma.aiQuery.findFirst({
    where: {
      scope: params.scope,
      targetUserId: params.targetUserId ?? null,
      rangeFrom: params.rangeFrom,
      rangeTo: params.rangeTo,
      normalizedQuery: params.normalizedQuery,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
    },
    orderBy: { createdAt: "desc" }
  });
}

export async function listAiQueriesByUser(options: {
  userId: string;
  page: number;
  pageSize: number;
}) {
  const [items, total] = await Promise.all([
    prisma.aiQuery.findMany({
      where: { userId: options.userId },
      orderBy: { createdAt: "desc" },
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize
    }),
    prisma.aiQuery.count({ where: { userId: options.userId } })
  ]);

  return { items, total };
}
