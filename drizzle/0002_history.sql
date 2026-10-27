CREATE TABLE history_state (bird_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
CREATE TABLE history_chunks (
 bird_id TEXT NOT NULL,
 month TEXT NOT NULL,
 data TEXT NOT NULL,
 summary TEXT NOT NULL,
 PRIMARY KEY (bird_id, month)
);
