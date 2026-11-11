-- Shared, durable in-app events avoid per-player fanout during study imports.
CREATE TABLE stork_notification_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 event_key TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL,
 payload TEXT NOT NULL
);
CREATE INDEX stork_notification_age ON stork_notification_events(created_at);
