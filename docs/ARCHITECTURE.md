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
   │   client.js       _aiFetch (תמיד דרך aiProxy), בחירת מודל, נפילה ל-Haiku,
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

## מדריך למשתמש — חובה לעדכן בכל שינוי

מקור אחד: `web/guide/content.json` + צילומי המסך ב-`web/guide/img/`.
ממנו נבנים מסך **📘 User Guide** באפליקציה (`features/guide.js`, פתוח לכל תפקיד, תמיד הקובייה האחרונה
במסך הבית) וקובץ ה-Word: `node tools/build-guide-docx.js` → `docs/user-guide/SpecPrice-User-Guide.docx`.

**כל שינוי במסך, בכפתור או בתהליך מעדכן את המדריך באותו שחרור**: הפרק ב-`content.json`, צילום מסך
חדש אם המסך השתנה (`tools/guide/` — נתוני דמו בלבד), בניית ה-Word מחדש, ו-`node tests/guide-check.js`.
פרטים: `tools/guide/README.md`. פרקי RFQ ו-Customers לא נכללים במדריך.

החיפוש במדריך (`_guideSearch` / `_guideHighlight` ב-`features/guide.js`) עובד על אותו `content.json`:
בלוק נחשב תוצאה כשכל המילים מופיעות בו (התאמה כחלק ממילה — בגלל תחיליות בעברית: ה/ו/ב/ל).

## כלי לחיצה (Crimp Tools)

`_normalizeBOMRows` (`domain/bom.js`) מריץ קודם `_bomFixToolRows` על שורות ה-AI:
- מחבר שהכלים שלו ידועים (`_bomKnownTools`, כרגע MIL-DTL-38999 Series III בסידור 35 — מגעי 22D)
  מקבל את הכלים מהתקן: `M22520/2-01` + Positioner `M22520/2-07` (Socket) / `M22520/2-09` (Pin) +
  `M81969/14-01`. מקור: Glenair, Series III/IV contact crimp and installation tools. הרחבה = להוסיף לטבלה.
- מק"ט כלי שהוא מק"ט המחבר (או המחבר + `-TOOL`) נמחק (`_bomBadToolPn`) — תא ריק ולא מק"ט מזויף.
- כל שורת כלי מקבלת `tool_for`. בסיכום, `_sdToolLinksHTML` מציג לכל ספק את המחיר שלו וקישור לדף המוצר.

## זהות השרטוט, חומר של הלקוח, שמירת הדסק ל-DB (v1.65)

- **Drawing # / Name / Revision**: `aiReadTitleBlock` (`ai/bom.js`) קורא את טבלת הכותרת (טקסט אם יש שכבת טקסט,
  אחרת תמונת העמוד). `_drawingIdentity` (`domain/bom.js`) — title block קודם, אחר כך שם הקובץ
  (`_parseDrawingFileName`); רוויזיה = האחרונה בטבלת הרוויזיות (`_maxRevision`), ושדה REV רק כשאין טבלה. נשלחים תמונת
  הגיליון הראשון + שכבת הטקסט יחד (בשרטוטים רבים REV/DWG NO הם ציור, לא טקסט). חל על כל שורות הקובץ.
- **עמודת מק"ט אחת**: `_bomFixSinglePnColumn` — כשכותרת הטבלה בשכבת הטקסט (`_bomTextHasPnHeader`) ואין עמודת מק"ט יצרן
  (`_bomTextHasMfrPnColumn`), ערכי `atlantium_pn` מוחזרים ל-`part_number`. טבלה מצוירת (בלי כותרת בטקסט) לא נוגעים.
- **שני מספרי שרטוט על הגיליון**: הפרומפט מחזיר `other_drawing_numbers`; `_drawingIdentity` בוחר את זה ששם הקובץ תואם.
- **טקסט בסידור עמודות**: `extractPDFPages` מחזיר גם `pageLayouts` (`_pdfLayoutText`, כמו pdftotext -layout) — זה מה שנשלח
  לקריאת BOM בטקסט (מגבלה 60k תווים). `_bomLayoutRowCount` סופר שורות ממוספרות מתחת לכותרת הטבלה; אם ה-AI החזיר פחות,
  `_bomFromPDF` קורא גם מהתמונה (locate + crop) ולוקח את הקריאה עם יותר שורות. `pageTexts` לא השתנה (Cut & Strip וכו').
- **מספר שרטוט משם הקובץ**: אם המספר שבשם הקובץ מופיע כמילה שלמה בטקסט הגיליון ושונה ממה שה-AI קרא — הוא נבחר.
- **Customer supplied**: שדה `customer_supplied` בשורה. `_sdRecalcTotal` מחזיר 0 (`_costSource='customer'`) לפני כל מקור
  אחר. נקבע לכל הצעה; ב-DB נשמר לתיעוד בלבד ולא נטען ב-Add from Database. הפרומפטים מבקשים `customer_supplied`.
- **Save to Database** (Sales Desk): `saveSalesDeskToDB` (`data/parts.js`) + `_sdDbPatch` — רק שדות ששונים; ערך ריק לא מוחק;
  מחיר 0 = אין מחיר; QTY לא נשלח; מק"ט כפול נשמר פעם אחת.
- **כלי לחיצה למגעים (v1.66)**: פרומפטי ה-BOM לא מוסיפים שורות כלים. `features/salesDesk/tools.js` (`_findToolsFor`) רץ אחרי קריאת
  שרטוט (`_addToolsToRows`) וב-Add from Database (`_sdAddToolsFor`): מחברי 38999 → `_bomKnownTools`; שורות מגע
  (`_isCrimpContactRow`) → כלי קיים ב-DB → `aiFindCrimpTools` (`ai/tooling.js`, Anthropic web search, fallback בלי חיפוש) →
  מחיר מ-`lookupPartPrices`. `tool_source` = db / known / web / ai, `tool_url` = מקור. ה-aiProxy מעביר רק את כלי web_search
  (`aiSafeTools`, עד 12 חיפושים) — דורש deploy של functions והפעלת Web search ב-Anthropic Console.

## חשבון משתמש ושמירה ל-DB עם התקדמות

- **שכחתי סיסמה**: `web/index.html` → `sendPasswordResetEmail`. ההודעה זהה גם לאימייל שלא קיים
  (לא חושפים אילו כתובות רשומות). את תבנית המייל עורכים ב-Firebase Console → Authentication → Templates.
- **החלפת סיסמה**: הכפתור 👤 בסרגל העליון (`main.js`) → `openAccountModal()` ב-`features/account.js`:
  `reauthenticateWithCredential` עם הסיסמה הנוכחית ואז `updatePassword`. נרשם ביומן: `password_changed`.
- **פס התקדמות**: `progressPanel(host,label)` ב-`core/ui.js`. פונקציות השמירה ב-`data/parts.js`
  (`saveBOMToPartStock`, `savePriorityImport`, `saveToolsImport`) מקבלות `onProgress(done,total)` אופציונלי.

## מפתח ה-AI — בשרת

כל בקשה למודל עוברת ב-`_aiFetch` (`ai/client.js`):

- הבקשה נשלחת תמיד ל-Cloud Function ‏`aiProxy` עם ה-ID token של Firebase. הפונקציה בודקת
  שהמשתמש קיים ולא מושבת, אוכפת מכסה (`enforceRate`), מוסיפה את המפתח מ-`secure_config/ai_api`
  (חסום לכל דפדפן ב-`firestore.rules`), ומחזירה את תשובת Anthropic כמו שהיא — אותו status, אותו JSON.
- **אין יותר קריאה ישירה מהדפדפן ל-Anthropic** (בוטלה ב-v1.74.0, M5). בלי מפתח בשרת — `_aiReady()` מחזיר false
  ומוצג חלון "AI not set up".

המפתח נשמר במסך Admin → AI API Keys דרך `apiConfig` (רק admin). אחרי שמירה בשרת
האפליקציה מוחקת את העותקים הישנים: `localStorage` ו-`anthropic_key`/`gemini_key`
במסמך החברה (שכל משתמש מחובר יכול לקרוא). בדיקות: `tests/functions-harness.js`.

## שלב 2 — הושלם (v1.60.0)

- כל קריאות Firestore עברו מהמסכים ל-`data/`.
- התרגום של פירוק זמן העבודה עבר ל-`ai/translate.js` (`aiTranslateOperations`).
- `aiProxy` — מפתח Anthropic לא נמצא יותר בדפדפן.

## אבטחה (v1.72–v1.74)

- **הרשאות** נאכפות ב-`firestore.rules` (בדיקות: `tests/rules/rules.test.mjs` באמולטור). viewer = קריאה בלבד בכל מקום;
  משתמש לא יכול לשנות לעצמו role / company / disabled; יצירה ושינוי משתמשים רק דרך Cloud Function ‏`userAdmin`.
- **מחיקה**: כולם מעבירים לסל מחזור (`deleted:true` + `deleted_at`), רק admin מוחק לצמיתות.
- **יומן**: רשומה נכתבת רק בשם המשתמש המחובר (`user`, `userId`) ובשעת השרת. פעולות admin נכתבות בשרת (`serverAudit`).
- **תמיכה**: משתמש רואה רק את הפניות שלו (`listMyTickets`) ולא משנה status ל-done.
- **מכסות** בשרת: `RATE_LIMITS` ב-`functions/index.js` (מסמכי `usage/{uid}_{kind}_{date}`).
- **CSP** נכתבת ע"י `tools/stamp-release.js` (עם hash של ה-inline scripts) בין `<!-- csp:begin -->` ל-`<!-- csp:end -->`
  ב-`app.html` וב-`index.html`. לא להוסיף `onclick=` או סקריפט inline בלי להריץ stamp מחדש; כפתורי סגירה: `data-close-modal`.
- ספריות CDN עם `integrity` (SRI); `xlsx` נשמר מקומית ב-`web/vendor/`.
- גיבויים: `docs/BACKUPS.md`.

## עמודות קבועות וחלונית ההערות (v1.75)

- `freezeLeftColumns(table, count)` (`core/table.js`): תיבת הסימון + 3 העמודות הראשונות (`SD_FROZEN_COLS`, `PS_FROZEN_COLS`)
  נשארות במקום בגלילה ימינה (position:sticky). המיקומים הם סכום הרוחבים של הכותרות (לא המיקום שלהן — תא קבוע בטבלה גלולה נמצא איפה שהוא תקוע) ומתעדכנים בשינוי רוחב/סדר/Compact
  ובכל רינדור של ה-tbody. בחלון צר (הבלוק > 75% מהרוחב) נשארות פחות עמודות. טבלה כזו מקבלת `has-frozen`
  (border-collapse:separate), אחרת הגבולות "נשארים מאחור" והטקסט הנגלל מציץ ביניהם.
  שורה שמשתרעת על כל הטבלה (שורת שרטוט) שומרת את התווית שלה בעזרת `.row-label-sticky`.
- חלונית Notes ב-Sales Desk היא `<details>`: מקופלת לשורה אחת עם מספר ההערות ומספר ההערות שמזכירות מסמך/תקן.
  פתוח/סגור נשמר לכל משתמש (`ui_prefs.sd_notes_open`).

## קריאת שרטוט בלי חלון בדיקה, רוחב עמודות, יציאה מהדסק (v1.76)

- `handleSDFiles` (`features/salesDesk/import.js`): אין יותר `showBOMPreview` בדסק. אחרי הקריאה — `_sdAddImportedRows` →
  `saveBOMToPartStock` → `runFCCheckModal(items,'sd',{headless:true})` (אותה בדיקת מחיר, בלי חלון משלה, עם `onProgress`;
  `saveToDb:false` לתפקיד קריאה-בלבד). כל שלב מוצג ב-`stagesPanel` (`core/ui.js`). RFQ עדיין משתמש ב-`showBOMPreview`.
- רוחב עמודות (`makeTableResizable(table, storageKey)`, `core/table.js`): בגרירה הראשונה הטבלה עוברת ל-`table-layout:fixed`
  (`lockTableLayout`) — כל עמודה ברוחב שלה, והעמודות שאחריה זזות. הרוחב נשמר ב-localStorage (`colWidths_<key>`) ומוחזר בכל רינדור.
- יציאה מהדסק: `S._leaveGuard` (נקבע ב-`renderSalesDesk`, נבדק ב-`route()`, `route(v,{force:true})` עוקף). שואל רק על **שינוי של המשתמש** (v1.77):
  כל שורה זוכרת איך נראתה כשהייתה מתואמת עם ה-Database (`_sdMarkClean`, WeakMap). שלבים אוטומטיים — קריאת שרטוט שנשמרה, Add from Database,
  Check Price, Save — מסמנים כ"נקי" את מה שלא היה משונה לפניהם (`_sdMarkCleanExcept`). `_sdPendingDbParts` סופר שורות משונות עם מק"ט
  ש-`_sdDbPatch` מוצא בהן מה לכתוב (או שאין להן רשומה). מחיקת שורה / שינוי Units לא נחשבים. גם `beforeunload`.

## זמני שלבים בקריאת שרטוט (v1.78)

- `stagesPanel` (`core/ui.js`) מודד כל שלב ב-`performance.now()` (לא `Date.now` — הוא מוקפא בכלי הצילומים) ומציג ⏱ לכל שלב ושורת "Total time".
  הזמנים נרשמים בלוג `sales_desk_add_from_drawing` (`ms`, `stage_ms`). `fmtDuration(ms)` לתצוגה.

## עיצוב Copper & Graphite (v1.79)

- `css/06-theme.css` נטען אחרון ודורס את הקודמים: גופני IBM Plex (Sans, Mono, Sans Hebrew) מקומיים ב-`web/vendor/fonts`
  (רישיון `OFL-IBM-Plex.txt`, בלי CDN — לא צריך לשנות CSP), סרגל עליון גרפיט עם קו נחושת, רקע נייר עם רשת שרטוט.
- הצבעים הם טוקנים ב-`:root` של `01-base.css` (השמות הישנים `--blue-*` נשארו, הערכים גרפיט/נחושת) ו-`06-theme.css`
  (`--primary`, `--ink`, `--link`, `--info-bg`, `--ok`, `--bad`, `--chip-*`). ב-JS לא כותבים hex — רק `var(--…)`.
  ירוק/אדום/כתום של מחיר ואזהרה נשארו עם המשמעות שלהם. Cut & Strip ומסמך הייצור (הדפסה) לא שונו.
- משמעות מחלקות הכפתורים: `btn-green` = כפתור עיקרי (נחושת, אחד בכל מסך); `btn-blue`/`btn-purple` = משני (לבן עם מסגרת);
  `btn-red` = טקסט אדום, ובתחתית חלון (`.modal-footer`) מלא אדום לאישור מחיקה. דריסות לפי id ב-`06-theme.css`
  (`#btn-sd-file`, `#btn-ps-fc`, `#btn-cs-new` עיקריים).
- `core/icons.js`: אייקוני SVG בקו (`icon(name,size)`), `EMOJI` ממפה אמוג'י לאייקון, ו-`watchIcons(document.body)` (MutationObserver ב-`main.js`)
  מחליף אמוג'י בתחילת טקסט של כפתורים, כותרות, `th`, `label`, `.empty-ic` וכו'. אפשר להמשיך לכתוב אמוג'י בקוד/במדריך — הוא יוחלף בתצוגה.
  המסמך ב-Word שומר את האמוג'י.
- `router.js`: `HOME_BUTTONS` = `[icon, label, desc, group]`, מסך הבית מחולק ל-Work/Manage (`.home-wrap`, `.home-band`), `TITLES` בלי אמוג'י,
  `body.dataset.view` לפי המסך. בסרגל: `#tb-brand` (לוגו + שם חברה → בית) ו-`#btn-home` (`Home ›`).
- ייצוא Excel (`io/excel.js` `_XL`, `salesDesk/export.js`) באותם צבעים: גרפיט בכותרות, נחושת בשורת המחיר לכמות.

