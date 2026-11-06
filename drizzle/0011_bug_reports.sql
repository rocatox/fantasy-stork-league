CREATE TABLE bug_reports (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 title TEXT NOT NULL,
 area TEXT NOT NULL,
 description TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','reviewed','resolved'))
);
CREATE INDEX bug_reports_user_time ON bug_reports(user_id,created_at);
CREATE INDEX bug_reports_time ON bug_reports(created_at);
