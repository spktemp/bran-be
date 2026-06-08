import dotenv from "dotenv";

dotenv.config({ quiet: true });

const rawPort = process.env.PORT ?? "3000";
const parsedPort = Number(rawPort);

if (Number.isNaN(parsedPort)) {
  throw new Error("PORT must be a valid number");
}

function buildDatabaseUrlFromParts(): string {
  const host = process.env.DB_HOST;
  const dbPort = process.env.DB_PORT;
  const dbName = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;

  if (!host || !dbPort || !dbName || !user || !password) {
    return "";
  }

  return (
    `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}` +
    `@${host}:${dbPort}/${encodeURIComponent(dbName)}`
  );
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parsedPort,
  databaseUrl: buildDatabaseUrlFromParts() || process.env.DATABASE_URL || "",
  meltwaterBaseUrl: process.env.MELTWATER_BASE_URL ?? "",
  meltwaterApiKey: process.env.MELTWATER_API_KEY ?? "",
  meltwaterOwnedPostsEndpoint:
    process.env.MELTWATER_OWNED_POSTS_ENDPOINT ??
    process.env.MELTWATER_INSTAGRAM_ENDPOINT ??
    "/v3/owned/accounts/posts/top_posts",
  meltwaterAccountIdsInstagram: (() => {
    const direct = parseCsv(process.env.MELTWATER_ACCOUNT_IDS_INSTAGRAM);
    return direct.length > 0 ? direct : parseCsv(process.env.MELTWATER_ACCOUNT_IDS);
  })(),
  meltwaterAccountIdsLinkedin: parseCsv(process.env.MELTWATER_ACCOUNT_IDS_LINKEDIN),
  meltwaterAccountIdsYoutube: parseCsv(process.env.MELTWATER_ACCOUNT_IDS_YOUTUBE),
  meltwaterAccountIdsFacebook: parseCsv(process.env.MELTWATER_ACCOUNT_IDS_FACEBOOK),
  supportedLanguages: (process.env.SUPPORTED_LANGUAGES ?? "en")
    .split(",")
    .map((lang) => lang.trim().toLowerCase())
    .filter(Boolean),
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientIds: (() => {
    const fromCsv = parseCsv(process.env.GOOGLE_CLIENT_IDS);
    if (fromCsv.length > 0) {
      return fromCsv;
    }
    return process.env.GOOGLE_CLIENT_ID ? [process.env.GOOGLE_CLIENT_ID] : [];
  })(),
  jwtSecret: process.env.JWT_SECRET ?? "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  aiProvider: process.env.AI_PROVIDER ?? "gemini",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
  pineconeApiKey: process.env.PINECONE_API_KEY ?? "",
  pineconeIndex: process.env.PINECONE_INDEX ?? "bran-performance",
  sarvamApiKey: process.env.SARVAM_API_KEY ?? "",
  ideaMatchTopK: parsePositiveNumber(process.env.IDEA_MATCH_TOP_K, 25),
  ideaMatchThreshold: parsePositiveNumber(process.env.IDEA_MATCH_THRESHOLD, 0.6),
  ideaMatchMaxRecommendations: parsePositiveNumber(process.env.IDEA_MATCH_MAX_RECOMMENDATIONS, 5),
  ideaNotifyThreshold: parsePositiveNumber(process.env.IDEA_NOTIFY_THRESHOLD, 0.75),
  aiQueryCacheTtlMinutes: parsePositiveNumber(process.env.AI_QUERY_CACHE_TTL_MINUTES, 10),
  aiQueryCacheSemanticThreshold: parsePositiveNumber(
    process.env.AI_QUERY_CACHE_SEMANTIC_THRESHOLD,
    0.92
  ),
  apifyToken: process.env.APIFY_TOKEN ?? "",
  apifyInstagramActorId: process.env.APIFY_INSTAGRAM_ACTOR_ID ?? "apify/instagram-post-scraper",
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? "",
  instagramAccessToken: process.env.INSTAGRAM_ACCESS_TOKEN ?? "",
  appUrl: process.env.APP_URL ?? "",
  notificationsAdminEmail: process.env.NOTIFICATIONS_ADMIN_EMAIL ?? "admin@bran.app",
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? "587") || 587,
    secure: (process.env.SMTP_SECURE ?? "false").toLowerCase() === "true",
    user: process.env.SMTP_USER ?? "",
    password: process.env.SMTP_PASSWORD ?? "",
    from: process.env.SMTP_FROM ?? ""
  }
};
