CREATE TABLE IF NOT EXISTS notifications_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    due_date TEXT NOT NULL,
    notified_at TEXT NOT NULL,
    UNIQUE (tenant_id, kind, due_date)
);
