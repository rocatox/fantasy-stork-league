CREATE TABLE notification_accounts (
 user_id TEXT PRIMARY KEY,
 revision INTEGER NOT NULL DEFAULT 0,
 payload TEXT NOT NULL
);
