import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

import { env } from "../../config/env";
import { upsertVectors, queryVectors } from "./ai.pinecone";

let anthropicClient: Anthropic | null = null;
let geminiClient: GoogleGenerativeAI | null = null;

function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    if (!env.anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }
    anthropicClient = new Anthropic({ apiKey: env.anthropicApiKey });
  }
  return anthropicClient;
}

function getGemini(): GoogleGenerativeAI {
  if (!geminiClient) {
    if (!env.geminiApiKey) {
      throw new Error("GEMINI_API_KEY is not configured");
    }
    geminiClient = new GoogleGenerativeAI(env.geminiApiKey);
  }
  return geminiClient;
}

type AiProvider = "anthropic" | "gemini";

function getAiProvider(): AiProvider {
  const provider = env.aiProvider.toLowerCase();
  return provider === "gemini" ? "gemini" : "anthropic";
}

const EMBEDDING_DIMENSION = 1024;

/**
 * Generate a simple hash-based embedding for text.
 * For production, replace with a proper embedding model (e.g. OpenAI text-embedding-3-small).
 * This is a deterministic placeholder that enables the Pinecone pipeline to work end-to-end.
 */
export function generateSimpleEmbedding(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIMENSION).fill(0);
  const normalized = text.toLowerCase();

  for (let i = 0; i < normalized.length; i++) {
    const charCode = normalized.charCodeAt(i);
    const idx = (charCode * (i + 1)) % EMBEDDING_DIMENSION;
    vec[idx] += 1;
  }

  const magnitude = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0)) || 1;
  return vec.map((val) => val / magnitude);
}

export async function embedAndUpsertTask(task: {
  id: string;
  userId: string;
  userName: string;
  title: string;
  description?: string | null;
  type: string;
  platform?: string | null;
  status: string;
  createdAt: Date;
}) {
  const textToEmbed = [
    `Task: ${task.title}`,
    task.description ? `Description: ${task.description}` : "",
    `Type: ${task.type}`,
    task.platform ? `Platform: ${task.platform}` : "",
    `Status: ${task.status}`,
    `User: ${task.userName}`,
    `Date: ${task.createdAt.toISOString().split("T")[0]}`
  ]
    .filter(Boolean)
    .join(". ");

  const values = generateSimpleEmbedding(textToEmbed);

  await upsertVectors("tasks", [
    {
      id: task.id,
      values,
      metadata: {
        userId: task.userId,
        userName: task.userName,
        title: task.title,
        type: task.type,
        platform: task.platform ?? "",
        status: task.status,
        week: getIsoWeek(task.createdAt),
        createdAt: task.createdAt.toISOString()
      }
    }
  ]);
}

export async function semanticSearchTasks(
  query: string,
  filters?: { userId?: string; from?: string; to?: string },
  topK: number = 10
) {
  const vector = generateSimpleEmbedding(query);

  const filter: Record<string, unknown> = {};
  if (filters?.userId) {
    filter.userId = { $eq: filters.userId };
  }

  const results = await queryVectors("tasks", vector, topK, Object.keys(filter).length > 0 ? filter : undefined);
  return results.matches ?? [];
}

export async function embedAndUpsertAdhocWork(entry: {
  id: string;
  userId: string;
  userName: string;
  description: string;
  output?: string | null;
  effortHours?: number | null;
  createdAt: Date;
}) {
  const textToEmbed = [
    `Adhoc work: ${entry.description}`,
    entry.output ? `Output: ${entry.output}` : "",
    entry.effortHours != null ? `Effort: ${entry.effortHours} hours` : "",
    `User: ${entry.userName}`,
    `Date: ${entry.createdAt.toISOString().split("T")[0]}`
  ]
    .filter(Boolean)
    .join(". ");

  const values = generateSimpleEmbedding(textToEmbed);

  await upsertVectors("adhoc-work", [
    {
      id: entry.id,
      values,
      metadata: {
        userId: entry.userId,
        userName: entry.userName,
        title: entry.description,
        type: "ADHOC",
        platform: "",
        status: "LOGGED",
        output: entry.output ?? "",
        effortHours: entry.effortHours ?? 0,
        week: getIsoWeek(entry.createdAt),
        createdAt: entry.createdAt.toISOString()
      }
    }
  ]);
}

export async function semanticSearchAdhocWork(
  query: string,
  filters?: { userId?: string },
  topK: number = 5
) {
  const vector = generateSimpleEmbedding(query);

  const filter: Record<string, unknown> = {};
  if (filters?.userId) {
    filter.userId = { $eq: filters.userId };
  }

  const results = await queryVectors(
    "adhoc-work",
    vector,
    topK,
    Object.keys(filter).length > 0 ? filter : undefined
  );
  return results.matches ?? [];
}

export async function embedAndUpsertWorkUnit(unit: {
  id: string;
  userId: string;
  userName: string;
  title: string;
  context: string;
  status: string;
  isPrivate: boolean;
  steps: Array<{ description: string; deadline: Date | null }>;
  createdAt: Date;
}) {
  const textToEmbed = [
    `Work: ${unit.title}`,
    `Context: ${unit.context}`,
    `Status: ${unit.status}`,
    unit.steps.length
      ? `Next steps: ${unit.steps
          .map(
            (s) =>
              s.description + (s.deadline ? ` (by ${s.deadline.toISOString().split("T")[0]})` : "")
          )
          .join("; ")}`
      : "",
    `User: ${unit.userName}`,
    `Date: ${unit.createdAt.toISOString().split("T")[0]}`
  ]
    .filter(Boolean)
    .join(". ");

  const values = generateSimpleEmbedding(textToEmbed);

  await upsertVectors("work-units", [
    {
      id: unit.id,
      values,
      metadata: {
        userId: unit.userId,
        userName: unit.userName,
        title: unit.title,
        type: "WORK",
        status: unit.status,
        isPrivate: unit.isPrivate,
        week: getIsoWeek(unit.createdAt),
        createdAt: unit.createdAt.toISOString()
      }
    }
  ]);
}

export async function semanticSearchWorkUnits(
  query: string,
  filters?: { userId?: string },
  topK: number = 5
) {
  const vector = generateSimpleEmbedding(query);

  const filter: Record<string, unknown> = {
    isPrivate: { $eq: false }
  };
  if (filters?.userId) {
    filter.userId = { $eq: filters.userId };
  }

  const results = await queryVectors("work-units", vector, topK, filter);
  return results.matches ?? [];
}

// Sentinel "never expires" marker for closed/historical periods so a single
// numeric `$gt: now` filter works for both expiring and permanent cache rows.
export const NEVER_EXPIRES_MS = 8640000000000000; // max safe JS Date in ms

export async function embedAndUpsertAiQuery(entry: {
  id: string;
  requesterId: string;
  normalizedQuery: string;
  scope: "user" | "team";
  targetUserId?: string | null;
  rangeFrom: Date;
  rangeTo: Date;
  expiresAt?: Date | null;
  createdAt: Date;
}) {
  const values = generateSimpleEmbedding(entry.normalizedQuery);

  await upsertVectors("ai-queries", [
    {
      id: entry.id,
      values,
      metadata: {
        aiQueryId: entry.id,
        requesterId: entry.requesterId,
        scope: entry.scope,
        targetUserId: entry.targetUserId ?? "",
        rangeFromMs: entry.rangeFrom.getTime(),
        rangeToMs: entry.rangeTo.getTime(),
        expiresAtMs: entry.expiresAt ? entry.expiresAt.getTime() : NEVER_EXPIRES_MS,
        normalizedQuery: entry.normalizedQuery,
        createdAtMs: entry.createdAt.getTime()
      }
    }
  ]);
}

/**
 * Find a semantically-similar, non-expired cached answer for the EXACT same
 * resolved date range, scope, and subject. Returns the matching AiQuery id and
 * similarity score, or null when no candidate clears the threshold.
 */
export async function semanticSearchAiQueryCache(params: {
  normalizedQuery: string;
  scope: "user" | "team";
  targetUserId?: string | null;
  rangeFrom: Date;
  rangeTo: Date;
  minScore: number;
  now?: Date;
}): Promise<{ aiQueryId: string; score: number } | null> {
  const nowMs = (params.now ?? new Date()).getTime();
  const vector = generateSimpleEmbedding(params.normalizedQuery);

  const filter: Record<string, unknown> = {
    scope: { $eq: params.scope },
    targetUserId: { $eq: params.targetUserId ?? "" },
    rangeFromMs: { $eq: params.rangeFrom.getTime() },
    rangeToMs: { $eq: params.rangeTo.getTime() },
    expiresAtMs: { $gt: nowMs }
  };

  const results = await queryVectors("ai-queries", vector, 3, filter);
  const top = (results.matches ?? [])[0];
  if (!top || typeof top.score !== "number" || top.score < params.minScore) {
    return null;
  }

  const aiQueryId = top.metadata?.aiQueryId;
  if (typeof aiQueryId !== "string") return null;
  return { aiQueryId, score: top.score };
}

type IdeaEmbeddingInput = {
  id: string;
  authorId: string;
  authorName: string;
  title: string;
  description: string;
  tags?: string[];
  createdAt: Date;
};

type IdeaSearchInput = {
  title: string;
  description: string;
  tags?: string[];
  authorName?: string;
  createdAt?: Date;
};

function buildIdeaText(input: IdeaSearchInput): string {
  return [
    `Idea: ${input.title}`,
    `Description: ${input.description}`,
    input.tags && input.tags.length > 0 ? `Tags: ${input.tags.join(", ")}` : "",
    input.authorName ? `Author: ${input.authorName}` : "",
    input.createdAt ? `Date: ${input.createdAt.toISOString().split("T")[0]}` : ""
  ]
    .filter(Boolean)
    .join(". ");
}

export async function embedAndUpsertIdea(idea: IdeaEmbeddingInput) {
  const textToEmbed = buildIdeaText({
    title: idea.title,
    description: idea.description,
    tags: idea.tags,
    authorName: idea.authorName,
    createdAt: idea.createdAt
  });
  const values = generateSimpleEmbedding(textToEmbed);

  await upsertVectors("ideas", [
    {
      id: idea.id,
      values,
      metadata: {
        ideaId: idea.id,
        authorId: idea.authorId,
        authorName: idea.authorName,
        title: idea.title,
        description: idea.description,
        tags: (idea.tags ?? []).join(","),
        createdAt: idea.createdAt.toISOString()
      }
    }
  ]);
}

export async function semanticSearchIdeas(query: IdeaSearchInput | string, topK: number = 25) {
  const textToEmbed =
    typeof query === "string"
      ? query
      : buildIdeaText({
          title: query.title,
          description: query.description,
          tags: query.tags,
          authorName: query.authorName,
          createdAt: query.createdAt
        });

  const vector = generateSimpleEmbedding(textToEmbed);
  const results = await queryVectors("ideas", vector, topK);
  return results.matches ?? [];
}

export async function generatePerformanceReport(context: {
  userName: string;
  query: string;
  tasks: Array<{
    title: string;
    type: string;
    platform?: string | null;
    status: string;
    contentUrl?: string | null;
    metadata?: string | null;
    createdAt: Date;
    completedAt?: Date | null;
  }>;
  stats?: {
    totalTasks: number;
    completed: number;
    inProgress: number;
    pending: number;
    byPlatform: Record<string, number>;
  };
  socialStats?: Array<{
    source: string;
    engagement: number;
    estimatedViews: number;
    estimatedReach: number;
  }>;
  semanticContext?: Array<{ title: string; type: string; platform: string }>;
  adhocWork?: Array<{
    description: string;
    output?: string | null;
    effortHours?: number | null;
    createdAt: Date;
  }>;
  adhocStats?: {
    totalEntries: number;
    totalEffortHours: number;
  };
  workUnits?: Array<{
    title: string;
    context: string;
    status: string;
    steps: Array<{ description: string; deadline: Date | null }>;
    createdAt: Date;
  }>;
  workStats?: {
    totalUnits: number;
    openUnits: number;
    closedUnits: number;
    upcomingDeadlines: number;
  };
}) {
  const tasksList = context.tasks
    .map(
      (t) =>
        `- [${t.status}] "${t.title}" (${t.type}${t.platform ? `, ${t.platform}` : ""}) created ${t.createdAt.toISOString().split("T")[0]}${t.completedAt ? `, completed ${t.completedAt.toISOString().split("T")[0]}` : ""}${t.contentUrl ? ` | URL: ${t.contentUrl}` : ""}${formatInstagramTaskStats(t.metadata)}`
    )
    .join("\n");

  const adhocList = (context.adhocWork ?? [])
    .map((entry) => {
      const parts = [`- "${entry.description}"`];
      if (entry.output) parts.push(`output: ${entry.output}`);
      if (entry.effortHours != null) parts.push(`${entry.effortHours} hrs`);
      parts.push(`logged ${entry.createdAt.toISOString().split("T")[0]}`);
      return parts.join(" | ");
    })
    .join("\n");

  const statsSection = context.stats
    ? `
Task Statistics:
- Total: ${context.stats.totalTasks}
- Completed: ${context.stats.completed}
- In Progress: ${context.stats.inProgress}
- Pending: ${context.stats.pending}
- By Platform: ${Object.entries(context.stats.byPlatform).map(([k, v]) => `${k}: ${v}`).join(", ") || "N/A"}`
    : "";

  const adhocStatsSection = context.adhocStats
    ? `
Adhoc Work Statistics:
- Total entries: ${context.adhocStats.totalEntries}
- Total effort hours: ${context.adhocStats.totalEffortHours}`
    : "";

  const workList = (context.workUnits ?? [])
    .map((unit) => {
      const stepParts = unit.steps
        .map(
          (step) =>
            step.description +
            (step.deadline ? ` (by ${step.deadline.toISOString().split("T")[0]})` : "")
        )
        .join("; ");
      return `- [${unit.status}] "${unit.title}" | ${unit.context}${stepParts ? ` | next: ${stepParts}` : ""}`;
    })
    .join("\n");

  const workStatsSection = context.workStats
    ? `
Work Unit Statistics:
- Total units: ${context.workStats.totalUnits}
- Open: ${context.workStats.openUnits}
- Closed: ${context.workStats.closedUnits}
- Upcoming deadlines: ${context.workStats.upcomingDeadlines}`
    : "";

  const socialSection =
    context.socialStats && context.socialStats.length > 0
      ? `
Content Performance (from social media):
${context.socialStats.map((s) => `- ${s.source}: ${s.estimatedViews} views, ${s.estimatedReach} reach, ${s.engagement} engagement`).join("\n")}`
      : "";

  const systemPrompt =
    "You are a concise team performance analyst. Produce a short, scannable report (max ~200 words) with these sections in order: " +
    "1) **Summary** (1–2 sentences), 2) **Highlights** (bullet list of concrete accomplishments), " +
    "3) **Metrics** (bullet list of the key numbers), 4) **Concerns / Next Steps** (only if relevant). " +
    "Include adhoc work (tasks logged outside content nodes) alongside regular tasks when summarizing accomplishments and effort. " +
    "Include work units (open/closed tasks with next steps and deadlines) and call out upcoming deadlines when relevant. " +
    "Do not repeat the raw task list. Skip a section if there is nothing meaningful to say. Use markdown.";

  const userPrompt = `Query: "${context.query}"

Report for: ${context.userName}

Tasks:
${tasksList || "No tasks found for this period."}

Adhoc Work:
${adhocList || "No adhoc work logged for this period."}

Work Units:
${workList || "No work units found for this period."}
${statsSection}
${adhocStatsSection}
${workStatsSection}
${socialSection}`;

  const provider = getAiProvider();
  if (provider === "gemini") {
    const model = getGemini().getGenerativeModel({
      model: env.geminiModel,
      systemInstruction: systemPrompt,
      generationConfig: { maxOutputTokens: 1024, temperature: 0.3 }
    });
    const result = await model.generateContent(userPrompt);
    return result.response.text() || "Unable to generate report.";
  }

  const response = await getAnthropic().messages.create({
    model: env.anthropicModel,
    max_tokens: 1024,
    temperature: 0.3,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }]
  });

  const textBlock = response.content.find((block) => block.type === "text");
  return textBlock?.text ?? "Unable to generate report.";
}

function formatInstagramTaskStats(metadata?: string | null): string {
  if (!metadata) {
    return "";
  }

  try {
    const parsed = JSON.parse(metadata) as {
      instagramStats?: {
        likes?: number | null;
        comments?: number | null;
        views?: number | null;
        plays?: number | null;
      };
    };

    const stats = parsed.instagramStats;
    if (!stats || typeof stats !== "object") {
      return "";
    }

    const parts: string[] = [];
    if (typeof stats.likes === "number") parts.push(`likes: ${stats.likes}`);
    if (typeof stats.comments === "number") parts.push(`comments: ${stats.comments}`);
    if (typeof stats.views === "number") parts.push(`views: ${stats.views}`);
    if (typeof stats.plays === "number") parts.push(`plays: ${stats.plays}`);

    return parts.length > 0 ? ` | Instagram stats (${parts.join(", ")})` : "";
  } catch {
    return "";
  }
}

function getIsoWeek(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum =
    1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}
