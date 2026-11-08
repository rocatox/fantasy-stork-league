-- Durable receipts survive identity deletion and prevent stale-session resurrection.
CREATE TABLE account_deletions (
 user_id TEXT PRIMARY KEY, alias TEXT NOT NULL UNIQUE, requested_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'cleanup' CHECK(status IN ('cleanup','clerk','complete')),
 stage INTEGER NOT NULL DEFAULT 0, cursor INTEGER NOT NULL DEFAULT 0,
 payload TEXT NOT NULL DEFAULT '{}', retry_at INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, completed_at INTEGER
);
CREATE INDEX account_deletions_work ON account_deletions(status,retry_at,requested_at);
CREATE TABLE account_deletion_lock(id INTEGER PRIMARY KEY CHECK(id=1),token TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TRIGGER deletion_guard_scout_lists_insert BEFORE INSERT ON scout_lists WHEN EXISTS(SELECT 1 FROM account_deletions WHERE user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'Account deletion in progress'); END;
CREATE TRIGGER deletion_guard_scout_lists_update BEFORE UPDATE ON scout_lists WHEN EXISTS(SELECT 1 FROM account_deletions WHERE user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'Account deletion in progress'); END;
CREATE TRIGGER deletion_guard_notification_accounts_insert BEFORE INSERT ON notification_accounts WHEN EXISTS(SELECT 1 FROM account_deletions WHERE user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'Account deletion in progress'); END;
CREATE TRIGGER deletion_guard_notification_accounts_update BEFORE UPDATE ON notification_accounts WHEN EXISTS(SELECT 1 FROM account_deletions WHERE user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'Account deletion in progress'); END;
CREATE TRIGGER deletion_guard_notification_email_queue_insert BEFORE INSERT ON notification_email_queue WHEN EXISTS(SELECT 1 FROM account_deletions WHERE user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'Account deletion in progress'); END;
CREATE TRIGGER deletion_guard_notification_email_queue_update BEFORE UPDATE ON notification_email_queue WHEN EXISTS(SELECT 1 FROM account_deletions WHERE user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'Account deletion in progress'); END;
CREATE TRIGGER deletion_guard_notification_email_batches_insert BEFORE INSERT ON notification_email_batches WHEN EXISTS(SELECT 1 FROM account_deletions WHERE user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'Account deletion in progress'); END;
CREATE TRIGGER deletion_guard_notification_email_batches_update BEFORE UPDATE ON notification_email_batches WHEN EXISTS(SELECT 1 FROM account_deletions WHERE user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'Account deletion in progress'); END;
CREATE TRIGGER deletion_guard_bug_reports_insert BEFORE INSERT ON bug_reports WHEN EXISTS(SELECT 1 FROM account_deletions WHERE user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'Account deletion in progress'); END;
CREATE TRIGGER deletion_guard_bug_reports_update BEFORE UPDATE ON bug_reports WHEN EXISTS(SELECT 1 FROM account_deletions WHERE user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'Account deletion in progress'); END;
CREATE TRIGGER deletion_guard_league_insert BEFORE INSERT ON leagues WHEN EXISTS(SELECT 1 FROM json_each(NEW.state,'$.members') m JOIN account_deletions d ON d.user_id=json_extract(m.value,'$.id')) BEGIN SELECT RAISE(ABORT,'A manager is being removed; retry shortly'); END;
CREATE TRIGGER deletion_guard_notifications_shared_insert BEFORE INSERT ON notification_accounts WHEN EXISTS(SELECT 1 FROM account_deletions d WHERE instr(NEW.payload,d.user_id)>0) BEGIN SELECT RAISE(ABORT,'Account details are being removed; retry shortly'); END;
CREATE TRIGGER deletion_guard_league_update BEFORE UPDATE ON leagues WHEN EXISTS(SELECT 1 FROM json_each(NEW.state,'$.members') m JOIN account_deletions d ON d.user_id=json_extract(m.value,'$.id')) BEGIN SELECT RAISE(ABORT,'A manager is being removed; retry shortly'); END;
CREATE TRIGGER deletion_guard_notifications_shared_update BEFORE UPDATE ON notification_accounts WHEN EXISTS(SELECT 1 FROM account_deletions d WHERE instr(NEW.payload,d.user_id)>0) BEGIN SELECT RAISE(ABORT,'Account details are being removed; retry shortly'); END;

-- Bounded identity reconciliation also covers deletion through Clerk's own UI.
CREATE TABLE account_registry(user_id TEXT PRIMARY KEY, checked_at INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO account_registry(user_id)
 SELECT json_extract(value,'$.id') FROM leagues,json_each(leagues.state,'$.members') WHERE json_extract(value,'$.deleted') IS NOT 1
 UNION SELECT user_id FROM notification_accounts UNION SELECT user_id FROM scout_lists UNION SELECT user_id FROM bug_reports;
CREATE TRIGGER account_registry_league_insert AFTER INSERT ON leagues BEGIN INSERT OR IGNORE INTO account_registry(user_id) SELECT json_extract(value,'$.id') FROM json_each(NEW.state,'$.members') WHERE json_extract(value,'$.deleted') IS NOT 1 AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE user_id=json_extract(value,'$.id')); END;
CREATE TRIGGER account_registry_league_update AFTER UPDATE ON leagues BEGIN INSERT OR IGNORE INTO account_registry(user_id) SELECT json_extract(value,'$.id') FROM json_each(NEW.state,'$.members') WHERE json_extract(value,'$.deleted') IS NOT 1 AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE user_id=json_extract(value,'$.id')); END;
CREATE TRIGGER account_registry_notification_accounts AFTER INSERT ON notification_accounts BEGIN INSERT OR IGNORE INTO account_registry(user_id) VALUES(NEW.user_id); END;
CREATE TRIGGER account_registry_scout_lists AFTER INSERT ON scout_lists BEGIN INSERT OR IGNORE INTO account_registry(user_id) VALUES(NEW.user_id); END;
CREATE TRIGGER account_registry_bug_reports AFTER INSERT ON bug_reports BEGIN INSERT OR IGNORE INTO account_registry(user_id) VALUES(NEW.user_id); END;
