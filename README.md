# مجلة جامعة جدارا الإلكترونية: الواجهة + الباك إند

خادم Node.js (Express) يقدّم الواجهة (`public/index.html`) وواجهة API، مع قاعدة SQLite (ملف واحد) وتخزين الملفات على القرص.
المتطلبات: Node.js 22.5 أو أحدث.

## التشغيل المحلي
    npm install
    cp .env.example .env        # ثم عدّل القيم
    npm start                   # http://localhost:3000

- أول تشغيل ينشئ قاعدة البيانات في ./data ويحمّل المحتوى التجريبي (أوقفه بـ SEED_DEMO=0).
- للتجربة المحلية بدون HTTPS ضع في .env: NODE_ENV=development و COOKIE_SECURE=0

## حساب المدير الأول
- كلمة المرور الأولية من ADMIN_INITIAL_PASSWORD في .env (ليست في أي ملف واجهة).
- إن تُركت فارغة تُولَّد كلمة عشوائية وتُطبع مرة واحدة في سجل الخادم.
- الدخول: نقر مزدوج على الشعار ثم كلمة المرور. يُطلب تغييرها عند أول دخول، ولا يتم التغيير دون إدخال الحالية (يُتحقق في الخادم).
- أضف المحررين من «المستخدمون والصلاحيات». الدور يُحدَّد من كلمة مرور كل مستخدم، فلا تتكرر كلمة المرور بين مستخدمين.

## الصلاحيات (تُفرض في الخادم)
| الدور | مسودات | اعتماد/نشر/حذف | إعدادات | مستخدمون |
|---|---|---|---|---|
| مدير النظام | نعم | نعم | نعم | نعم |
| مدير تحرير | نعم | نعم | نعم | لا |
| مدير محتوى | نعم | نعم | لا | لا |
| محرر / مدقق | نعم | لا | لا | لا |

## الأمان
bcrypt (12 جولة) · جلسات في القاعدة بكوكي HttpOnly + SameSite=Strict (+Secure في الإنتاج) · حد محاولات الدخول · حماية CSRF (ترويسة مخصصة + فحص Origin) · تحقق من المدخلات في الخادم · استعلامات مهيّأة · رفع الملفات بقائمة أنواع مسموحة وفحص التوقيع وحد 60MB · Helmet/CSP · سجل نشاطات.

## النشر
1. خادم أو Docker: docker build -t jadara . && docker run -d -p 3000:3000 -v jadara-data:/data --env-file .env jadara
2. ضعه خلف Nginx أو Cloudflare بشهادة HTTPS، وفعّل COOKIE_SECURE=1 و TRUST_PROXY=1.
3. اربط النطاق الرسمي واضبط SITE_URL.

## النسخ الاحتياطي
npm run backup ينسخ القاعدة والملفات إلى ./backups/<تاريخ> ويحتفظ بآخر 14 نسخة.
جدولة يومية (cron): 0 3 * * * cd /path/to/app && npm run backup
الاستعادة: أوقف الخادم وأعد jadara.db و uploads إلى DATA_DIR.

## API
عام: GET /api/state · POST /api/visit | view/:id | dl | comment | newsletter | submission
محمي: POST /api/login | logout · GET /api/me · GET|PUT /api/admin/state · POST /api/admin/upload | users | password · DELETE /api/admin/users/:id · GET /api/admin/newsletter.csv

## حدود النسخة الحالية
- SQLite وتخزين محلي (يكفيان موقعاً واحداً). للتوسع: PostgreSQL وS3.
- لا استعادة كلمة مرور بالبريد (تتطلب SMTP).
- الروابط بنمط # فلا فهرسة لكل مادة في محركات البحث ولا Open Graph لكل مادة.
