// A closed cycle owns immutable league snapshots until every captured event is delivered.
// This is a standings reconciliation boundary, not an email digest or sending delay.
export async function closeRaceNotificationCycle(db:any,id:string,now:number){
 const guard='EXISTS(SELECT 1 FROM race_notification_cycles WHERE id=? AND closed_at IS NULL)';
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO race_notification_cycle_leagues(cycle_id,league_id,payload)
   SELECT ?,l.id,json_object('league',json_remove(l.state,'$.invite'),'results',json(COALESCE((SELECT json_group_array(json(r.payload)) FROM race_results r WHERE r.year=json_extract(l.state,'$.year') AND r.bird_id IN (SELECT json_extract(value,'$.birdId') FROM json_each(l.state,'$.picks'))),'[]')))
   FROM leagues l WHERE l.id IN (SELECT json_extract(payload,'$.league.id') FROM notification_outbox WHERE json_extract(payload,'$.cycleId')=?) AND ${guard}`).bind(id,id,id),
  db.prepare(`INSERT OR IGNORE INTO notification_outbox(event_key,created_at,payload)
   SELECT 'cycle-final:'||cycle_id||':'||league_id,?,json_set(payload,'$.cycleId',cycle_id,'$.cycleFinal',json('true')) FROM race_notification_cycle_leagues WHERE cycle_id=? AND ${guard}`).bind(now,id,id),
  db.prepare('UPDATE race_notification_cycles SET closed_at=? WHERE id=? AND closed_at IS NULL').bind(now,id)
 ]);
}
export async function expireRaceNotificationCycle(db:any,now:number){
 const row=await db.prepare('SELECT id FROM race_notification_cycles WHERE closed_at IS NULL AND expires_at<=?').bind(now).first();
 if(row)await closeRaceNotificationCycle(db,row.id,now);
}
export async function pruneRaceNotificationCycles(db:any){
 // Delete only drained closed cycles; replay and partial recipient delivery retain evidence.
 await db.batch([
  db.prepare(`DELETE FROM race_notification_cycle_leagues WHERE cycle_id IN (SELECT id FROM race_notification_cycles c WHERE closed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notification_outbox o WHERE json_extract(o.payload,'$.cycleId')=c.id))`),
  db.prepare(`DELETE FROM race_notification_cycles WHERE closed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notification_outbox o WHERE json_extract(o.payload,'$.cycleId')=race_notification_cycles.id)`)
 ]);
}
