CREATE TABLE bug_report_email (
 report_id TEXT PRIMARY KEY REFERENCES bug_reports(id),
 status TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0,
 first_attempt_at INTEGER,
 retry_at INTEGER NOT NULL DEFAULT 0,
 message TEXT,
 provider_id TEXT
);
CREATE INDEX bug_report_email_pending ON bug_report_email(status,retry_at);
CREATE TRIGGER bug_report_email_capture AFTER INSERT ON bug_reports BEGIN
 INSERT INTO bug_report_email(report_id) VALUES(NEW.id) ON CONFLICT(report_id) DO NOTHING;
END;
