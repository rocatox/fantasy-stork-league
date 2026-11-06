-- Email opt-in is captured atomically with the persisted notification account.
CREATE TABLE notification_email_queue (
 user_id TEXT NOT NULL, event_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', batch_id TEXT,
 PRIMARY KEY(user_id,event_id)
);
CREATE INDEX email_pending ON notification_email_queue(status,created_at,user_id);
CREATE TABLE notification_email_batches (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
 first_attempt_at INTEGER, retry_at INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'pending', provider_id TEXT
);
CREATE INDEX email_batch_pending ON notification_email_batches(status,retry_at);
CREATE TABLE notification_email_budget (period TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0);
CREATE TABLE notification_email_lock (id INTEGER PRIMARY KEY CHECK(id=1),token TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE INDEX notification_unsubscribe_token ON notification_accounts(json_extract(payload,'$.emailUnsubscribeToken'));
CREATE TRIGGER notification_email_capture_insert AFTER INSERT ON notification_accounts BEGIN
 INSERT INTO notification_email_queue(user_id,event_id,created_at,payload)
 SELECT NEW.user_id,json_extract(value,'$.id'),json_extract(value,'$.createdAt'),value
 FROM json_each(NEW.payload,'$.events')
 WHERE json_extract(value,'$.emailSuppressed')=0
 ON CONFLICT(user_id,event_id) DO NOTHING;
END;
CREATE TRIGGER notification_email_capture_update AFTER UPDATE ON notification_accounts BEGIN
 INSERT INTO notification_email_queue(user_id,event_id,created_at,payload)
 SELECT NEW.user_id,json_extract(value,'$.id'),json_extract(value,'$.createdAt'),value
 FROM json_each(NEW.payload,'$.events')
 WHERE json_extract(value,'$.emailSuppressed')=0
 ON CONFLICT(user_id,event_id) DO NOTHING;
END;
