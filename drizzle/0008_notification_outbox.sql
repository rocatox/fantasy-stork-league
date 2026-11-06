CREATE TABLE notification_outbox (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 event_key TEXT UNIQUE NOT NULL,
 created_at INTEGER NOT NULL,
 payload TEXT NOT NULL
);
CREATE TABLE notification_delivery_lock (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TRIGGER notification_league_insert AFTER INSERT ON leagues
 BEGIN
 INSERT INTO notification_outbox(event_key,created_at,payload) VALUES ('league:'||NEW.id||':'||NEW.revision,unixepoch()*1000,json_object('league',json_remove(NEW.state,'$.invite'),'results',json(COALESCE((SELECT json_group_array(json(payload)) FROM race_results WHERE year=json_extract(NEW.state,'$.year') AND bird_id IN (SELECT json_extract(value,'$.birdId') FROM json_each(NEW.state,'$.picks'))),'[]'))));
 END;
CREATE TRIGGER notification_league_update AFTER UPDATE ON leagues
 BEGIN
 INSERT INTO notification_outbox(event_key,created_at,payload) VALUES ('league:'||NEW.id||':'||NEW.revision,unixepoch()*1000,json_object('league',json_remove(NEW.state,'$.invite'),'results',json(COALESCE((SELECT json_group_array(json(payload)) FROM race_results WHERE year=json_extract(NEW.state,'$.year') AND bird_id IN (SELECT json_extract(value,'$.birdId') FROM json_each(NEW.state,'$.picks'))),'[]'))));
 END;
CREATE TRIGGER notification_race_insert AFTER INSERT ON race_results
 BEGIN
 INSERT INTO notification_outbox(event_key,created_at,payload)
 SELECT 'race:'||NEW.year||':'||NEW.bird_id||':'||json_extract(NEW.payload,'$.checkedAt')||':'||l.id,unixepoch()*1000,json_object('league',json_remove(l.state,'$.invite'),'results',json(COALESCE((SELECT json_group_array(json(payload)) FROM race_results WHERE year=NEW.year AND bird_id IN (SELECT json_extract(value,'$.birdId') FROM json_each(l.state,'$.picks'))),'[]')))
 FROM leagues l WHERE json_extract(l.state,'$.status')='ready' AND json_extract(l.state,'$.year')=NEW.year
 AND EXISTS(SELECT 1 FROM json_each(l.state,'$.picks') WHERE json_extract(value,'$.birdId')=NEW.bird_id)
 ON CONFLICT(event_key) DO NOTHING;
 END;
CREATE TRIGGER notification_race_update AFTER UPDATE ON race_results
 BEGIN
 INSERT INTO notification_outbox(event_key,created_at,payload)
 SELECT 'race:'||NEW.year||':'||NEW.bird_id||':'||json_extract(NEW.payload,'$.checkedAt')||':'||l.id,unixepoch()*1000,json_object('league',json_remove(l.state,'$.invite'),'results',json(COALESCE((SELECT json_group_array(json(payload)) FROM race_results WHERE year=NEW.year AND bird_id IN (SELECT json_extract(value,'$.birdId') FROM json_each(l.state,'$.picks'))),'[]')))
 FROM leagues l WHERE json_extract(l.state,'$.status')='ready' AND json_extract(l.state,'$.year')=NEW.year
 AND EXISTS(SELECT 1 FROM json_each(l.state,'$.picks') WHERE json_extract(value,'$.birdId')=NEW.bird_id)
 ON CONFLICT(event_key) DO NOTHING;
 END;
INSERT INTO notification_outbox(event_key,created_at,payload) SELECT 'baseline:'||id,unixepoch()*1000,json_object('league',json_remove(state,'$.invite'),'results',json(COALESCE((SELECT json_group_array(json(payload)) FROM race_results WHERE year=json_extract(state,'$.year') AND bird_id IN (SELECT json_extract(value,'$.birdId') FROM json_each(state,'$.picks'))),'[]'))) FROM leagues WHERE json_extract(state,'$.status') IN ('lobby','draft','ready');
