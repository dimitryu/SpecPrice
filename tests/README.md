# SpecPrice — בדיקות לוגיקה (web/app.html)

חבילת טסטים לפונקציות הטהורות של האפליקציה. אין דפדפן ואין Firebase —
הסקריפט מחלץ את ה-`<script type="module">` מתוך `web/app.html`, מוציא ממנו כל
פונקציה טופ-לוול וכל `const` בטוח, וטוען אותם כמודול Node רגיל.

## הרצה

```bash
cd tests
npm install acorn      # פעם אחת
node extract.js        # מייצר app.mjs + extracted.js מתוך web/app.html
node app-logic.test.js # מריץ את הטסטים
```

יציאה 0 = הכל עבר. יציאה 1 = יש כשלים, והם מודפסים עם expected/actual.

## בדיקת syntax בלבד

```bash
node extract.js && node --check app.mjs
```
מספרי השורות ב-`app.mjs` תואמים ל-`web/app.html` (הקובץ מרופד בשורות ריקות).

## מה מכוסה

dedupe של שורות TOOL ב-BOM, נרמול יחידות (mm/pc/gr), פירוק גיליון BOM
מובנה, זיהוי סוגי שורות ב-ERP, JSON מה-AI, חיפוש בוליאני, מטבעות, price
breaks של FindChips, ייבוא Priority, חישובי Sales Desk (עלות + labor),
רינדור תאים, pager, סדר עמודות, ושלמות הפרומפטים.

`extracted.js` ו-`app.mjs` הם קבצים נגזרים — לא לערוך אותם ידנית.
