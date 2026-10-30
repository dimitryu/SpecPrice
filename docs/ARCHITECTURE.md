# SpecPrice — מבנה הקוד

האפליקציה היא קבצים סטטיים על GitHub Pages, ללא שלב build. הדפדפן טוען את
`app.html`, והוא טוען את המודולים (ES modules) והעיצוב.

```
web/
├─ app.html            מעטפת בלבד: מספר הגרסה, import map, קישורי CSS, מבנה המסך
├─ index.html          דף התחברות
├─ css/                העיצוב, באותו סדר שהיה בקובץ האחד (01 → 04)
└─ js/
   ├─ main.js          נקודת הכניסה: חיבור, טעינת חברה, מסך הבית
   ├─ core/            תשתית משותפת
   │   firebase.js     חיבור ל-Firebase (ה-import היחיד מה-CDN)
   │   state.js        S — state משותף שכמה מודולים משנים
   │   session.js      משתמש וחברה מחוברים
   │   roles.js        תפקידים והרשאות מסכים
   │   router.js       מעבר בין מסכים, מסך הבית
   │   ui.js  table.js toast/modal/עזרי טבלה וחיפוש
   │   audit.js        יומן ביקורת
   │   version.js      בדיקת גרסה חדשה
   ├─ domain/          ★ חישובים טהורים — בלי DOM, בלי Firestore, בלי רשת
   │   cutstrip.js     אורך חיתוך, בסיס מידה, חוטים, חשיפות
   │   bom.js          נרמול BOM, יחידות, פירוק גיליון Excel
   │   pricing.js      מטבעות, מדרגות מחיר, עלות שורה
   │   manufacturing.js
   ├─ data/            ★ כל הגישה ל-Firestore (רק כאן)
   │   parts.js        Database + סל מחזור
   │   pricing.js      מחירי Mouser/DigiKey דרך ה-Cloud Function
   │   company.js users.js roles.js audit.js
   │   projects.js     RFQ + שרטוטים (BOM)
   │   customers.js specs.js support.js
   ├─ ai/              ★ כל הקריאות למודל
   │   client.js       _aiFetch (דרך aiProxy או ישיר), בחירת מודל, נפילה ל-Haiku,
   │                   ניסיון חוזר, תיקון JSON
   │   bom.js          זיהוי BOM (טקסט, תמונה, איתור טבלה)
   │   cutstrip.js     ניתוח חיתוך וחשיפה
   │   process.js manufacturing.js translate.js
   ├─ io/              קבצים: PDF (pdf.js), Excel, ייצוא PDF
   └─ features/        מסך = קובץ או תיקייה; רינדור ואירועים
       salesDesk/  cutstrip/  database.js  rfq.js  bomImport.js ...
```

## חוקים

1. `domain/` לא מייבא כלום מחוץ ל-`domain/`. זה הקוד שהמספרים על הטופס והמחיר תלויים בו,
   והוא נבדק בלי דפדפן.
2. מסך לא משנה state של מסך אחר. מה שמשותף נמצא ב-`S` (`core/state.js`) ונקרא `S.name`.
3. ב-ES modules משתנה מיובא הוא לקריאה בלבד. משתנה שמודול אחר צריך **לשנות** עובר ל-`S`.
   `node tools/check-modules.js` נכשל אם מישהו כותב למשתנה מיובא.
4. שמות Firestore (`doc`, `getDocs`, `setDoc` …) מותרים רק ב-`data/` וב-`core/firebase.js`,
   וכתובת המודל (`api.anthropic.com`, `/aiProxy`) רק ב-`ai/`. `check-modules.js` אוכף את זה.
5. קוד חדש נכנס לפי השכבה: חישוב → `domain/`, Firestore → `data/`, מודל → `ai/`,
   קובץ → `io/`, מסך → `features/`.

## שחרור גרסה

```bash
node tools/stamp-release.js 1.60.0   # מספר גרסה + ?v= לכל קובץ ב-import map
node tools/check-modules.js          # כל import קיים, אין כתיבה למשתנה מיובא
cd tests && node extract.js && node app-logic.test.js   # ועוד ה-harnesses
```

ה-`?v=` על כל קובץ מונע מצב שבו דפדפן מריץ `app.html` חדש עם מודולים ישנים מה-cache.
`push-specprice-v2.ps1` מסרב לדחוף אם הגרסה ב-`app.html` לא תואמת ל-`?v=` של הקבצים.

## מפתח ה-AI — בשרת

כל בקשה למודל עוברת ב-`_aiFetch` (`ai/client.js`):

- **כשהמפתח שמור בשרת** (`S.aiProxy`) — הבקשה נשלחת ל-Cloud Function ‏`aiProxy` עם
  ה-ID token של Firebase. הפונקציה בודקת שהמשתמש קיים ולא מושבת, מוסיפה את המפתח
  מ-`secure_config/ai_api` (חסום לכל דפדפן ב-`firestore.rules`), ומחזירה את תשובת
  Anthropic כמו שהיא — אותו status, אותו JSON. הקוד שקורא את התשובה לא יודע איזו דרך נלקחה.
- **כל עוד אין מפתח בשרת** — ישירות ל-Anthropic עם מפתח מהדפדפן, כמו קודם. כך שום דבר
  לא נשבר לפני שהפונקציות נפרסו.

המפתח נשמר במסך Admin → AI API Keys דרך `apiConfig` (רק admin). אחרי שמירה בשרת
האפליקציה מוחקת את העותקים הישנים: `localStorage` ו-`anthropic_key`/`gemini_key`
במסמך החברה (שכל משתמש מחובר יכול לקרוא). בדיקות: `tests/functions-harness.js`.

## שלב 2 — הושלם (v1.60.0)

- כל קריאות Firestore עברו מהמסכים ל-`data/`.
- התרגום של פירוק זמן העבודה עבר ל-`ai/translate.js` (`aiTranslateOperations`).
- `aiProxy` — מפתח Anthropic לא נמצא יותר בדפדפן.
