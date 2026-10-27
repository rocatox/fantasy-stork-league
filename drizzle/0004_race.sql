CREATE TABLE race_results (
 bird_id TEXT NOT NULL,
 year INTEGER NOT NULL,
 payload TEXT NOT NULL,
 PRIMARY KEY(bird_id, year)
);
CREATE TABLE race_audit (
 id TEXT PRIMARY KEY,
 bird_id TEXT NOT NULL,
 year INTEGER NOT NULL,
 previous_arrival TEXT NOT NULL,
 arrival TEXT NOT NULL,
 changed_at TEXT NOT NULL,
 boundary_version TEXT NOT NULL
);
