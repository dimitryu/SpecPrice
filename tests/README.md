# SpecPrice — בדיקות

הקוד נמצא ב-`web/js` כ-ES modules. הבדיקות לא צריכות דפדפן:

```bash
cd tests
npm install                 # פעם אחת (acorn, acorn-walk, jsdom, exceljs)
node extract.js             # מאחד את כל המודולים ל-extracted.js
node app-logic.test.js      # 1,039 בדיקות לוגיקה
node cs-harness.js          # Cut & Strip + הוראות יצור (DOM)
node db-harness.js          # Database וסל מחזור
node sup-harness.js         # תמיכה
node bom-harness.js         # זיהוי BOM מ-PDF
node sd-labor-harness.js    # Sales Desk — זמני עבודה
node --import ./smoke/register.mjs smoke/run.mjs   # טוען את האפליקציה האמיתית כ-ES modules ופותח כל מסך
```

`extract.js` מאחד את המודולים לקובץ אחד (בלי שורות import/export) — זה בדיוק הקוד שהיה
בקובץ האחד לפני הפיצול, ולכן אותן בדיקות רצות עליו. `S` (state משותף) נחשף גם כמשתנים
גלובליים, כך שבדיקה יכולה לכתוב `companyId='c1'` או לקרוא `allParts`.

`smoke/run.mjs` בודק מה שהבדיקות האחרות לא יכולות: שכל ה-imports מתחברים, ששום מודול לא
קורא קבוע של מודול אחר לפני שהוגדר, ושכל מסך נטען בלי שגיאה. Firebase מוחלף ב-stub מקומי
(`smoke/firebase-*.mjs`).

`extracted.js` הוא קובץ נגזר — לא לערוך ידנית.
