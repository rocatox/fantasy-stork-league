-- Preserve existing assignments while extending the unique portrait pool.
CREATE TABLE bird_portraits_expanded (
  bird_id TEXT PRIMARY KEY NOT NULL,
  portrait_id INTEGER UNIQUE NOT NULL CHECK (portrait_id BETWEEN 1 AND 256)
);
INSERT INTO bird_portraits_expanded SELECT bird_id,portrait_id FROM bird_portraits;
DROP TABLE bird_portraits;
ALTER TABLE bird_portraits_expanded RENAME TO bird_portraits;
