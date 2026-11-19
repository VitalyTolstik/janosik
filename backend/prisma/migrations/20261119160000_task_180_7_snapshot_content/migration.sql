ALTER TABLE "BoardShare"
    ADD COLUMN "snapshotTakenAt" TIMESTAMP(3),
    ADD COLUMN "snapshotHasComments" BOOLEAN,
    ADD COLUMN "snapshotHasAttachments" BOOLEAN;

ALTER TABLE "BoardShareSnapshotBlob"
    ADD COLUMN "attachmentId" TEXT,
    ADD COLUMN "cardId" TEXT,
    ADD COLUMN "createdAt" TIMESTAMP(3),
    ADD COLUMN "isInline" BOOLEAN,
    ADD COLUMN "metadata" JSONB;

CREATE TABLE "BoardShareSnapshotComment" (
    "shareId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "BoardShareSnapshotComment_pkey" PRIMARY KEY ("shareId", "id")
);

CREATE UNIQUE INDEX "BoardShareSnapshotBlob_shareId_attachmentId_key" ON "BoardShareSnapshotBlob"("shareId", "attachmentId");
CREATE INDEX "BoardShareSnapshotBlob_shareId_cardId_isInline_createdAt_idx" ON "BoardShareSnapshotBlob"("shareId", "cardId", "isInline", "createdAt");
CREATE INDEX "BoardShareSnapshotComment_page_idx" ON "BoardShareSnapshotComment"("shareId", "cardId", "createdAt", "id");

ALTER TABLE "BoardShareSnapshotComment" ADD CONSTRAINT "BoardShareSnapshotComment_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "BoardShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Move already-captured content before slimming the board JSON. Older
-- board-only payloads keep null capture flags and the original time cutoff.
INSERT INTO "BoardShareSnapshotComment" ("shareId", "id", "cardId", "createdAt", "payload")
SELECT share."id", item->>'id', item->>'cardId',
       to_timestamp((item->>'createdAt')::double precision / 1000) AT TIME ZONE 'UTC', item
FROM "BoardShare" AS share
CROSS JOIN LATERAL jsonb_array_elements(share."snapshot"->'comments') AS item
WHERE share."mode" = 'snapshot';

UPDATE "BoardShareSnapshotBlob" AS blob
SET "attachmentId" = item->'meta'->>'id',
    "cardId" = item->'meta'->>'cardId',
    "createdAt" = to_timestamp((item->'meta'->>'createdAt')::double precision / 1000) AT TIME ZONE 'UTC',
    "isInline" = (item->>'isInline')::boolean,
    "metadata" = item->'meta'
FROM "BoardShare" AS share
CROSS JOIN LATERAL jsonb_array_elements(share."snapshot"->'attachments') AS item
WHERE blob."shareId" = share."id" AND blob."storedName" = item->>'storedName';

UPDATE "BoardShare"
SET "snapshotTakenAt" = CASE WHEN jsonb_typeof("snapshot"->'takenAt') = 'number'
        THEN to_timestamp(("snapshot"->>'takenAt')::double precision / 1000) AT TIME ZONE 'UTC'
        ELSE "createdAt" END,
    "snapshotHasComments" = CASE WHEN "snapshot" ?| ARRAY['comments', 'attachments']
        THEN "snapshot" ? 'comments' END,
    "snapshotHasAttachments" = CASE WHEN "snapshot" ?| ARRAY['comments', 'attachments']
        THEN "snapshot" ? 'attachments' END,
    "snapshot" = "snapshot" - 'comments' - 'attachments'
WHERE "mode" = 'snapshot' AND jsonb_typeof("snapshot") = 'object';

-- A board-only payload with both categories turned off is ambiguous across
-- older builds. The last capture audit records which categories were opted in
-- at capture. A later PATCH must not publish source content for an opt-out.
WITH captures AS (
    SELECT share."id", audit."details"
    FROM "BoardShare" AS share
    CROSS JOIN LATERAL (
        SELECT "details"
        FROM "BoardShareAuditLog"
        WHERE "shareId" = share."id" AND "action" IN ('created', 'refreshed')
        ORDER BY "createdAt" DESC, "id" DESC
        LIMIT 1
    ) AS audit
    WHERE share."mode" = 'snapshot'
        AND share."snapshotHasComments" IS NULL
        AND share."snapshotHasAttachments" IS NULL
)
UPDATE "BoardShare" AS share
SET "snapshotHasComments" = CASE WHEN captures."details"->'includeComments' = 'false'::jsonb THEN FALSE END,
    "snapshotHasAttachments" = CASE WHEN captures."details"->'includeAttachments' = 'false'::jsonb THEN FALSE END
FROM captures
WHERE share."id" = captures."id";

-- A preceding build could mark a retained dedicated board stopped. Reopen
-- those recorded runs for inspection and retry without inferring ownership.
UPDATE "DemoRun" AS run
SET "status" = 'stopping', "stoppedAt" = NULL
WHERE run."status" = 'stopped'
    AND run."manifest"->'createdBoard' = 'true'::jsonb
    AND run."manifest"->>'boardId' = run."boardId"
    AND EXISTS (SELECT 1 FROM "Board" WHERE "id" = run."boardId");
