CREATE TABLE scout_lists (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 15),
 icon TEXT NOT NULL, slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 5),
 UNIQUE(user_id,slot), UNIQUE(user_id,icon), UNIQUE(user_id,name COLLATE NOCASE)
);
CREATE TABLE scout_list_birds (
 list_id TEXT NOT NULL REFERENCES scout_lists(id) ON DELETE CASCADE,
 bird_id TEXT NOT NULL, PRIMARY KEY(list_id,bird_id)
);
