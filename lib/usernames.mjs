export function playerUsername(user){const value=user?.username;return typeof value==='string'&&value.length>0&&value.length<=15?value:'';}
