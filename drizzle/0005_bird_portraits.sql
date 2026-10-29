CREATE TABLE bird_portraits (
  bird_id TEXT PRIMARY KEY NOT NULL,
  portrait_id INTEGER UNIQUE NOT NULL CHECK (portrait_id BETWEEN 1 AND 64)
);
