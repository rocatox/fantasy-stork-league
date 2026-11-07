-- Preserve first-import signals and settlement; skip repeated neutral baselines.
DROP TRIGGER notification_race_insert;
CREATE TRIGGER notification_race_insert AFTER INSERT ON race_results
 BEGIN
 INSERT INTO notification_outbox(event_key,created_at,payload)
 SELECT 'race:'||NEW.year||':'||NEW.bird_id||':'||json_extract(NEW.payload,'$.checkedAt')||':'||l.id,unixepoch()*1000,json_object('league',json_remove(l.state,'$.invite'),'results',json(COALESCE((SELECT json_group_array(json(payload)) FROM race_results WHERE year=NEW.year AND bird_id IN (SELECT json_extract(value,'$.birdId') FROM json_each(l.state,'$.picks'))),'[]')))
 FROM leagues l WHERE json_extract(l.state,'$.status')='ready' AND json_extract(l.state,'$.year')=NEW.year
 AND EXISTS(SELECT 1 FROM json_each(l.state,'$.picks') WHERE json_extract(value,'$.birdId')=NEW.bird_id)
 -- One neutral result establishes the league's race baseline. Further neutral
 -- first-import results cannot alter arrivals, migration signals or zero points.
 -- Never suppress an initial result if it carries a signal, other roster results
 -- carry signals (points may become reliable), or season completion is possible.
 AND (
   json_extract(NEW.payload,'$.arrival') IS NOT NULL
   OR json_extract(NEW.payload,'$.migrationStart') IS NOT NULL
   OR unixepoch()>=CAST(strftime('%s',NEW.year||'-07-01T04:00:00Z') AS INTEGER)
   OR NOT EXISTS (
     SELECT 1 FROM race_results r
     WHERE r.year=NEW.year AND r.bird_id<>NEW.bird_id
       AND r.bird_id IN (SELECT json_extract(value,'$.birdId') FROM json_each(l.state,'$.picks'))
   )
   OR EXISTS (
     SELECT 1 FROM race_results r
     WHERE r.year=NEW.year AND r.bird_id<>NEW.bird_id
       AND r.bird_id IN (SELECT json_extract(value,'$.birdId') FROM json_each(l.state,'$.picks'))
       AND (json_extract(r.payload,'$.arrival') IS NOT NULL OR json_extract(r.payload,'$.migrationStart') IS NOT NULL)
   )
 )
 ON CONFLICT(event_key) DO NOTHING;
 END;
