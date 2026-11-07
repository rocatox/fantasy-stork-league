ALTER TABLE notification_email_queue ADD COLUMN queued_at INTEGER NOT NULL DEFAULT 0;
UPDATE notification_email_queue SET queued_at=created_at;
CREATE INDEX email_digest_pending ON notification_email_queue(status,batch_id,queued_at,user_id);
CREATE TRIGGER email_queue_received AFTER INSERT ON notification_email_queue BEGIN
 UPDATE notification_email_queue SET queued_at=unixepoch()*1000 WHERE user_id=NEW.user_id AND event_id=NEW.event_id;
END;
