# Node.js Backend with Meltwater Social APIs

Backend service with versioned + language-compatible APIs (`/:lang/v1`) that fetch, normalize,
store, and aggregate Instagram + LinkedIn + YouTube + Facebook performance data from Meltwater into PostgreSQL.

## Features

- Node.js + Express + TypeScript
- API versioning + language prefix (`/en/v1/...`)
- Meltwater integration for Instagram, LinkedIn, YouTube, and Facebook ingestion
- PostgreSQL persistence with Prisma ORM
- Metric aggregation for:
  - Mentions
  - Estimated Views (impressions)
  - Estimated Reach
  - Engagement Count
  - Engagement Rate (average)
  - Sentiment (positive/neutral/negative/unknown)
- Centralized error handling
- ESLint + Prettier + Jest setup

## API Endpoints

Base pattern:

`/{language}/v1/{resource}`

Instagram APIs:

- `POST /en/v1/instagram/sync`
  - Fetches from Meltwater, normalizes, and upserts into PostgreSQL
  - Optional body:
    ```json
    {
      "from": "2026-01-01T00:00:00.000Z",
      "to": "2026-01-31T23:59:59.999Z",
      "keyword": "your brand"
    }
    ```
- `GET /en/v1/instagram/aggregate?from=...&to=...`
  - Returns aggregated metrics and sentiment split
- `GET /en/v1/instagram/records?from=...&to=...`
  - Returns paginated normalized records (`page`, `pageSize`)

LinkedIn APIs:

- `POST /en/v1/linkedin/sync`
  - Fetches from Meltwater, normalizes, and upserts into PostgreSQL
- `GET /en/v1/linkedin/aggregate?from=...&to=...`
  - Returns aggregated metrics and sentiment split
- `GET /en/v1/linkedin/records?from=...&to=...`
  - Returns paginated normalized records (`page`, `pageSize`)

YouTube APIs:

- `POST /en/v1/youtube/sync`
  - Fetches from Meltwater, normalizes, and upserts into PostgreSQL
- `GET /en/v1/youtube/aggregate?from=...&to=...`
  - Returns aggregated metrics and sentiment split
- `GET /en/v1/youtube/records?from=...&to=...`
  - Returns paginated normalized records (`page`, `pageSize`)

Facebook APIs:

- `POST /en/v1/facebook/sync`
  - Fetches from Meltwater, normalizes, and upserts into PostgreSQL
- `GET /en/v1/facebook/aggregate?from=...&to=...`
  - Returns aggregated metrics and sentiment split
- `GET /en/v1/facebook/records?from=...&to=...`
  - Returns paginated normalized records (`page`, `pageSize`)

## Environment Variables

Copy and configure:

```bash
cp .env.example .env
```

Required:

- `DATABASE_URL` - PostgreSQL connection string
- `MELTWATER_BASE_URL` - Meltwater API host URL
- `MELTWATER_API_KEY` - Meltwater API token (sent as `apikey` header)
- `MELTWATER_OWNED_POSTS_ENDPOINT` - Meltwater owned posts endpoint
- `MELTWATER_ACCOUNT_IDS_INSTAGRAM` - owned Instagram account IDs (comma-separated)
- `MELTWATER_ACCOUNT_IDS_LINKEDIN` - owned LinkedIn account IDs (comma-separated)
- `MELTWATER_ACCOUNT_IDS_YOUTUBE` - owned YouTube account IDs (comma-separated)
- `MELTWATER_ACCOUNT_IDS_FACEBOOK` - owned Facebook account IDs (comma-separated)

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Generate Prisma client:

```bash
npm run prisma:generate
```

3. Create DB schema with migrations:

```bash
npm run prisma:migrate
```

4. Run dev server:

```bash
npm run dev
```

## Scripts

- `npm run dev` - Start dev server with auto-reload
- `npm run build` - Compile TypeScript
- `npm run start` - Run compiled app
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix lint issues
- `npm run format` - Run Prettier
- `npm test` - Run tests
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:migrate` - Create/apply Prisma migration

## Notes

- No authentication/authorization is enabled by design (per current requirement).
- Language validation is enforced via `SUPPORTED_LANGUAGES`.
