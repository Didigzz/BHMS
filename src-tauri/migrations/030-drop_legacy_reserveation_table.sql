-- Repair: drop a legacy table from an old build that misspelled
-- `reservations` as `reserveation`. If it ever existed, its rows are already
-- invisible to the app (nothing reads it) and unrecoverable — the current
-- build reads and writes `reservations` only.
DROP TABLE IF EXISTS reserveation;
