-- Add closedAt and denormalized due-date sort fields to WorkUnit
ALTER TABLE "WorkUnit" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);
ALTER TABLE "WorkUnit" ADD COLUMN IF NOT EXISTS "nextDueAt" TIMESTAMP(3);
ALTER TABLE "WorkUnit" ADD COLUMN IF NOT EXISTS "firstDueAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "WorkUnit_nextDueAt_idx" ON "WorkUnit"("nextDueAt");
CREATE INDEX IF NOT EXISTS "WorkUnit_firstDueAt_idx" ON "WorkUnit"("firstDueAt");
CREATE INDEX IF NOT EXISTS "WorkUnit_closedAt_idx" ON "WorkUnit"("closedAt");
