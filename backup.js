import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';import path from 'node:path';
const DATA=path.resolve(process.env.DATA_DIR||'./data'),out=path.resolve(process.env.BACKUP_DIR||'./backups',new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(out,{recursive:true});const db=new DatabaseSync(DATA+'/jadara.db');db.exec(`VACUUM INTO '${out.replace(/'/g,"''")}/jadara.db'`);
fs.cpSync(DATA+'/uploads',out+'/uploads',{recursive:true});
const keep=+process.env.BACKUP_KEEP||14,dir=path.dirname(out),l=fs.readdirSync(dir).sort();for(const d of l.slice(0,Math.max(0,l.length-keep)))fs.rmSync(path.join(dir,d),{recursive:true,force:true});
console.log('Backup saved to',out);
