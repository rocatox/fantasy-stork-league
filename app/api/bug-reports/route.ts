import {getUser} from '../../../lib/auth';
import {database,json,safeWrite} from '../../../lib/store';
export async function POST(req:Request){
 if(!safeWrite(req))return json({error:'Same-origin JSON required'},403);
 const user=await getUser(req);if(!user)return json({error:'Sign in to report a bug.'},401);
 // Bound the stream before parsing, including requests without Content-Length.
 const reader=req.body?.getReader();if(!reader)return json({error:'Enter a report.'},400);
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>24000){await reader.cancel();return json({error:'Report is too long.'},413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 let b:any;try{b=JSON.parse(new TextDecoder().decode(bytes));}catch{return json({error:'Invalid report.'},400);}
 const areas=['map','scouting','leagues','settings','notifications','other','privacy'];
 if(!b||typeof b.id!=='string'||!/^\w{8}-\w{4}-4\w{3}-[89ab]\w{3}-\w{12}$/i.test(b.id)||typeof b.title!=='string'||!b.title.trim()||b.title.trim().length>100||typeof b.description!=='string'||b.description.trim().length<10||b.description.trim().length>4000||!areas.includes(b.area))return json({error:'Add a title (up to 100 characters), an area, and a description (10–4,000 characters).'},400);
 const db=database(),title=b.title.trim(),description=b.description.trim(),now=Date.now();
 const existing=await db.prepare('SELECT user_id,title,area,description FROM bug_reports WHERE id=?').bind(b.id).first();
 if(existing){if(existing.user_id!==user.userId||existing.title!==title||existing.area!==b.area||existing.description!==description)return json({error:'Please submit this as a new report.'},409);return json({id:b.id});}
 // Limits and insert share one SQLite statement, so concurrent submissions cannot bypass them.
 const result=await db.prepare(`INSERT INTO bug_reports(id,user_id,title,area,description,created_at)
 SELECT ?,?,?,?,?,? WHERE (SELECT count(*) FROM bug_reports WHERE user_id=? AND created_at>?)<5
 AND (SELECT count(*) FROM bug_reports WHERE created_at>?)<100
 AND (SELECT count(*) FROM bug_reports)<5000 ON CONFLICT(id) DO NOTHING`).bind(b.id,user.userId,title,b.area,description,now,user.userId,now-86400000,now-86400000).run();
 if(result.meta.changes)return json({id:b.id},201);
 const saved=await db.prepare('SELECT user_id,title,area,description FROM bug_reports WHERE id=?').bind(b.id).first();
 if(saved&&saved.user_id===user.userId&&saved.title===title&&saved.area===b.area&&saved.description===description)return json({id:b.id});
 return json({error:'The report limit has been reached. Please try again later.'},429);
}
