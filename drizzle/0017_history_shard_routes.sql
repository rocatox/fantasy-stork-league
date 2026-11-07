-- Stable placement for uploads/retries. Existing chunks remain in their original database.
CREATE TABLE history_shard_routes (
 bird_id TEXT NOT NULL,
 month TEXT NOT NULL,
 shard TEXT NOT NULL,
 PRIMARY KEY(bird_id,month)
);
