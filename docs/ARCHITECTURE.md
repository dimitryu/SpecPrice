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

## v1.80 — Cut & Strip / הוראות ייצור בעיצוב, ייצוא Excel בלי ספקים

- **מסמכי Cut & Strip והוראות ייצור** (`02-cutstrip.css`, שניהם על `.cs-sheet`): צבעים כמשתנים מקומיים `--cs-*` על `.cs-sheet`
  (hex קבועים — הדף מודפס ולא תלוי בערכת המסך). קו נחושת מתחת לכותרת, `cs-h2` גרפיט עם פס נחושת, מספרי שלבים בנחושת.
  התיבות `cs-info` / `cs-info-total` הן מחלקות (לא inline) ונכתבות כ-`.cs-sheet[dir] .cs-box.cs-…` — כלל `.cs-box` לפי `dir`
  קובע את צבע הפס בצד ואחרת גובר. אדום (TBC, CRITICAL) וכתום (אזהרה) נשארו עם המשמעות שלהם. הציורים (`figures.js`) באותה פלטה.
- בסרגל העליון: שפה כ-`.tb-seg` (השפה הפעילה `is-on` בנחושת), Print/Save הם הכפתור העיקרי. כותרת ארוכה נחתכת ב-…,
  ו-`.topbar .btn-ghost:hover` מוגדר במפורש (ה-hover של הדף צבע אותו אפור).
- **הדפסה:** `html, body { height:auto; overflow:visible }` ב-`@media print` (`03-components.css`) — בלי זה כל הדפסה יצאה עמוד אחד.
- **ייצוא Excel של Sales Desk** (`salesDesk/export.js`): עמודות Item … Units ו-Part Cost בלבד (A–H). אין מחירי/מלאי ספקים, Priority,
  זמן עבודה או תעריף, ואין מקור/קישור ברשימת הכלים. Part Cost = המחיר ליחידה של המקור שהאפליקציה בחרה (`r._costSource`) × QTY
  באותה המרה כמו `_sdLineCost` (mm ÷304.8 או ÷1000, ml בבקבוקים) — אם יוצא שונה מ-`r.total` נופלים ל-`r.total/qty × QTY`.
  Labor הוא תא צהוב אחד (מחיר לכבל). `tests/xl-export-harness.js` בודק גם sheetPr, merges, ושכל נוסחה מחושבת זהה לאפליקציה.

## v1.81 — כל ניתוח שרטוט: שלב-שלב עם זמנים, וממשיך ברקע

- שלושת החלונות שקוראים שרטוט משתמשים ב-`stagesPanel` (`core/ui.js`): Sales Desk → New Drawing (`salesDesk/import.js`),
  Cut & Strip → New from Drawing (`cutstrip/import.js`), RFQ → Add Drawing (`bomImport.js`). כל קריאת AI היא שלב משלה
  (BOM, טבלת כותרת, תהליך ייצור, הערות, כלים; ב-C&S: הכנה, ניתוח, רשימת חלקים, חיווט/תוויות, תמונת ייחוס, datasheets, שמירה, תרגום).
- שעון השלב צובר: שלב שרץ שוב (השרטוט הבא) מוסיף לזמן שלו (`acc`), ו-`totalMs()` הוא שעון-קיר מההתחלה לסוף. `finish(text, ok)` מסמן
  שלבים שלא רצו כ-skip ומסיים את ה-job. הזמנים נרשמים ביומן (`stage_ms`): `sales_desk_add_from_drawing`, `cut_strip_generated`, `rfq_drawing_read`.
- **ברקע:** שום דבר בניתוח לא מחכה ללשונית גלויה. בזמן שהלשונית מוסתרת הפאנל לא מצויר מחדש כל שנייה (פחות CPU — Chrome מקפיא
  רק לשונית "CPU-intensive" במצב Energy Saver אחרי 5 דקות). `backgroundJob()`: כותרת הלשונית `⏳ <שלב> — SpecPrice`, ובסוף `✓ …` עד
  שחוזרים; `beforeunload` שואל לפני סגירה רק בזמן ריצה. בדיקה: `tests/stages-harness.js`.
- C&S: הדף נבנה מאחורי החלון, והחלון נשאר עם Total time וכפתור `#cs-import-close` ("Open the sheet").
- RFQ: אחרי הקריאה השלבים נשארים מעל טבלת הבדיקה ב-`<details class="stages-done">` מקופל.

## v1.82 — מודל לכל משימה, חשיבה כבויה, שרטוט קצה כמו הכבל

- **הכשל ב-C&S ("The AI returned an empty response" אחרי ~6 דקות):** `claude-sonnet-5` חושב כברירת מחדל (adaptive),
  והחשיבה נספרת ב-`max_tokens`. בשרטוט צפוף (WLS-090-009, 2 גיליונות) כל 16,000 הטוקנים הלכו לחשיבה — התשובה הייתה בלי טקסט,
  וה"המשך" נבנה על prefill ריק. עכשיו: `ask()` עוצר מיד על תשובה בלי טקסט עם `max_tokens` (`_csThoughtOut()`), והחשיבה מכובה.
- **ניתוב (`ai/client.js`):** `AI_TASKS` + `aiBody(task, base)` + `aiModelFor(task)`. READ = `_csModel()` (Sonnet 5) לקריאת שרטוט
  מתמונה ולחיפוש כלים; LIGHT = `claude-haiku-5-5` לטקסט ולמשימות קטנות. `thinking:{type:'disabled'}` לכל משימות הקריאה;
  `tools_web` נשאר adaptive עם `output_config.effort:'low'`. `_task` רק לניתוב — `_aiFetch` מוחק אותו לפני השליחה.
- **תלות בשרת:** `aiProxy` מעביר `thinking`/`output_config` (מסונן) ומחזיר ב-GET `thinking:true` → `S.aiThinkCtl` (`aiProbeProxy`).
  בלי זה: LIGHT נשאר `claude-haiku-4-5-20251001` (לא חושב), ו-READ מקבל `max_tokens` מינימלי (`min`) כדי שיהיה מקום לחשיבה.
  `_aiFetch` חוזר פעם אחת: מודל קטן חדש נדחה → הישן (`S._aiLightDown`); `thinking` נדחה → בלי (`aiThinkCtl=false`).
- **שרת:** רשימת מודלים מותרת `AI_MODELS_ALLOWED` (sonnet-5, sonnet-5-5, haiku-5-5, haiku-4-5-20251001) — מודל חדש נוסף כאן ובאפליקציה יחד.
  **דורש `firebase deploy --only functions`.**
- **שרטוט קצה (`_csStripSVG`, `figures.js`):** המעטה בצבע מהתיאור (`_csJacketColor`), וכבל רב-גידי נפתח לגידים (`_csEndWires`):
  צבע (`_csWireColor`, כולל פס לדו-צבעי), עובי לפי AWG, legs באורך שלהם, תווית צבע → פין/יעד. גיד יחיד — כמו קודם.
- בדיקות: `tests/ai-routing-harness.js`, ותוספות ב-`cs-harness.js` וב-`functions-harness.js`.


## v1.82.1 — מערכת עיצוב כתובה וניגודיות
- **`DESIGN.md`** בשורש הפרויקט: מערכת העיצוב Copper & Graphite כמקור האמת לכל החלטה ויזואלית (טוקנים, גופנים, מרווחים, רכיבים, נגישות, יומן החלטות).
- ניגודיות: `--muted` #6B6F76 → **#666A71** (4.47 → 4.81), `--ok`/`--green` #2E7D4F → **#2A7349** (4.33 → 4.94). גם ב-`index.html`.

## v1.83 — Database נפתח מהר, ו-hover ברור
- **טעינת רשימת החלקים (`data/parts.js`):**
  - `prefetchParts()` — מסך הבית מתחיל לקרוא את `parts_cache` כשהדפדפן פנוי, ומיד כשהעכבר מגיע לכרטיס Database / Sales Desk. קריאה אחת לסשן.
  - `loadParts()` — משתף קריאה שכבר רצה (`_partsFetch`). קריאה שהתחילה **לפני** ש-`S.allParts` נוקה לא נחשבת — נקרא שוב. כך כל המקומות שעושים `S.allParts=[]; await loadParts()` אחרי שמירה ממשיכים לקבל נתונים טריים.
  - `peekParts(n)` — `query(limit(n))` למבט ראשון בלבד (בלי מחוקים). לא מחפשים / ממיינים / מייצאים ממנו.
  - `refreshParts()` — קריאה חוזרת ברקע; מחזיר true רק אם טביעת האצבע (`S._partsSig`) השתנתה. `S._partsAt` — מתי נקרא.
- **מסך Database (`features/database.js`):**
  - `renderPartStock(filter, {revalidate})` — רשימה בזיכרון: מצייר מיד, ואז `refreshParts()` ברקע (רק אם הרשימה בת יותר מ-20 שניות, `PS_FRESH_MS`).
  - טעינה קרה: מסגרת טבלה עם שורות placeholder (`.ps-skel`) → השורות הראשונות (`PS_PEEK_MAX`=100) עם "First n parts — loading the rest…" → הטבלה המלאה. כל הפקדים נעולים עד שהכול נטען.
  - `_psRender` — הציור עצמו (מה שהיה גוף `renderPartStock`). `_psRedrawQuietly` — ציור חוזר ששומר חיפוש+סמן, שורות מסומנות וגלילה; מחכה אם פתוח חלון או עורכים תא.
  - `_psAutoPurge` רץ **אחרי** הציור ולא חוסם אותו. Refresh משאיר את הטבלה ומסובב אייקון.
  - הנתב כבר לא מנקה `S.allParts` בכניסה ל-Database.
- **Hover = lit (`06-theme.css`):** כפתור/כרטיס מתחת לעכבר נדלק בנחושת כמו הראשי; הראשי באותה שורה חוזר למסגרת (`:has()`); אדומים נדלקים באדום; `:focus-visible` כמו hover.
- Stub של Firestore (`tests/smoke`) מכיר `limit` ו-`__partsDelay`/`__peekDelay`. בדיקות: `tests/db-load-harness.js` (20), `db-harness.js` מחכה ל-purge שרץ אחרי הציור.

## v1.83.1 — כל לחיצה עונה מיד
- **הסיבה:** עם "All" (או 500) בעמוד, טבלה של ~1200 שורות לקחה כ-3 שניות לפריסה (layout) — בפתיחה, ושוב אחרי כל מיון, חיפוש וסגירת חלון (סגירת Deleted items קראה ל-`renderPartStock` מיד).
- **שורות לפי גלילה (`features/database.js`):** `PS_FIRST_ROWS`=40 שורות מצוירות מיד, ו-`PS_MORE_ROWS`=60 נוספות כשהגלילה מתקרבת לסוף (`_psMoreRows`, מאזין `scroll` על `#ps-table-wrap`), עם שורת "Showing n of N — scroll down for more". לפני המנה הראשונה רוחבי העמודות ננעלים (`lockTableLayout`) כדי שהפריסה תהיה רק של השורות החדשות.
- **בחירה ב-`_psSel` (Set):** סמן-הכול בוחר את כל שורות העמוד, גם אלה שלא צוירו; `_psSyncSel()` מסנכרן מתיבות הסימון שעל המסך. Check Price / Export / Delete קוראים ממנו (`_psSelected()` לבדיקות).
- מאזינים לשורות (קישור שרטוט, Stock) עברו ל-delegation על הטבלה, כך שהם עובדים גם לשורות שנוספות בגלילה.
- **`afterPaint(fn)`** ב-`core/ui.js`: עבודה שאחרי לחיצה רצה אחרי שהמסך צויר. Deleted items: סגירה מצוירת מיד; ציור הטבלה מחדש רק אם שוחזר/נמחק משהו, ואחרי שהחלון נעלם.
- Check Price: מסגרת החלון מצוירת קודם, והשורות (עד ~1200) נכנסות בפריים הבא.
- חיפוש: debounce ירד מ-260 ל-150 ms.
- מדידות (1200 חלקים, All): פתיחת Database 3.3s→0.1s, מיון 2.6s→0.05s, סגירת Deleted items 2.9s→0.03s.

## v1.83.2 — שרטוט בלי טבלת חלקים: קריאת התוויות
- **הבעיה:** בשרטוט 70299220 אין טבלת BOM; כל חלק כתוב בתווית על קו מוביל, ורק ל-3 מתוך 8 יש בלון. קריאת הדף כולו עם פרומפט ה**טבלה** החזירה רק את 3 המבולונים.
- **איתור (`_BOM_LOCATE_PROMPT`):** כשאין טבלה, המודל מחזיר `{"found":false,"labels":N,"box":[…]}` — כמה תוויות עם מק"ט ואיפה השרטוט. `_bomLocateAll()` מחזיר `{table, callouts}`; `_bomParseCallouts()` מפענח (אחוזים/פיקסלים כמו באיתור טבלה). `_bomLocate()` נשאר ומחזיר רק את הטבלה.
- **קריאת תוויות (`_BOM_CALLOUT_PROMPT`, sourceType `'callouts'`, task `bom_image`):** כל תווית עם מק"ט, עם בלון או בלי; `<MAKER> PN:` → part_number + manufacturer; `<COMPANY> PN:` (EYAL) → atlantium_pn; `x2` → qty 2; חוט → אורך במ"מ מהמידה; NOTES / כותרת / רוויזיות אינם חלקים.
- **זרימה (`_bomFromPDF`):** שלב 2b — אזור השרטוט מרונדר חד (`crop`); אם נקראו פחות חלקים מ-`labels` — גם הדף כולו, ואיחוד `_bomUnionByPart` (כפילות = אותו מק"ט יצרן **או** אותו מק"ט חברה; RNF-100-1/4-0 ו-1/8-0 נשארים שניים). שלב 3 (שום דבר לא אותר): הדף כולו גם בפרומפט הטבלה וגם בפרומפט התוויות — נשמרת הקריאה עם יותר חלקים. `how='callouts'`, `fromImage` true.
- **Sales Desk:** היצרן מהשרטוט (או מה-Database) עובר לעמודת Manufacturer בייבוא (`_sdAddImportedRows`), במקום להישאר ריק עד Check Price.
- Admin → AI prompts מציג את פרומפט האיתור ואת פרומפט התוויות. `tools/guide/lib.js`: `opts.ai(body)` לתשובות AI של סקריפט בדיקה.
- בדיקות: 18 ב-`app-logic.test.js` (פענוח, איחוד, תוכן פרומפטים). זרימה מלאה עם הקובץ האמיתי ו-AI מדומה: 8/8 בשלושה מצבים (איתור עם תוויות; קריאה ראשונה חסרה → דף מלא; איתור בלי תוויות → שלב 3).

## v1.83.3 — תווית אחת = שורה אחת
- בייבוא אמיתי של 70299220 נוספה שורה כפולה "AWG-24 BLACK" בלי MNF P/N ובלי Customer PN (התווית נקראה פעמיים — פעם עם המק"טים ופעם בלעדיהם).
- `_bomCalloutTidy(rows)`: שורה בלי מק"ט יצרן ובלי מק"ט חברה נמחקת אם לשורה אחרת יש אותו תיאור, או אם אין לה תיאור בכלל; שורה כזו שעומדת לבד נשארת פעם אחת. שתי שורות **עם** מק"ט ועם אותו תיאור (שני שרוולי כיווץ) נשארות שתיהן.
- `_bomUnionByPart`: קריאה שנייה לא מוסיפה שורה בלי מספרים שהתיאור שלה כבר קיים (בלי תלות ביצרן).
- הפרומפט: סעיף "ONE LABEL = ONE ROW".
- בדיקות: 7 נוספות ב-`app-logic.test.js`; זרימה מדומה עם השורה הכפולה → 8 חלקים.

## v1.83.4 — אורך חוט בשרטוט בלי טבלה
- ב-70299220 יצא AWG-24 RED באורך 85 (המידה עד הנגד) במקום 130. לפי דימה: שני החוטים, אדום ושחור, 130.
- `_BOM_CALLOUT_PROMPT`: חוט שעובר מקצה לקצה מקבל את **המידה הכוללת**, גם כשבאמצעו רכיב (נגד, דיודה, חיבור, שרוול כיווץ). מידה קצרה שמסתיימת ברכיב רק מציינת איפה הרכיב. חוטים זה לצד זה בין אותם שני קצוות — אותו אורך. מידה קצרה רק לחוט שבאמת נגמר שם.
- בדיקה ב-`app-logic.test.js`.

## v1.83.5 — מספר סידורי (#) ב-Sales Desk
- עמודה **#** קבועה אחרי תיבת הסימון: 1…N **בתוך כל שרטוט**, לפי הסדר ב-`sdItems` (שורות השרטוט, ואחריהן מה שנוסף מה-Database לאותו שרטוט). כוללת גם שורות TOOL.
- `_sdItemNumbers(rows=sdItems)` → `Map(row → n)`. מחושב בכל ציור ו**לא נשמר על השורה** — לא מגיע ל-Database. נשאר צמוד לשורה במיון ובסינון; מתעדכן במחיקה/הוספה.
- הקפאה: `freezeLeftColumns(…, 2+SD_FROZEN_COLS)` (תיבת סימון, #, ועוד 3). colspan של שורת קבוצה ושל "No parts" = `SD_COLS.length+3`.
- Excel: עמודת Item ממוספרת עכשיו 1…N **לכל שרטוט** (קודם רצה ברצף על כל ההזמנה) — זהה למסך.
- בדיקות: 4 ב-`sd-labor-harness.js`, 3 ב-`xl-export-harness.js`.

## v1.83.6 — עמודת Item = מספר ה-ITEM / הבלון בשרטוט (מחליף את 1…N של v1.83.5)
- דימה: לא מספר רץ — מספר ה-ITEM מהשרטוט (עמודת ITEM בטבלה, או הבלון כשאין טבלה), כדי להשוות שורה-שורה. מה שהמערכת הוסיפה (TOOL) — בלי מספר.
- `_sdAddImportedRows`: `item: r.tool_source ? '' : String(r.item??'').trim()` — כלי שהמערכת מצאה (יש לו `tool_source`) בלי מספר; כלי שהשרטוט עצמו מונה שומר את ה-ITEM. Add from Database / New Row — בלי מספר.
- Sales Desk: העמודה **Item** (אחרי תיבת הסימון, קבועה) היא `<input class="sd-item">` שניתן לתקן; מיון בלחיצה על הכותרת (`_sdItemCompare`: טבעי, 2 לפני 10, "3A" אחרי 3, ריקים תמיד בסוף); החיפוש כולל את ה-Item. הוסר `_sdItemNumbers`.
- Excel: עמודת Item = `r.item` (מספר רגיל נכתב כמספר; ריק לכלים/חלקים שנוספו).
- **לא נשמר ב-Database:** `_sdDbPatch`/`_sdDbNewDoc`/`saveBOMToPartStock` לא כותבים `item` (נבדק).
- פרומפטים: טבלה (טקסט/תמונה) — ITEM בדיוק כפי שמודפס, מספר הבלון בשרטוט, בלי מספור מחדש/השלמה; תוויות — `item` = מספר הבלון, נקרא בדיוק, אף פעם לא ממציאים.
- בדיקות: `sd-labor-harness.js` (Item בטבלה, מיון, ייבוא, לא נשמר ב-DB), `xl-export-harness.js`, `app-logic.test.js` (פרומפטים).
