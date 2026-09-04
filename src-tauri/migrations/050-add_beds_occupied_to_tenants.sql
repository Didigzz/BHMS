-- Multi-bed occupancy (room-bed-view-spec): a tenant may occupy more than one
-- bed/slot in their room. DEFAULT 1 backfills every existing tenant to the
-- legacy behavior (one tenant = one bed). The room-capacity triggers below are
-- recreated (v054-056) to sum beds instead of counting people, and a new
-- UPDATE guard (v057) blocks raising a tenant's bed count past the room's
-- free beds.
ALTER TABLE tenants ADD COLUMN beds_occupied INTEGER NOT NULL DEFAULT 1;
