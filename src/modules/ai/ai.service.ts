import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../utils/httpError";
import { findTasksByUserAndDateRange } from "../tasks/tasks.repository";
import { findAdhocWorkByUserAndDateRange } from "../adhoc-work/adhoc-work.repository";
import { findWorkUnitsByUserAndDateRange } from "../work/work.repository";
import {
  semanticSearchTasks,
  semanticSearchAdhocWork,
  semanticSearchWorkUnits,
  generatePerformanceReport,
  embedAndUpsertTask,
  embedAndUpsertAdhocWork,
  embedAndUpsertWorkUnit,
  embedAndUpsertAiQuery,
  semanticSearchAiQueryCache
} from "./ai.embeddings";
import {
  createAiQuery,
  findAiQueryById,
  findReusableAiQuery,
  listAiQueriesByUser,
  type AiQueryScope
} from "./ai.repository";

interface QueryIntent {
  userName: string | null;
  userId: string | null;
  scope: "user" | "team";
  timeRange: { from: Date; to: Date };
}

// ────────────────────────────────────────────────────────────────────────────
// User cache (60s) — avoids hitting the DB on every query just to match a name
// ────────────────────────────────────────────────────────────────────────────

interface CachedUser {
  id: string;
  name: string;
  email: string;
}

let userCache: { at: number; users: CachedUser[] } | null = null;
const USER_CACHE_TTL_MS = 60_000;

async function getActiveUsers(): Promise<CachedUser[]> {
  const now = Date.now();
  if (userCache && now - userCache.at < USER_CACHE_TTL_MS) {
    return userCache.users;
  }

  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true }
  });

  userCache = { at: now, users };
  return users;
}

async function resolveRequestingUser(
  userId: string,
  users: CachedUser[]
): Promise<CachedUser | null> {
  const cached = users.find((u) => u.id === userId);
  if (cached) return cached;

  // Already authenticated — resolve even if not in the active-user cache.
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true }
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Time-range parsing
// ────────────────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function parseTimeRange(query: string): { from: Date; to: Date } {
  const now = new Date();
  const lower = query.toLowerCase();

  // "past/last N days|weeks|months"
  const pastN = lower.match(/\b(?:past|last|previous)\s+(\d{1,3})\s*(day|days|week|weeks|month|months)\b/);
  if (pastN) {
    const n = Math.max(1, Math.min(365, Number.parseInt(pastN[1], 10)));
    const unit = pastN[2];
    const from = new Date(now);
    if (unit.startsWith("day")) from.setDate(now.getDate() - n);
    else if (unit.startsWith("week")) from.setDate(now.getDate() - n * 7);
    else from.setMonth(now.getMonth() - n);
    return { from: startOfDay(from), to: endOfDay(now) };
  }

  if (/\b(this|current)\s+week\b/.test(lower)) {
    const dayOfWeek = now.getDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const from = new Date(now);
    from.setDate(now.getDate() - diffToMonday);
    return { from: startOfDay(from), to: endOfDay(now) };
  }

  if (/\blast\s+week\b/.test(lower)) {
    const dayOfWeek = now.getDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const from = new Date(now);
    from.setDate(now.getDate() - diffToMonday - 7);
    const to = new Date(from);
    to.setDate(from.getDate() + 6);
    return { from: startOfDay(from), to: endOfDay(to) };
  }

  if (/\b(this|current)\s+month\b/.test(lower)) {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: startOfDay(from), to: endOfDay(now) };
  }

  if (/\blast\s+month\b/.test(lower)) {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: startOfDay(from), to: endOfDay(to) };
  }

  if (/\b(this|current)\s+(quarter|qtr)\b/.test(lower)) {
    const q = Math.floor(now.getMonth() / 3);
    const from = new Date(now.getFullYear(), q * 3, 1);
    return { from: startOfDay(from), to: endOfDay(now) };
  }

  if (/\b(this|current)\s+year\b/.test(lower)) {
    const from = new Date(now.getFullYear(), 0, 1);
    return { from: startOfDay(from), to: endOfDay(now) };
  }

  if (/\byesterday\b/.test(lower)) {
    const from = new Date(now);
    from.setDate(now.getDate() - 1);
    return { from: startOfDay(from), to: endOfDay(from) };
  }

  if (/\btoday\b/.test(lower)) {
    return { from: startOfDay(now), to: endOfDay(now) };
  }

  // Default: trailing 7 days
  const from = new Date(now);
  from.setDate(now.getDate() - 7);
  return { from: startOfDay(from), to: endOfDay(now) };
}

// ────────────────────────────────────────────────────────────────────────────
// Name extraction — matches against real user names from the DB
// ────────────────────────────────────────────────────────────────────────────

const TEAM_KEYWORDS = /\b(team|everyone|everybody|all\s+(?:users|members|staff|people)|whole\s+team|entire\s+team)\b/i;

const SELF_REFERENTIAL = /\b(i|me|my|myself|mine)\b/i;

function isSelfReferentialQuery(query: string): boolean {
  return SELF_REFERENTIAL.test(query);
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(s: string): string[] {
  return normalize(s).split(" ").filter(Boolean);
}

interface NameMatch {
  user: CachedUser;
  score: number;
}

/**
 * Score how well a user's name matches the query.
 * Higher score wins. We reward:
 *  - full-name substring matches (strongest signal)
 *  - multi-token matches (first + last name both present)
 *  - first-name token match (weakest, but common conversational style)
 */
function scoreUserAgainstQuery(user: CachedUser, queryTokens: Set<string>, normalizedQuery: string): number {
  const fullNameNorm = normalize(user.name);
  if (!fullNameNorm) return 0;

  // Strongest: full name appears verbatim in the query
  if (fullNameNorm.length >= 3 && normalizedQuery.includes(fullNameNorm)) {
    return 100 + fullNameNorm.length;
  }

  const nameTokens = fullNameNorm.split(" ").filter((t) => t.length >= 2);
  if (nameTokens.length === 0) return 0;

  let matched = 0;
  let totalLen = 0;
  for (const t of nameTokens) {
    if (queryTokens.has(t)) {
      matched += 1;
      totalLen += t.length;
    }
  }

  if (matched === 0) return 0;

  // All name tokens matched (e.g. first + last)
  if (matched === nameTokens.length && nameTokens.length > 1) {
    return 80 + totalLen;
  }

  // Single-token match — only count if the matched token is reasonably distinctive
  // (avoid matching common words; queryTokens already excludes these via stop-word filter)
  if (matched >= 1) {
    return 40 + totalLen;
  }

  return 0;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "for", "to", "in", "on", "at", "by",
  "with", "from", "about", "as", "is", "are", "was", "were", "be", "been", "being",
  "do", "did", "does", "doing", "done", "have", "has", "had", "having",
  "this", "that", "these", "those", "what", "how", "when", "where", "who", "why", "which",
  "show", "tell", "give", "get", "find", "list", "report", "summary", "summarize",
  "performance", "tasks", "task", "work", "progress", "update", "updates",
  "week", "weeks", "month", "months", "day", "days", "year", "years", "today", "yesterday",
  "team", "everyone", "everybody", "all", "members", "people", "staff",
  "instagram", "youtube", "facebook", "linkedin", "social", "media", "platform",
  "me", "you", "us", "we", "they", "them", "i", "my", "our", "their",
  "please", "can", "could", "would", "should", "make", "made", "do", "doing",
  "post", "posts", "content", "video", "videos", "reel", "reels", "story", "stories"
]);

function resolveUserFromQuery(query: string, users: CachedUser[]): CachedUser | null {
  const normalizedQuery = normalize(query);
  const queryTokens = new Set(
    tokenize(query).filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
  );

  if (queryTokens.size === 0 && !normalizedQuery) return null;

  let best: NameMatch | null = null;
  for (const user of users) {
    const score = scoreUserAgainstQuery(user, queryTokens, normalizedQuery);
    if (score > 0 && (!best || score > best.score)) {
      best = { user, score };
    }
  }

  return best?.user ?? null;
}

function parseQueryIntent(
  query: string,
  users: CachedUser[],
  requestingUser?: CachedUser | null
): QueryIntent {
  const timeRange = parseTimeRange(query);

  if (TEAM_KEYWORDS.test(query)) {
    return { userName: null, userId: null, scope: "team", timeRange };
  }

  // Self-referential queries ("what did I do…") always map to the requester.
  if (requestingUser && isSelfReferentialQuery(query)) {
    return {
      userName: requestingUser.name,
      userId: requestingUser.id,
      scope: "user",
      timeRange
    };
  }

  const user = resolveUserFromQuery(query, users);
  if (user) {
    return { userName: user.name, userId: user.id, scope: "user", timeRange };
  }

  // Authenticated chat default: no named subject → report for the requester.
  if (requestingUser) {
    return {
      userName: requestingUser.name,
      userId: requestingUser.id,
      scope: "user",
      timeRange
    };
  }

  return { userName: null, userId: null, scope: "user", timeRange };
}

// ────────────────────────────────────────────────────────────────────────────
// Main entry point
// ────────────────────────────────────────────────────────────────────────────

const MAX_TASKS_FOR_LLM = 40;
const MAX_ADHOC_FOR_LLM = 40;
const MAX_WORK_FOR_LLM = 40;

/**
 * Cache validity is keyed on the EXACT resolved date range. For ongoing
 * periods (range still includes today) the underlying data can change — e.g.
 * extra effort logged tomorrow — so we expire after a short TTL. For closed
 * periods (range fully in the past) the data is stable and reusable forever.
 * Different days resolve to different ranges, so a cached "this week" is never
 * reused once the week or day rolls over.
 */
function computeCacheExpiry(rangeTo: Date, now: Date = new Date()): Date | null {
  const startToday = startOfDay(now);
  if (rangeTo.getTime() < startToday.getTime()) {
    return null; // closed/historical period → stable
  }
  return new Date(now.getTime() + env.aiQueryCacheTtlMinutes * 60_000);
}

async function findCachedAnswer(params: {
  normalizedQuery: string;
  scope: AiQueryScope;
  targetUserId: string | null;
  rangeFrom: Date;
  rangeTo: Date;
}) {
  // Prefer the semantic global cache (matches reworded questions); fall back to
  // the exact DB lookup so repeats still hit when Pinecone is unavailable.
  try {
    const match = await semanticSearchAiQueryCache({
      normalizedQuery: params.normalizedQuery,
      scope: params.scope,
      targetUserId: params.targetUserId,
      rangeFrom: params.rangeFrom,
      rangeTo: params.rangeTo,
      minScore: env.aiQueryCacheSemanticThreshold
    });
    if (match) {
      const row = await findAiQueryById(match.aiQueryId);
      if (row && (!row.expiresAt || row.expiresAt.getTime() > Date.now())) {
        return row;
      }
    }
  } catch {
    // Pinecone not configured / unreachable — degrade to exact lookup.
  }

  return findReusableAiQuery({
    scope: params.scope,
    targetUserId: params.targetUserId,
    rangeFrom: params.rangeFrom,
    rangeTo: params.rangeTo,
    normalizedQuery: params.normalizedQuery
  });
}

async function persistAndIndexAiQuery(input: {
  requesterId: string | undefined;
  rawQuery: string;
  normalizedQuery: string;
  scope: AiQueryScope;
  targetUserId: string | null;
  targetName: string | null;
  rangeFrom: Date;
  rangeTo: Date;
  report: string;
  meta: Record<string, unknown>;
  cached: boolean;
  expiresAt: Date | null;
}): Promise<string | null> {
  if (!input.requesterId) return null;

  const saved = await createAiQuery({
    userId: input.requesterId,
    rawQuery: input.rawQuery,
    normalizedQuery: input.normalizedQuery,
    scope: input.scope,
    targetUserId: input.targetUserId,
    targetName: input.targetName,
    rangeFrom: input.rangeFrom,
    rangeTo: input.rangeTo,
    report: input.report,
    meta: input.meta,
    cached: input.cached,
    expiresAt: input.expiresAt
  });

  void embedAndUpsertAiQuery({
    id: saved.id,
    requesterId: saved.userId,
    normalizedQuery: input.normalizedQuery,
    scope: input.scope,
    targetUserId: input.targetUserId,
    rangeFrom: input.rangeFrom,
    rangeTo: input.rangeTo,
    expiresAt: input.expiresAt,
    createdAt: saved.createdAt
  }).catch((err) => console.error("[ai-index] Failed to index ai query:", saved.id, err));

  return saved.id;
}

export async function processAiQuery(query: string, requestingUserId?: string) {
  const rawQuery = query.trim();
  const normalizedQuery = rawQuery.toLowerCase();
  const users = await getActiveUsers();
  const requestingUser = requestingUserId
    ? await resolveRequestingUser(requestingUserId, users)
    : null;
  const intent = parseQueryIntent(rawQuery, users, requestingUser);

  if (intent.scope === "user" && !intent.userId) {
    const sample = users.slice(0, 5).map((u) => u.name).join(", ");
    throw new HttpError(
      400,
      `Could not identify a person in your query. Mention a name (e.g. "${sample || "Neha"}"), ask about yourself (e.g. "what did I do this week"), or ask about the "team".`
    );
  }

  const scope = intent.scope;
  const targetUserId = scope === "team" ? null : (intent.userId as string);
  const targetName = scope === "team" ? "Team" : (intent.userName as string);
  const { from: rangeFrom, to: rangeTo } = intent.timeRange;

  // ── Cache: reuse a prior answer for this exact range/scope/subject ────────
  const cachedRow = await findCachedAnswer({
    normalizedQuery,
    scope,
    targetUserId,
    rangeFrom,
    rangeTo
  });

  if (cachedRow) {
    const cachedMeta =
      cachedRow.meta != null ? (JSON.parse(cachedRow.meta) as Record<string, unknown>) : {};

    const queryId = await persistAndIndexAiQuery({
      requesterId: requestingUserId,
      rawQuery,
      normalizedQuery,
      scope,
      targetUserId,
      targetName,
      rangeFrom,
      rangeTo,
      report: cachedRow.report,
      meta: { ...cachedMeta, cached: true },
      cached: true,
      expiresAt: cachedRow.expiresAt
    });

    return {
      report: cachedRow.report,
      meta: { ...cachedMeta, cached: true, sourceQueryId: cachedRow.id, queryId }
    };
  }

  const userIds = scope === "team" ? users.map((u) => u.id) : [targetUserId as string];
  const displayName = targetName;

  // Fan out all I/O in parallel — this is the biggest win for latency.
  const [tasksByUser, adhocByUser, workByUser, socialStats, semanticContext] = await Promise.all([
    fetchTasksForUsers(userIds, rangeFrom, rangeTo),
    fetchAdhocWorkForUsers(userIds, rangeFrom, rangeTo),
    fetchWorkUnitsForUsers(userIds, rangeFrom, rangeTo, requestingUserId),
    fetchSocialStats(rangeFrom, rangeTo),
    fetchSemanticContext(normalizedQuery, scope === "user" ? (targetUserId as string) : undefined)
  ]);

  const tasks = tasksByUser.flat();
  const adhocWork = adhocByUser.flat();
  const workUnits = workByUser.flat();
  const stats = computeStats(tasks);
  const adhocStats = computeAdhocStats(adhocWork);
  const workStats = computeWorkStats(workUnits, rangeFrom, rangeTo);

  const report = await generatePerformanceReport({
    userName: displayName,
    query: rawQuery,
    tasks: tasks.slice(0, MAX_TASKS_FOR_LLM).map((t) => ({
      title: t.title,
      type: t.type,
      platform: t.platform,
      status: t.status,
      contentUrl: t.contentUrl,
      metadata: t.metadata,
      createdAt: t.createdAt,
      completedAt: t.completedAt
    })),
    adhocWork: adhocWork.slice(0, MAX_ADHOC_FOR_LLM).map((entry) => ({
      description: entry.description,
      output: entry.output,
      effortHours: entry.effortHours,
      createdAt: entry.createdAt
    })),
    workUnits: workUnits.slice(0, MAX_WORK_FOR_LLM).map((unit) => ({
      title: unit.title,
      context: unit.context,
      status: unit.status,
      steps: unit.steps.map((step) => ({
        description: step.description,
        deadline: step.deadline
      })),
      createdAt: unit.createdAt
    })),
    stats,
    adhocStats,
    workStats,
    socialStats,
    semanticContext
  });

  const meta = {
    user:
      scope === "user"
        ? { id: targetUserId, name: targetName }
        : { id: null, name: "team", memberCount: users.length },
    scope,
    timeRange: intent.timeRange,
    taskCount: tasks.length,
    adhocWorkCount: adhocWork.length,
    workUnitCount: workUnits.length,
    hadSemanticContext: semanticContext.length > 0,
    truncatedTasks: tasks.length > MAX_TASKS_FOR_LLM,
    truncatedAdhocWork: adhocWork.length > MAX_ADHOC_FOR_LLM,
    truncatedWorkUnits: workUnits.length > MAX_WORK_FOR_LLM
  };

  const expiresAt = computeCacheExpiry(rangeTo);
  const queryId = await persistAndIndexAiQuery({
    requesterId: requestingUserId,
    rawQuery,
    normalizedQuery,
    scope,
    targetUserId,
    targetName,
    rangeFrom,
    rangeTo,
    report,
    meta,
    cached: false,
    expiresAt
  });

  return {
    report,
    meta: { ...meta, cached: false, queryId }
  };
}

async function fetchTasksForUsers(userIds: string[], from: Date, to: Date) {
  // Cap fan-out so a "team" query against a huge org doesn't issue hundreds
  // of parallel queries — most teams will be small enough that this is a no-op.
  const CONCURRENCY = 8;
  const results: Awaited<ReturnType<typeof findTasksByUserAndDateRange>>[] = [];
  for (let i = 0; i < userIds.length; i += CONCURRENCY) {
    const batch = userIds.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((id) => findTasksByUserAndDateRange(id, from, to))
    );
    results.push(...batchResults);
  }
  return results;
}

async function fetchAdhocWorkForUsers(userIds: string[], from: Date, to: Date) {
  const CONCURRENCY = 8;
  const results: Awaited<ReturnType<typeof findAdhocWorkByUserAndDateRange>>[] = [];
  for (let i = 0; i < userIds.length; i += CONCURRENCY) {
    const batch = userIds.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((id) => findAdhocWorkByUserAndDateRange(id, from, to))
    );
    results.push(...batchResults);
  }
  return results;
}

async function fetchWorkUnitsForUsers(
  userIds: string[],
  from: Date,
  to: Date,
  requesterId?: string
) {
  const CONCURRENCY = 8;
  const results: Awaited<ReturnType<typeof findWorkUnitsByUserAndDateRange>>[] = [];
  for (let i = 0; i < userIds.length; i += CONCURRENCY) {
    const batch = userIds.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((id) => findWorkUnitsByUserAndDateRange(id, from, to))
    );
    results.push(...batchResults);
  }

  return results.map((units) =>
    units.filter((unit) => !unit.isPrivate || unit.userId === requesterId)
  );
}

async function fetchSocialStats(from: Date, to: Date) {
  return prisma.instagramPerformance.findMany({
    where: { mentionedAt: { gte: from, lte: to } },
    select: {
      source: true,
      engagement: true,
      estimatedViews: true,
      estimatedReach: true
    }
  });
}

async function fetchSemanticContext(
  query: string,
  userId?: string
): Promise<Array<{ title: string; type: string; platform: string }>> {
  try {
    const filters = userId ? { userId } : undefined;
    const [taskMatches, adhocMatches, workMatches] = await Promise.all([
      semanticSearchTasks(query, filters, 5),
      semanticSearchAdhocWork(query, filters, 5),
      semanticSearchWorkUnits(query, filters, 5)
    ]);

    const taskContext = taskMatches
      .filter((m) => m.metadata)
      .map((m) => ({
        title: String(m.metadata!.title ?? ""),
        type: String(m.metadata!.type ?? ""),
        platform: String(m.metadata!.platform ?? "")
      }));

    const adhocContext = adhocMatches
      .filter((m) => m.metadata)
      .map((m) => ({
        title: String(m.metadata!.title ?? ""),
        type: "ADHOC",
        platform: ""
      }));

    const workContext = workMatches
      .filter((m) => m.metadata)
      .map((m) => ({
        title: String(m.metadata!.title ?? ""),
        type: "WORK",
        platform: ""
      }));

    return [...taskContext, ...adhocContext, ...workContext];
  } catch {
    // Pinecone may not be configured / reachable; degrade gracefully.
    return [];
  }
}

function computeAdhocStats(entries: Array<{ effortHours: number | null }>) {
  return {
    totalEntries: entries.length,
    totalEffortHours: Number(
      entries.reduce((sum, entry) => sum + (entry.effortHours ?? 0), 0).toFixed(2)
    )
  };
}

function computeWorkStats(
  units: Array<{
    status: string;
    steps: Array<{ deadline: Date | null }>;
  }>,
  rangeFrom: Date,
  rangeTo: Date
) {
  let upcomingDeadlines = 0;

  for (const unit of units) {
    for (const step of unit.steps) {
      if (
        step.deadline &&
        step.deadline.getTime() >= rangeFrom.getTime() &&
        step.deadline.getTime() <= rangeTo.getTime()
      ) {
        upcomingDeadlines += 1;
      }
    }
  }

  return {
    totalUnits: units.length,
    openUnits: units.filter((u) => u.status === "OPEN").length,
    closedUnits: units.filter((u) => u.status === "CLOSED").length,
    upcomingDeadlines
  };
}

function computeStats(tasks: Array<{ status: string; platform?: string | null }>) {
  const stats = {
    totalTasks: tasks.length,
    completed: 0,
    inProgress: 0,
    pending: 0,
    byPlatform: {} as Record<string, number>
  };

  for (const t of tasks) {
    if (t.status === "COMPLETED") stats.completed += 1;
    else if (t.status === "IN_PROGRESS") stats.inProgress += 1;
    else if (t.status === "PENDING") stats.pending += 1;

    if (t.platform) {
      stats.byPlatform[t.platform] = (stats.byPlatform[t.platform] || 0) + 1;
    }
  }

  return stats;
}

export async function indexWorkUnitForSearch(unitId: string) {
  const unit = await prisma.workUnit.findUnique({
    where: { id: unitId },
    include: {
      user: { select: { id: true, name: true } },
      steps: true
    }
  });

  if (!unit) return;

  try {
    await embedAndUpsertWorkUnit({
      id: unit.id,
      userId: unit.userId,
      userName: unit.user.name,
      title: unit.title,
      context: unit.context,
      status: unit.status,
      isPrivate: unit.isPrivate,
      steps: unit.steps.map((step) => ({
        description: step.description,
        deadline: step.deadline
      })),
      createdAt: unit.createdAt
    });
  } catch (err) {
    console.error("[ai-index] Failed to index work unit:", unitId, err);
  }
}

export async function indexAdhocWorkForSearch(entryId: string) {
  const entry = await prisma.adhocWork.findUnique({
    where: { id: entryId },
    include: { user: { select: { id: true, name: true } } }
  });

  if (!entry) return;

  try {
    await embedAndUpsertAdhocWork({
      id: entry.id,
      userId: entry.userId,
      userName: entry.user.name,
      description: entry.description,
      output: entry.output,
      effortHours: entry.effortHours,
      createdAt: entry.createdAt
    });
  } catch (err) {
    console.error("[ai-index] Failed to index adhoc work:", entryId, err);
  }
}

export async function indexTaskForSearch(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { user: { select: { id: true, name: true } } }
  });

  if (!task) return;

  try {
    await embedAndUpsertTask({
      id: task.id,
      userId: task.userId,
      userName: task.user.name,
      title: task.title,
      description: task.description,
      type: task.type,
      platform: task.platform,
      status: task.status,
      createdAt: task.createdAt
    });
  } catch (err) {
    console.error("[ai-index] Failed to index task:", taskId, err);
  }
}

function parseStoredMeta(meta: string | null): unknown {
  if (!meta) return null;
  try {
    return JSON.parse(meta);
  } catch {
    return null;
  }
}

export async function listMyAiQueries(options: {
  userId: string;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 20));

  const { items, total } = await listAiQueriesByUser({ userId: options.userId, page, pageSize });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items: items.map((row) => ({
      id: row.id,
      query: row.rawQuery,
      scope: row.scope,
      target: row.targetUserId ? { id: row.targetUserId, name: row.targetName } : null,
      timeRange: { from: row.rangeFrom, to: row.rangeTo },
      report: row.report,
      meta: parseStoredMeta(row.meta),
      cached: row.cached,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt
    })),
    pagination: { page, pageSize, total, totalPages, hasNextPage: page < totalPages }
  };
}

export async function getMyAiQuery(id: string, userId: string) {
  const row = await findAiQueryById(id);
  if (!row || row.userId !== userId) {
    throw new HttpError(404, "Query not found");
  }
  return {
    id: row.id,
    query: row.rawQuery,
    scope: row.scope,
    target: row.targetUserId ? { id: row.targetUserId, name: row.targetName } : null,
    timeRange: { from: row.rangeFrom, to: row.rangeTo },
    report: row.report,
    meta: parseStoredMeta(row.meta),
    cached: row.cached,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt
  };
}

// Exported for tests
export function _parseQueryIntentForTests(
  query: string,
  users: CachedUser[],
  requestingUser?: CachedUser | null
): QueryIntent {
  return parseQueryIntent(query, users, requestingUser);
}

// Exported for tests / cache invalidation hooks
export function _invalidateUserCache() {
  userCache = null;
}
