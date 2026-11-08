export const deletionEnabled=(config:any)=>config.ACCOUNT_DELETION_ENABLED==='true';
export async function deletionMaintenance(config:any){
 return deletionEnabled(config)&&!!await config.DB.prepare("SELECT 1 FROM account_deletions WHERE status='cleanup' LIMIT 1").first();
}
