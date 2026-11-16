import express from 'express';import helmet from 'helmet';import multer from 'multer';import bcrypt from 'bcryptjs';
import {DatabaseSync} from 'node:sqlite';import crypto from 'node:crypto';import fs from 'node:fs';import path from 'node:path';
const PORT=+process.env.PORT||3000,DATA=path.resolve(process.env.DATA_DIR||'./data'),PROD=process.env.NODE_ENV=='production',SECURE=process.env.COOKIE_SECURE?process.env.COOKIE_SECURE=='1':PROD,HERE=path.dirname(new URL(import.meta.url).pathname);
fs.mkdirSync(DATA+'/uploads',{recursive:true});
const db=new DatabaseSync(DATA+'/jadara.db');
db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,role TEXT NOT NULL,hash TEXT NOT NULL,must INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,uid INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,exp INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY,type TEXT NOT NULL,sec INTEGER,st TEXT NOT NULL,date TEXT,data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_items ON items(type,st,date);
CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY,item INTEGER NOT NULL,name TEXT,text TEXT,st TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS newsletter(email TEXT PRIMARY KEY,created TEXT);
CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY,v TEXT);
CREATE TABLE IF NOT EXISTS visits(day TEXT PRIMARY KEY,n INTEGER);
CREATE TABLE IF NOT EXISTS views(item INTEGER PRIMARY KEY,n INTEGER);
CREATE TABLE IF NOT EXISTS sources(host TEXT PRIMARY KEY,n INTEGER);
CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY AUTOINCREMENT,t TEXT,x TEXT);`);
const all=(s,...a)=>db.prepare(s).all(...a),get=(s,...a)=>db.prepare(s).get(...a),run=(s,...a)=>db.prepare(s).run(...a);
const kvg=(k,d)=>{const r=get('SELECT v FROM kv WHERE k=?',k);return r?JSON.parse(r.v):d},kvs=(k,v)=>run('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v',k,JSON.stringify(v));
const log=x=>run('INSERT INTO logs(t,x) VALUES(?,?)',new Date().toISOString(),x),nextId=()=>{const n=kvg('n',0)+1;kvs('n',n);return n};
const ROLES={admin:1,chief:1,content:1,editor:0,proof:0},ALLST=['مسودة','قيد المراجعة','بحاجة إلى تعديل','معتمد','مجدول','منشور','مؤرشف'],SST=['جديدة','قيد المراجعة','بحاجة إلى تعديل','مقبولة','مرفوضة','جاهزة للنشر'],PROT=['معتمد','مجدول','منشور','مؤرشف'],TYPES=['news','art','photo','vid','stu','conf','ach','iss','evt','sub'];
/* initial data */
if(!get('SELECT 1 x FROM users')){let p=process.env.ADMIN_INITIAL_PASSWORD;if(!p){p=crypto.randomBytes(9).toString('base64url');console.log('\n*** ADMIN_INITIAL_PASSWORD غير محدد. كلمة المرور المؤقتة:',p,'\n')}run('INSERT INTO users(name,role,hash,must) VALUES(?,?,?,1)','المدير','admin',bcrypt.hashSync(p,12));log('إنشاء حساب المدير الأول')}
/* helpers */
const S=(v,n=5000)=>typeof v=='string'?v.slice(0,n):'',fileOk=f=>f&&typeof f.url=='string'&&/^\/uploads\/[\w.-]+$/.test(f.url)?{url:f.url,type:S(f.type,80),name:S(f.name,200)}:null;
function clean(it){if(!it||!TYPES.includes(it.type)||!(ALLST.includes(it.st)||SST.includes(it.st)))return null;const o={id:+it.id,type:it.type,sec:Math.min(12,Math.max(0,+it.sec||0)),title:S(it.title,300),sub:S(it.sub,300),author:S(it.author,200),date:S(it.date,10),st:it.st,feat:!!it.feat,potm:!!it.potm,demo:it.demo?1:0,tags:S(it.tags,300),seo:S(it.seo,300),body:S(it.body,60000),video:/^https?:\/\//.test(it.video||'')?S(it.video,300):'',pubAt:S(it.pubAt,20),note:S(it.note,2000),kind:S(it.kind,100),email:S(it.email,200),fname:S(it.fname,200),items:Array.isArray(it.items)?it.items.map(Number).filter(Number.isInteger).slice(0,200):undefined,cover:fileOk(it.cover),file:fileOk(it.file),gal:Array.isArray(it.gal)?it.gal.map(fileOk).filter(Boolean).slice(0,60):undefined,rev:Array.isArray(it.rev)?it.rev.slice(0,10).map(r=>({t:S(r.t,50),by:S(r.by,100),st:S(r.st,30),title:S(r.title,300),body:S(r.body,2000)})):undefined};return Number.isInteger(o.id)&&o.id>0&&o.title?o:null}
const live=o=>o.st=='منشور'||(o.st=='مجدول'&&o.pubAt&&new Date(o.pubAt)<=new Date()),rows=()=>all('SELECT data FROM items ORDER BY date DESC,id DESC').map(r=>JSON.parse(r.data));
const upsert=o=>run('INSERT INTO items(id,type,sec,st,date,data) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,sec=excluded.sec,st=excluded.st,date=excluded.date,data=excluded.data',o.id,o.type,o.sec,o.st,o.date,JSON.stringify(o));
const hits=new Map();function hit(k,max,ms){const n=Date.now(),a=(hits.get(k)||[]).filter(t=>n-t<ms);hits.set(k,a);if(a.length>=max)return false;a.push(n);return true}
const cookie=(req,n)=>(req.headers.cookie||'').split(';').map(s=>s.trim().split('=')).find(a=>a[0]==n)?.[1];
const hsh=t=>crypto.createHash('sha256').update(t).digest('hex');
const setCk=(res,v,age)=>res.setHeader('Set-Cookie',`jsid=${v}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${SECURE?'; Secure':''}`);
const seedF=path.join(HERE,'seed.json');if(!get('SELECT 1 x FROM items')&&!kvg('seeded',0)&&fs.existsSync(seedF)&&process.env.SEED_DEMO!='0'){for(const it of JSON.parse(fs.readFileSync(seedF))){const o=clean(it);run('INSERT INTO items(id,type,sec,st,date,data) VALUES(?,?,?,?,?,?)',o.id,o.type,o.sec,o.st,o.date,JSON.stringify(o));kvs('n',Math.max(kvg('n',0),o.id))}kvs('seeded',1);log('تحميل المحتوى التجريبي')}
/* app */
const app=express();if(process.env.TRUST_PROXY)app.set('trust proxy',1);app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'","'unsafe-inline'"],styleSrc:["'self'","'unsafe-inline'","https://fonts.googleapis.com"],fontSrc:["https://fonts.gstatic.com"],imgSrc:["'self'","data:","blob:"],mediaSrc:["'self'","blob:"],frameSrc:["'self'","blob:","https://www.youtube.com"],connectSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'self'"]}},crossOriginEmbedderPolicy:false}));
app.use(express.json({limit:'12mb'}));
app.use('/api',(req,res,next)=>{if(!['GET','HEAD'].includes(req.method)){if(req.headers['x-requested-with']!='fetch')return res.status(403).json({error:'طلب غير مسموح'});const o=req.headers.origin;if(o&&new URL(o).host!=req.headers.host)return res.status(403).json({error:'مصدر غير مسموح'})}
const t=cookie(req,'jsid');if(t){const s=get('SELECT u.id,u.name,u.role,u.must,s.exp FROM sessions s JOIN users u ON u.id=s.uid WHERE s.id=?',hsh(t));if(s&&s.exp>Date.now())req.user=s;else if(s)run('DELETE FROM sessions WHERE id=?',hsh(t))}next()});
const need=(...r)=>(req,res,next)=>!req.user?res.status(401).json({error:'يلزم تسجيل الدخول'}):r.length&&!r.includes(req.user.role)?res.status(403).json({error:'لا تملك الصلاحية'}):next();
const ip=req=>req.ip||'x';
/* auth */
app.post('/api/login',(req,res)=>{const k='l'+ip(req);if(!hit(k,10,15*60e3))return res.status(429).json({error:'محاولات كثيرة. حاول بعد 15 دقيقة.'});const p=S(req.body.password,200);const u=p&&all('SELECT * FROM users').find(u=>bcrypt.compareSync(p,u.hash));
if(!u){log('محاولة دخول فاشلة من '+ip(req));return res.status(401).json({error:'كلمة المرور غير صحيحة.'})}
hits.delete(k);const t=crypto.randomBytes(32).toString('hex');run('INSERT INTO sessions(id,uid,exp) VALUES(?,?,?)',hsh(t),u.id,Date.now()+8*3600e3);setCk(res,t,8*3600);log('تسجيل دخول: '+u.name);res.json({user:{name:u.name,role:u.role,must:!!u.must}})});
app.post('/api/logout',(req,res)=>{const t=cookie(req,'jsid');if(t)run('DELETE FROM sessions WHERE id=?',hsh(t));if(req.user)log('تسجيل خروج: '+req.user.name);setCk(res,'',0);res.json({})});
app.get('/api/me',(req,res)=>res.json({user:req.user?{name:req.user.name,role:req.user.role,must:!!req.user.must}:null}));
/* state */
const counts=()=>({v:Object.fromEntries(all('SELECT item,n FROM views').map(r=>[r.item,r.n])),day:Object.fromEntries(all('SELECT day,n FROM visits').map(r=>[r.day,r.n])),src:Object.fromEntries(all('SELECT host,n FROM sources').map(r=>[r.host,r.n])),dl:kvg('dl',0)});
app.get('/api/state',(req,res)=>{const items=rows().filter(o=>o.type!='sub'&&live(o));res.json({n:kvg('n',0),items,set:kvg('set',{}),hp:kvg('hp',{}),cm:all("SELECT id,item,name,text,st FROM comments WHERE st='معتمد'"),v:counts().v})});
app.get('/api/admin/state',need(),(req,res)=>res.json({n:kvg('n',0),items:rows(),set:kvg('set',{}),hp:kvg('hp',{}),cm:all('SELECT id,item,name,text,st FROM comments ORDER BY id DESC'),nl:all('SELECT email FROM newsletter ORDER BY created DESC').map(r=>r.email),...counts(),us:all('SELECT id,name n,role r FROM users'),log:all('SELECT t,x FROM logs ORDER BY id DESC LIMIT 40').map(l=>({t:new Date(l.t).toLocaleString('ar-JO'),x:l.x}))}));
app.put('/api/admin/state',need(),(req,res)=>{const u=req.user,pub=!!ROLES[u.role],b=req.body||{},nb=+b.nb||0,map={},fail=m=>{throw Object.assign(new Error(m),{code:403})};
try{db.exec('BEGIN');for(const raw of Array.isArray(b.items)?b.items:[]){const o=clean(raw);if(!o){throw Object.assign(new Error('بيانات مادة غير صالحة'),{code:400})}const old=get('SELECT data FROM items WHERE id=?',o.id),isNew=o.id>nb;
if(isNew&&(old||o.id<=kvg('n',0))){const nid=nextId();map[o.id]=nid;o.id=nid}else if(!old&&!isNew)continue;else if(isNew)kvs('n',Math.max(kvg('n',0),o.id));
const prev=!isNew&&old?JSON.parse(old.data):null,s=prev?JSON.stringify(prev):null;if(s==JSON.stringify(o))continue;
if(!pub){if(prev&&PROT.includes(prev.st))fail('المادة معتمدة، وتعديلها يتطلب صلاحية الاعتماد.');if(PROT.includes(o.st)&&(!prev||prev.st!=o.st))fail('لا تملك صلاحية الاعتماد أو النشر.')}
upsert(o);log((prev?'تعديل: ':'إضافة: ')+o.title+' ('+o.st+') — '+u.name)}
for(const id of(Array.isArray(b.del)?b.del:[]).map(Number).filter(Number.isInteger)){if(!pub)fail('لا تملك صلاحية الحذف.');const r=get('SELECT data FROM items WHERE id=?',id);if(r){run('DELETE FROM items WHERE id=?',id);run('DELETE FROM comments WHERE item=?',id);log('حذف: '+JSON.parse(r.data).title+' — '+u.name)}}
for(const k of['set','hp']){if(b[k]&&JSON.stringify(b[k])!=JSON.stringify(kvg(k,{}))){if(!['admin','chief'].includes(u.role))fail('لا تملك صلاحية تعديل الإعدادات.');kvs(k,b[k]);log('تعديل '+(k=='set'?'إعدادات الموقع':'الصفحة الرئيسية')+' — '+u.name)}}
for(const c of Array.isArray(b.cm)?b.cm:[]){const o=get('SELECT st FROM comments WHERE id=?',+c.id);if(o&&c.st=='معتمد'&&o.st!='معتمد'){if(!pub)fail('لا تملك صلاحية.');run("UPDATE comments SET st='معتمد' WHERE id=?",+c.id);log('اعتماد تعليق — '+u.name)}}
for(const id of Array.isArray(b.delcm)?b.delcm:[]){if(!pub)fail('لا تملك صلاحية.');run('DELETE FROM comments WHERE id=?',+id)}
db.exec('COMMIT');res.json({n:kvg('n',0),map})}catch(e){try{db.exec('ROLLBACK')}catch(_){}res.status(e.code||500).json({error:e.code?e.message:'خطأ في الخادم'});if(!e.code)console.error(e)}});
/* uploads */
const EXT={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/gif':'.gif','application/pdf':'.pdf','video/mp4':'.mp4','video/webm':'.webm','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx'};
const sniff=(b,m)=>{const h=b.subarray(0,12);const s=(i,t)=>h.subarray(i,i+t.length).toString('latin1')==t;return m=='image/jpeg'?h[0]==255&&h[1]==216:m=='image/png'?s(1,'PNG'):m=='image/gif'?s(0,'GIF8'):m=='image/webp'?s(0,'RIFF')&&s(8,'WEBP'):m=='application/pdf'?s(0,'%PDF'):m=='video/mp4'?s(4,'ftyp'):m=='video/webm'?h[0]==0x1a&&h[1]==0x45:s(0,'PK')};
const mem=multer({storage:multer.memoryStorage(),limits:{fileSize:60*1024*1024,files:1,fields:20}});
const store=f=>{if(!f)return null;if(!EXT[f.mimetype]||!sniff(f.buffer,f.mimetype))throw Object.assign(new Error('نوع الملف غير مسموح'),{code:415});const n=crypto.randomUUID()+EXT[f.mimetype];fs.writeFileSync(path.join(DATA,'uploads',n),f.buffer);return{url:'/uploads/'+n,type:f.mimetype,name:S(Buffer.from(f.originalname,'latin1').toString('utf8'),200)}};
const wrap=fn=>(req,res)=>{try{fn(req,res)}catch(e){res.status(e.code||500).json({error:e.code?e.message:'خطأ في الخادم'});if(!e.code)console.error(e)}};
app.post('/api/admin/upload',need(),mem.single('file'),wrap((req,res)=>{if(!req.file)throw Object.assign(new Error('لا يوجد ملف'),{code:400});res.json(store(req.file))}));
app.use('/uploads',express.static(DATA+'/uploads',{index:false,dotfiles:'deny',setHeaders:r=>r.setHeader('X-Content-Type-Options','nosniff')}));
/* public actions */
app.post('/api/visit',(req,res)=>{if(!hit('v'+ip(req),30,60e3))return res.json({});const d=new Date().toISOString().slice(0,10);let h='مباشر';try{if(req.body.ref)h=new URL(S(req.body.ref,300)).hostname.slice(0,100)||h}catch(e){}run('INSERT INTO visits(day,n) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET n=n+1',d);run('INSERT INTO sources(host,n) VALUES(?,1) ON CONFLICT(host) DO UPDATE SET n=n+1',h);res.json({})});
app.post('/api/view/:id',(req,res)=>{const id=+req.params.id;if(get('SELECT 1 x FROM items WHERE id=?',id)&&hit('w'+ip(req)+id,3,60e3))run('INSERT INTO views(item,n) VALUES(?,1) ON CONFLICT(item) DO UPDATE SET n=n+1',id);res.json({})});
app.post('/api/dl',(req,res)=>{if(hit('d'+ip(req),20,60e3))kvs('dl',kvg('dl',0)+1);res.json({})});
app.post('/api/comment',(req,res)=>{const{item,name,text}=req.body||{},r=get('SELECT data FROM items WHERE id=?',+item),o=r&&JSON.parse(r.data);if(kvg('set',{}).cm===false||!o||o.type=='sub'||!live(o)||!S(name,100).trim()||!S(text,2000).trim()||!hit('c'+ip(req),5,10*60e3))return res.status(400).json({error:'تعذر إرسال التعليق'});run('INSERT INTO comments(id,item,name,text,st) VALUES(?,?,?,?,?)',nextId(),o.id,S(name,100),S(text,2000),'بانتظار المراجعة');res.json({})});
app.post('/api/newsletter',(req,res)=>{const e=S(req.body?.e,200).trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)||!hit('n'+ip(req),5,10*60e3))return res.status(400).json({error:'بريد غير صالح'});run('INSERT OR IGNORE INTO newsletter(email,created) VALUES(?,?)',e,new Date().toISOString());res.json({})});
app.post('/api/submission',mem.single('file'),wrap((req,res)=>{const b=req.body||{};if(!hit('s'+ip(req),5,60*60e3)||!b.title||!b.author||!b.body||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email||''))throw Object.assign(new Error('بيانات غير صالحة'),{code:400});const f=store(req.file),id=nextId();
const o=clean({id,type:'sub',sec:0,st:'جديدة',date:new Date().toISOString().slice(0,10),title:b.title,author:b.author,sub:b.sub,email:b.email,kind:b.kind,body:b.body,file:f,fname:f&&f.name});upsert(o);log('مشاركة طلابية جديدة: '+o.title);res.json({})}));
/* admin: users & password */
app.post('/api/admin/users',need('admin'),(req,res)=>{const{n,r,p}=req.body||{};if(!S(n,100).trim()||!(r in ROLES)||S(p,200).length<8)return res.status(400).json({error:'تحقق من الاسم والدور وكلمة المرور (8 أحرف فأكثر).'});if(all('SELECT hash FROM users').some(u=>bcrypt.compareSync(p,u.hash)))return res.status(409).json({error:'كلمة المرور مستخدمة. اختر كلمة أخرى.'});run('INSERT INTO users(name,role,hash,must) VALUES(?,?,?,0)',S(n,100),r,bcrypt.hashSync(p,12));log('إضافة مستخدم: '+n+' — '+req.user.name);res.json({})});
app.delete('/api/admin/users/:id',need('admin'),(req,res)=>{const id=+req.params.id;if(id==req.user.id)return res.status(400).json({error:'لا يمكن حذف حسابك'});run('DELETE FROM users WHERE id=?',id);log('حذف مستخدم #'+id+' — '+req.user.name);res.json({})});
app.post('/api/admin/password',need(),(req,res)=>{const{cur,new:np}=req.body||{},u=get('SELECT * FROM users WHERE id=?',req.user.id);if(!hit('p'+req.user.id,5,15*60e3))return res.status(429).json({error:'محاولات كثيرة'});
if(!bcrypt.compareSync(S(cur,200),u.hash))return res.status(403).json({error:'كلمة المرور الحالية غير صحيحة.'});if(S(np,200).length<8||np==cur)return res.status(400).json({error:'كلمة المرور الجديدة يجب أن تكون 8 أحرف فأكثر ومختلفة عن الحالية.'});if(all('SELECT hash FROM users WHERE id<>?',u.id).some(o=>bcrypt.compareSync(np,o.hash)))return res.status(409).json({error:'كلمة المرور مستخدمة.'});
run('UPDATE users SET hash=?,must=0 WHERE id=?',bcrypt.hashSync(np,12),u.id);run('DELETE FROM sessions WHERE uid=? AND id<>?',u.id,hsh(cookie(req,'jsid')));log('تغيير كلمة المرور — '+u.name);res.json({})});
app.get('/api/admin/newsletter.csv',need('admin','chief'),(req,res)=>{res.type('text/csv').send(all('SELECT email FROM newsletter').map(r=>r.email).join('\n'))});
/* site */
app.get('/robots.txt',(q,r)=>r.type('text').send('User-agent: *\nDisallow: /api/\nSitemap: '+(process.env.SITE_URL||'')+'/sitemap.xml\n'));
app.get('/sitemap.xml',(q,r)=>r.type('xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${process.env.SITE_URL||''}/</loc></url></urlset>`));
app.use('/api',(q,r)=>r.status(404).json({error:'غير موجود'}));
app.use(express.static(path.join(HERE,'public'),{index:'index.html'}));
app.use((e,req,res,next)=>{console.error(e);res.status(e.status||500).json({error:e.code=='LIMIT_FILE_SIZE'?'الملف كبير جداً (الحد 60MB)':'خطأ في الخادم'})});
setInterval(()=>run('DELETE FROM sessions WHERE exp<?',Date.now()),3600e3).unref();
app.listen(PORT,()=>console.log('Jadara E-Magazine on http://localhost:'+PORT));
