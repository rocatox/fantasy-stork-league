-- Keep evidence/freshness writes, but avoid fan-out for routine unchanged hourly checks.
-- Initial inserts, meaningful changes, stale recovery and season coverage still notify.
DROP TRIGGER notification_race_update;
CREATE TRIGGER notification_race_update AFTER UPDATE ON race_results

 WHEN json_extract(OLD.payload,'$.version') IS NOT json_extract(NEW.payload,'$.version')
   OR json_extract(OLD.payload,'$.boundaryVersion') IS NOT json_extract(NEW.payload,'$.boundaryVersion')
   OR json_extract(OLD.payload,'$.arrival') IS NOT json_extract(NEW.payload,'$.arrival')
   OR json_extract(OLD.payload,'$.migrationStartVersion') IS NOT json_extract(NEW.payload,'$.migrationStartVersion')
   OR json_extract(OLD.payload,'$.migrationStart') IS NOT json_extract(NEW.payload,'$.migrationStart')
   OR json_extract(OLD.payload,'$.changedAt') IS NOT json_extract(NEW.payload,'$.changedAt')
   OR json_extract(OLD.payload,'$.revision') IS NOT json_extract(NEW.payload,'$.revision')
   -- A fresh check after stale data can unlock points withheld by notifications.
   OR COALESCE(julianday(json_extract(OLD.payload,'$.checkedAt')),0)
      < MIN(julianday(json_extract(NEW.payload,'$.checkedAt')),julianday(NEW.year||'-07-01T04:00:00Z'))
        - CASE WHEN julianday(json_extract(NEW.payload,'$.checkedAt'))<julianday(NEW.year||'-07-01T04:00:00Z') THEN 2.0/24 ELSE 12.0/24 END
   -- The first complete end-of-season export can unlock final standings.
   OR (COALESCE(julianday(json_extract(OLD.payload,'$.startedAt')),julianday(json_extract(OLD.payload,'$.checkedAt')),0)<julianday(NEW.year||'-07-01T04:00:00Z')
       AND COALESCE(julianday(json_extract(NEW.payload,'$.startedAt')),julianday(json_extract(NEW.payload,'$.checkedAt')),0)>=julianday(NEW.year||'-07-01T04:00:00Z'))
 BEGIN
 INSERT INTO notification_outbox(event_key,created_at,payload)
 SELECT 'race:'||NEW.year||':'||NEW.bird_id||':'||json_extract(NEW.payload,'$.checkedAt')||':'||l.id,unixepoch()*1000,json_object('league',json_remove(l.state,'$.invite'),'results',json(COALESCE((SELECT json_group_array(json(payload)) FROM race_results WHERE year=NEW.year AND bird_id IN (SELECT json_extract(value,'$.birdId') FROM json_each(l.state,'$.picks'))),'[]')))
 FROM leagues l WHERE json_extract(l.state,'$.status')='ready' AND json_extract(l.state,'$.year')=NEW.year
 AND EXISTS(SELECT 1 FROM json_each(l.state,'$.picks') WHERE json_extract(value,'$.birdId')=NEW.bird_id)
 ON CONFLICT(event_key) DO NOTHING;
 END;
