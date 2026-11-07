-- Dropped so v067 can recreate it with the backfilled-tenants bypass
-- (already-boarding-spec.md §4.2). The v054 INSERT-only trigger is replaced
-- wholesale; non-backfilled inserts keep exactly today's behavior.
DROP TRIGGER enforce_room_capacity;