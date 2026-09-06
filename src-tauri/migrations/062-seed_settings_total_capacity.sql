-- Sales Report (sales-report-spec.md §7): manual "total capacity" setting,
-- the denominator for the report's occupancy line. It is BEDS (rooms can be
-- shared; the app already treats capacity as bed slots), stored as a string
-- like house_name. Seeded with the current sum of room capacities so the
-- landlord gets a sensible starting number, then edits freely in Settings.
INSERT OR IGNORE INTO settings (key, value) VALUES ('total_capacity', (SELECT COALESCE(SUM(capacity), 0) FROM rooms));