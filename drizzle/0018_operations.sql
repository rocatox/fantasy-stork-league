CREATE TABLE operational_alert_state (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE operational_email (
 id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, payload TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 first_attempt_at INTEGER, retry_at INTEGER NOT NULL DEFAULT 0, message TEXT, provider_id TEXT
);
CREATE INDEX operational_email_due ON operational_email(status,retry_at);
