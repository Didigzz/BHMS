-- Already-boarding backfill (already-boarding-spec.md §4.1): an invisible
-- flag marking tenants entered via the Add Tenant modal's "Already boarding?"
-- toggle (moved in before the system was introduced). Default 0, so every
-- existing and normally-added tenant keeps the legacy behavior. The flag is
-- consumed ONLY by the recreated capacity trigger (v067) to skip the room
-- checks for backfilled inserts — no UI ever reads it.
ALTER TABLE tenants ADD COLUMN backfilled INTEGER NOT NULL DEFAULT 0;