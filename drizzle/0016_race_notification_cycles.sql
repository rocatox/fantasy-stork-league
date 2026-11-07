-- Capture cycle membership atomically; existing queued events remain unchanged.
CREATE TABLE race_notification_cycles(id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, closed_at INTEGER);
CREATE UNIQUE INDEX race_notification_open ON race_notification_cycles((1)) WHERE closed_at IS NULL;
CREATE TABLE race_notification_cycle_leagues(cycle_id TEXT NOT NULL, league_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(cycle_id,league_id));
CREATE INDEX notification_outbox_league_order ON notification_outbox(json_extract(payload,'$.league.id'),id);
CREATE INDEX notification_outbox_cycle ON notification_outbox(json_extract(payload,'$.cycleId'));
CREATE TRIGGER notification_capture_cycle AFTER INSERT ON notification_outbox
 WHEN NEW.event_key NOT LIKE 'cycle-final:%'
 AND EXISTS(SELECT 1 FROM race_notification_cycles WHERE closed_at IS NULL)
 AND json_extract(NEW.payload,'$.league.status')='ready'
 BEGIN
 UPDATE notification_outbox SET payload=json_set(payload,'$.cycleId',(SELECT id FROM race_notification_cycles WHERE closed_at IS NULL)) WHERE id=NEW.id;
 END;
