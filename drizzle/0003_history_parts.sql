CREATE TABLE history_parts (
 bird_id TEXT NOT NULL,
 month TEXT NOT NULL,
 generation TEXT NOT NULL,
 part INTEGER NOT NULL,
 data TEXT NOT NULL,
 PRIMARY KEY (bird_id, month, generation, part)
);
