import { S } from '../../core/state.js';
import { _AI_NO_KEY, _aiReady } from '../../ai/client.js';
import { _csTranslateChunk } from '../../ai/translate.js';
import { toast } from '../../core/ui.js';
import { _csConnectors, _csSegments } from '../../domain/cutstrip.js';

// ── Translation ───────────────────────────────────────────────────────────────
// This screen behaves differently from the Labor Breakdown dialog, on purpose.
// A breakdown is read by whoever is quoting; a cut & strip sheet is read at the
// bench, by the same people, every day. So Hebrew is the default and the choice
// STICKS: making an operator press a language button every single time they open
// a work instruction is friction with no upside.
//
// English remains the stored source of truth — the AI produces English, and
// Hebrew and Russian are translations of it. That matters for editing: see
// _csT and _csCollectEdits.
export const _CS_CACHE_KEY='cut_strip_tr_cache';
export const _CS_LANG_KEY='cut_strip_lang';
// The language every analysis is written in, regardless of what the screen is
// showing. Kept separate from the DISPLAY language on purpose: the sheet is a
// shop-floor document in Hebrew, and having one source language means a spec
// reads the same however it was created, and there is a single path to every
// other language rather than one path per starting point.
export const _CS_SOURCE_LANG='he';
export let _csLang = (()=>{
  try{ const v=localStorage.getItem(_CS_LANG_KEY); return ['en','he','ru'].includes(v) ? v : 'he'; }
  catch{ return 'he'; }
})();
export function _csSetLang(l){
  _csLang=l;
  try{ localStorage.setItem(_CS_LANG_KEY,l); }
  catch(e){ console.warn('[CutStrip] language choice not saved:', e.message); }
}
export let _csCache = (()=>{
  try{ const c=JSON.parse(localStorage.getItem(_CS_CACHE_KEY))||{}; return {he:c.he||{}, ru:c.ru||{}}; }
  catch{ return {he:{}, ru:{}}; }
})();
export function _csSaveCache(){
  try{ localStorage.setItem(_CS_CACHE_KEY, JSON.stringify(_csCache)); }
  catch(e){ console.warn('[CutStrip] translation cache not saved:', e.message); }
}
export function _csRTL(){ return _csLang==='he'; }
export const _CS_LANG_NAMES={en:'English', he:'עברית', ru:'Русский'};

// Fixed chrome. Kept as a table rather than sent to the AI so the structure of
// the sheet never depends on a network call — a failed translation must leave a
// readable document, not a skeleton.
export const _CS_LABELS={
  he:{
    "The dimension is the finished harness, connectors included — so nothing is added for the ends, each connector body comes OFF, and the piece is never cut longer than the drawn length. The strip is taken OUT of this length, not added to it.":"המידה היא הצמה המוגמרת כולל המחברים — לכן לא מתווסף דבר עבור הקצוות, אורך גוף כל מחבר יורד, והחתיכה לעולם לא נחתכת ארוכה מהמידה שבסרטוט. החשיפה נלקחת מתוך האורך הזה, לא מתווספת אליו.",
    "Not on the drawing — proposed from the wire gauge. Confirm against the contact datasheet.":"לא מופיע בסרטוט — הוצע לפי עובי החוט. לאמת מול דף הנתונים של המגע.",
    "This sheet was built from an incomplete reply":"הדף הזה נבנה מתשובה חלקית",
    "The analysis ran out of room before it finished, so part of the drawing is missing from this sheet. Everything shown was read from the drawing and is as good as any other sheet — but check that every run, end and connector you see on the drawing is here before using it, and fill in what is not.":"לניתוח נגמר המקום לפני שסיים, ולכן חלק מהסרטוט חסר בדף הזה. כל מה שמוצג נקרא מהסרטוט ותקף כמו בכל דף אחר — אבל לפני שימוש יש לוודא שכל מקטע, קצה ומחבר שרואים בסרטוט מופיעים כאן, ולהשלים את מה שחסר.",
    "no strip dimension on the drawing — fill it in":"אין מידת חשיפה בסרטוט — יש להשלים",
    "No figure could be drawn for":"לא ניתן לצייר סרטוט עבור",
    "this end has no dimensions at all on the specification.":"לקצה הזה אין אף מידה במפרט.",
    "The Length column is what you CUT. It is worked out from the drawing’s dimension and from what that dimension measures — stated per run below. Strip is jacket / conductor.":"עמודת האורך היא מה שחותכים. היא מחושבת מהמידה שבסרטוט ומהאופן שבו המידה נלקחת — מצוין לכל מקטע למטה. החשיפה היא מעטפת / מוליך.",
    "The harness is made of":"הצמה מורכבת מ",
    "each":"כל אחד",
    "total":"סה\"כ",
    "wires":"גידים",
    "connector(s) — nothing was subtracted for them, so the piece is cut to the full drawn length.":"מחברים — לא הופחת עבורם דבר, ולכן החתיכה נחתכת לאורך המלא שבסרטוט.",
    "Allowances were held back to keep the piece within the drawn length.":"התוספות נעצרו כדי שהחתיכה לא תעבור את המידה שבסרטוט.",
    "Datasheet":"דף נתונים",
    "Cut the stock below into pieces, then lay the pieces together into the harness.":"לחתוך את החומר שלמטה לחתיכות, ואז להרכיב מהן את הצמה.",
    "On the BOM":"ב-BOM",
    "Cut into":"לחתוך ל-",
    "Left over":"נשאר",
    "the wiring table lists":"בטבלת החיווט רשומים",
    "conductors":"מוליכים",
    "The BOM gives":"מה-BOM יוצאות",
    "pieces but the wiring table lists":"חתיכות אבל בטבלת החיווט רשומים",
    "The signature column is for a pen — type initials here only if your process accepts a typed name.":"עמודת החתימה מיועדת לחתימה בעט — להקליד שם כאן רק אם התהליך שלכם מאשר שם מוקלד.",
    "Looking up connector datasheets…":"מחפש דפי נתונים למחברים…",
    "Contact":"מגע",
    "Manufacturing instructions":"הוראות יצור",
    "Document":"מסמך",
    "Doc no.":"מס' מסמך",
    "Rev":"מהדורה",
    "Drawing #":"מס' סרטוט",
    "Title":"שם",
    "Steps":"שלבים",
    "Updated":"עודכן",
    "Assembly name":"שם המכלול",
    "Material list":"רשימת חומרים",
    "Manufacturer":"יצרן",
    "Ref":"סימון",
    "Add material":"הוסף חומר",
    "Operation sequence":"רצף פעולות",
    "Step title":"כותרת שלב",
    "CRITICAL":"קריטי",
    "No steps yet.":"אין עדיין שלבים.",
    "Add step":"הוסף שלב",
    "No checks yet.":"אין עדיין בדיקות.",
    "Add check":"הוסף בדיקה",
    "Tools & consumables":"כלים וחומרים מתכלים",
    "Tool":"כלי",
    "Setting":"כיוון",
    "Note":"הערה",
    "Add tool":"הוסף כלי",
    "New instruction":"הוראה חדשה",
    "From a Cut & Strip spec":"מתוך מפרט חיתוך וחשיפה",
    "No manufacturing instructions yet":"אין עדיין הוראות יצור",
    "A manufacturing instruction holds the material list, the order of operations, the inspection checks and the tooling for one assembly. Write one from scratch, or take the starting content from a cut & strip specification and edit it.":"הוראת יצור מכילה את רשימת החומרים, רצף הפעולות, הבדיקות והכלים של מכלול אחד. אפשר לכתוב מסמך חדש, או לקחת תוכן התחלתי ממפרט חיתוך וחשיפה ולערוך אותו.",
    "Search instructions…":"חיפוש בהוראות יצור…",
    "Nothing matches that search":"אין תוצאות לחיפוש",
    "This document is independent of the cut & strip specification it came from — saving here changes nothing there.":"המסמך הזה עצמאי מהמפרט שממנו הועתק — שמירה כאן לא משנה שם כלום.",
    "Workmanship":"תקן ביצוע",
    "Edit":"עריכה",
    "Editing":"עריכה",
    "Save":"שמור",
    "Cancel":"ביטול",
    "Print":"הדפסה",
    "Back":"חזרה",
    "The drawing’s length is measured":"האורך בסרטוט נמדד",
    "to the jacket end at each end":"עד קצה המעטפת בכל צד",
    "the bare cable, connectors excluded":"הכבל בלבד, ללא מחברים",
    "over the connectors, face to face":"כולל המחברים, מפאה לפאה",
    "the drawing does not say":"הסרטוט לא מציין",
    "assumed — the drawing does not say":"הנחה — הסרטוט לא מציין",
    "No body length is on file for":"אין אורך גוף רשום עבור",
    "The drawing does not say where the length is measured from":"הסרטוט לא מציין מהיכן נמדד האורך",
    "The shop default was used — to the jacket end at each end, with the connector allowance added. If this drawing dimensions over the connectors instead, the cable is SHORTER than the figure above: set it in Edit before anyone cuts.":"נלקחה ברירת המחדל של המפעל — עד קצה המעטפת בכל צד, עם תוספת המחבר. אם בסרטוט הזה המידה נלקחת כולל המחברים, הכבל קצר מהמספר שלמעלה: יש לשנות בעריכה לפני שחותכים.",
    "The analysis read the dimension differently":"הניתוח קרא את המידה אחרת",
    "Search at":"חיפוש אצל",
    "Search for the datasheet":"חיפוש דף הנתונים",
    "No distributor holds a datasheet for this part — this is a search, not the document":"לאף ספק אין דף נתונים למק״ט הזה — זהו חיפוש, לא המסמך עצמו",
    "The analysis took the length as “{read}”. Both ends of this run are connectors, so the sheet reads the dimension as spanning them and cuts to the drawn length: cutting longer makes a harness that will not fit, and costs a whole piece out of every reel.":"הניתוח לקח את האורך כ־„{read}”. שני קצוות המקטע הם מחברים, ולכן הטופס קורא את המידה ככוללת אותם וחותך בדיוק לאורך שבסרטוט: חיתוך ארוך יותר נותן צמה שלא נכנסת, ועולה חתיכה שלמה מכל גליל.",
    "If the drawing really is measured the other way, set it in Edit and tick Confirmed — your answer then stands.":"אם בסרטוט המידה באמת נמדדת אחרת, יש לקבוע זאת בעריכה ולסמן לאימות — מאותו רגע התשובה שלכם היא הקובעת.",
    "Both ends of this run are connectors, so the dimension was taken to span them — the finished harness, connectors included. The piece is therefore cut to the drawn length and no further: the strip comes out of it. If this drawing measures to the jacket end instead, the cable is LONGER than the figure above: set it in Edit before anyone cuts.":"שני קצוות המקטע הם מחברים, ולכן ההנחה היא שהמידה נמדדת מקצה מחבר אחד לשני — הצמה המוגמרת כולל המחברים. לכן חותכים בדיוק לאורך שבסרטוט ולא יותר, והחשיפה יוצאת מתוך האורך הזה. אם בסרטוט הזה המידה נמדדת עד קצה המעטפת, הכבל ארוך מהמספר שלמעלה: יש לשנות בעריכה לפני שחותכים.",
    "This is not a ready-made cable — it is built from individual wires":"זה לא כבל מוכן — הוא נבנה מחוטים בודדים",
    "Cut {stock} of {pn} into {n} pieces of {each}.":"לחתוך {stock} מהמק״ט {pn} ל־{n} חתיכות של {each}.",
    "Lay the {n} pieces together — that bundle is the harness. Strip and terminate each end out of this length; do not cut any piece longer.":"להניח את {n} החתיכות יחד — הצרור הזה הוא הצמה. החשיפה והחיבור בכל קצה נעשים מתוך האורך הזה; אין לחתוך אף חתיכה ארוכה יותר.",
    "No part list came back for this drawing":"לא חזרה רשימת חומרים עבור הסרטוט הזה",
    "Without the BOM the sheet cannot say whether this run is a ready-made cable or a bundle built from separate wires, and it cannot work out how many pieces to cut from each reel. Re-run the analysis, or type the wire lines into the materials list in Edit.":"בלי ה־BOM הטופס לא יכול לדעת אם המקטע הזה הוא כבל מוכן או צרור שמורכב מחוטים נפרדים, ולא יכול לחשב כמה חתיכות לחתוך מכל גליל. יש להריץ ניתוח מחדש, או להקליד את שורות החוטים ברשימת החומרים דרך עריכה.",
    "The BOM carries more wire than one run needs, so the run is made up from separate wires.":"ב-BOM רשום אורך חוט גדול ממה שדרוש למקטע אחד, ולכן המקטע מורכב מחוטים נפרדים.",
    "Cut pieces":"מספר חתיכות",
    "Each [mm]":"כל אחת [מ\"מ]",
    "Total needed":"סה\"כ נדרש",
    "BOM allows":"ב-BOM קיים",
    "wires of":"חוטים באורך",
    "— one per conductor in the wiring table":"— אחד לכל מוליך בטבלת החיווט",
    "— worked out from the BOM length":"— חושב לפי האורך ב-BOM",
    "The BOM is short by":"חסר ב-BOM",
    "check the quantity before drawing material.":"יש לבדוק את הכמות לפני משיכת חומר.",
    "The BOM length divides into":"האורך ב-BOM מתחלק ל-",
    "pieces, but the wiring table lists":"חתיכות, אבל בטבלת החיווט רשומים",
    "one of the two is wrong. Resolve it before cutting.":"אחד מהשניים שגוי. יש לברר לפני החיתוך.",
    // The cutting form, in the words the works' own paper form uses.
    "Wire & cable cutting and stripping form":"טופס חיתוך ופריסות חוטים וכבלים",
    "Planning":"תכנון",
    "Execution — cut & strip":"בצוע — חיתוך וחשיפה",
    "Schematic — cut & strip":"תצוגה סכמטית — חיתוך וחשיפה",
    "Customer":"שם הלקוח",
    "Length [mm]":"אורך [מ״מ]",
    "Strip [mm]":"חשיפה [מ״מ]",
    "Operator":"שם המבצע",
    "Approval":"אישור",
    "Approved by":"אישור",
    "Approved for production":"אישור ליצור",
    "Prepared by":"ערך",
    "Name":"שם",
    "Signature":"חתימה",
    "Notes":"הערות",
    "Date":"תאריך",
    "Qty":"כמות",
    "Description":"תאור",
    "Part number":"מק״ט",
    "Revision":"מהדורה",
    "Harness layout":"מבנה המערכת",
    "Connectors":"מחברים",
    "Strip detail":"פירוט חשיפה",
    "Value":"ערך",
    "cut":"חיתוך",
    // The wire-end figure. Kept short — it is drawn inside the picture.
    "WIRE END PREPARATION":"הכנת קצה חוט",
    "STRIP INSULATION ONLY — DO NOT CUT OR NICK CONDUCTOR STRANDS":"חשיפת בידוד בלבד — אין לחתוך או לפגוע בגידי המוליך",
    "CRIMP TERMINATION — DO NOT TIN":"חיבור בקרימפ — אין לבדל את הגידים",
    "SOLDER TERMINATION":"חיבור בהלחמה",
    "DO NOT TIN STRANDS BEFORE TERMINATION":"אין לבדל את הגידים לפני החיבור",
    "Search saved specifications…":"חיפוש במפרטים שמורים…",
    "No saved specification matches that search.":"אין מפרט שמור שתואם לחיפוש.",
    "Sort by this column":"מיון לפי עמודה זו",
    "Clear":"נקה",
    "These names are not printed on the drawing":"השמות האלה לא מופיעים בסרטוט",
    "The drawing gives no designator for them, so this sheet assigned one. Match them by position, not by looking for the label.":"הסרטוט לא נותן להם סימון, ולכן הדף הזה נתן להם שם. לזהות אותם לפי המיקום, לא לחפש את התווית.",
    "seen on the drawing as":"בסרטוט נראה כ",
    "Outer covering":"ציפוי חיצוני",
    "Conductor / core":"מוליך / ליבה",
    "The layer names were not captured from the drawing — the cable is drawn generically. The dimensions are as specified.":"שמות השכבות לא נלכדו מהסרטוט — הכבל מצויר באופן כללי. המידות הן כפי שצוינו.",
    "measured inside A — it adds nothing to the cut length":"נמדד בתוך A — לא מוסיף כלום לאורך החיתוך",
    "This end adds to the cut length":"הקצה הזה מוסיף לאורך החיתוך",
    "Cutting and stripping, step by step":"הוראות חיתוך וחשיפה שלב אחר שלב",
    "Cut the cable":"חיתוך הכבל",
    "Cut {cable} to {len}.":"לחתוך את {cable} לאורך {len}.",
    "The length includes the connectors; nothing is added for the ends.":"האורך כולל את המחברים; לא מוסיפים דבר עבור הקצוות.",
    "Prepare end {ref}":"הכנת קצה {ref}",
    "Strip {mm} of the outer jacket.":"לחשוף {mm} מהמעטה החיצוני.",
    "{label}: {mm}.":"{label}: {mm}.",
    "Trim the conductors, measured from the jacket end:":"לקצר את הגידים, נמדד מקצה המעטה:",
    "Strip {mm} at the tip of each conductor and crimp terminal {pn}.":"לחשוף {mm} בקצה כל גיד וללחוץ נעל {pn}.",
    "Strip {mm} at the tip of each conductor.":"לחשוף {mm} בקצה כל גיד.",
    "Strip {mm} from each conductor for the contacts of {pn}.":"לחשוף {mm} מכל גיד עבור המגעים של {pn}.",
    "Strip {mm} from each conductor.":"לחשוף {mm} מכל גיד.",
    "Pin":"פין",
    "Colour":"צבע",
    "To":"אל",
    "To be confirmed against the contact or terminal datasheet before cutting.":"לאימות מול דף הנתונים של המגע או הנעל לפני החיתוך.",
    "This analysis is based on the attached drawing and was calculated by artificial intelligence. Engineering approval is therefore required before work begins.":"הניתוח מבוסס על הסרטוט המצורף וחושב ע״י בינה מלאכותית, ולכן יש לקבל אישור הנדסי לפני תחילת העבודה.",
    "Reading the wiring table, the labels and the notes…":"קורא את טבלת החיווט, הסימונים וההערות…",
    "Reading the drawing again…":"קורא את הסרטוט שוב…",
    "Reading the part list…":"קורא את רשימת החומרים…",
    "This end adds nothing — the strip comes out of the drawn length":"הקצה הזה לא מוסיף — החשיפה יוצאת מתוך האורך שבסרטוט",
    "strip":"חשיפה",
    "The length marked on the drawing. It is not the length you cut.":"האורך המסומן בסרטוט. זה לא האורך שחותכים.",
    "A dimension in the written instructions is not one of this sheet’s numbers":"מידה בהוראות המילוליות אינה אחד המספרים של הדף הזה",
    "The tables and the figures are computed from the same fields, so they always agree. Text is written separately and can drift. Correct the text, or add the missing dimension where it belongs.":"הטבלאות והסרטוטים מחושבים מאותם שדות, ולכן הם תמיד מסכימים. הטקסט נכתב בנפרד ויכול לסטות. לתקן את הטקסט, או להוסיף את המידה החסרה במקום שלה.",
    "Step":"שלב",
    "Inspection":"בדיקה",
    "each conductor":"כל מוליך",
    "The letter in front of each line is the code used on the strip figure above.":"האות שלפני כל שורה היא הקוד שמופיע בסרטוט החשיפה שמעל.",
    "The drawing as supplied, with the title block masked. Nothing is drawn over the harness; the cut lengths are in the table above.":"הסרטוט כפי שנמסר, כשאזור הכותרת מוסתר. לא צויר דבר על הצמה; אורכי החיתוך נמצאים בטבלה שמעל.",
    "A run names a connector as its cable":"ריצה מציינת מחבר ככבל שלה",
    "is the part number of connector":"הוא המק\"ט של מחבר",
    "Those runs are left out of the stores list below \u2014 you cannot draw a length of connector off a reel. Put the cable part number on the run before ordering.":"הריצות האלה לא נכללות ברשימת המחסן שלמטה — אי אפשר למשוך אורך של מחבר מגליל. יש לרשום את מק\"ט הכבל על הריצה לפני הזמנה.",
    "jacket strip":"חשיפת מעטה",
    "handling margin":"תוספת קצה",
    "A strip dimension looks like it was also counted as an allowance":"נראה שמידת חשיפה נספרה גם כתוספת אורך",
    "the allowance":"התוספת",
    "is the same as strip dimension":"זהה למידת החשיפה",
    "Stripping removes jacket, not length \u2014 a bared conductor is still where it was. If this is the strip counted twice, the cut length is too long by that much at each end. Check before cutting.":"חשיפה מסירה מעטה, לא אורך — מוליך חשוף נשאר בדיוק במקום שהיה. אם זו החשיפה שנספרה פעמיים, אורך החיתוך ארוך מדי בכמות הזו בכל קצה. לבדוק לפני חיתוך.",
    "The drawing exactly as supplied \u2014 nothing is drawn over it. The cut lengths it does not carry are in the table above.":"הסרטוט בדיוק כפי שנמסר — לא צויר עליו כלום. אורכי החיתוך שאין בו נמצאים בטבלה שמעל.",
    "Work sheet \u2014 read this first":"דף עבודה — לקרוא קודם",
    "Everything below is repeated in full later in this document. This page is the short version.":"כל מה שכאן מופיע במלואו בהמשך המסמך. הדף הזה הוא הגרסה הקצרה.",
    "Cut":"חיתוך",
    "Strip":"חשיפה",
    "Labels":"תוויות",
    "Do not get these wrong":"אסור לטעות בזה",
    "How it adds up":"איך זה מתקבל",
    "Cut length":"אורך לחיתוך",
    "Finished":"גמור",
    "Longest piece to cut":"החתיכה הארוכה ביותר לחיתוך",
    "the drawing\u2019s":"של הסרטוט",
    "is a finished length \u2014 it does not include the connector allowances":"הוא אורך גמור — הוא לא כולל את התוספות למחברים",
    "End":"קצה",
    "Code":"קוד",
    "TBC":"לאימות",
    "Where it goes":"איפה זה הולך",
    "This sheet still has":"בדף הזה עדיין יש",
    "unverified dimension(s)":"מידות לא מאומתות",
    "Do not cut production material until they are confirmed.":"אין לחתוך חומר ייצור עד לאימות.",
    "The drawing as supplied, with the cut lengths added. The drawing gives FINISHED lengths \u2014 the cut length is longer by the connector allowances.":"הסרטוט כפי שנמסר, בתוספת אורכי החיתוך. הסרטוט נותן אורכים גמורים — אורך החיתוך ארוך יותר בתוספות למחברים.",
    "The original drawing is not attached":"סרטוט המקור לא צורף",
    "the figure below is this sheet's own reading of the drawing.":"הסרטוט שלמטה הוא הקריאה של הדף הזה את הסרטוט.",
    "The analysis counted more on the drawing than it wrote down":"הניתוח ספר בסרטוט יותר ממה שרשם",
    "Labels in the marking table":"תוויות בטבלת הסימון",
    "Connectors on the drawing":"מחברים בסרטוט",
    "Cable runs":"ריצות כבל",
    "counted":"ספר",
    "listed":"רשם",
    "missing":"חסר",
    "Check the drawing for what is missing and add it before this sheet is used.":"לבדוק בסרטוט מה חסר ולהוסיף לפני שמשתמשים בדף הזה.",
    'Laced into one bundle':'שזור לצרור אחד',
    'These runs are laced into one bundle':'הריצות האלה שזורות לצרור אחד',
    'into':'אל',
    'Bundling changes how the harness is assembled — it never changes how long a wire is cut.':'שזירה משנה איך מרכיבים את הצמה — היא לעולם לא משנה באיזה אורך חותכים חוט.',
    'Engineering notes from the drawing':'הערות הנדסיות מהסרטוט',
    'These come from the drawing itself. A part that measures correctly and ignores these is still rejected.':'אלה מגיעות מהסרטוט עצמו. חלק שהמידות שלו נכונות אבל מתעלם מהן — עדיין נפסל.',
    'Note':'הערה',
    'Applies to':'חל על',
    'What the operator must do':'מה על העובד לעשות',
    'background — nothing to do':'רקע — אין פעולה',
    "The original drawing, as supplied. The figure below is this sheet's reading of it — if the two disagree, the drawing wins.":'הסרטוט המקורי כפי שנמסר. הסרטוט שלמטה הוא הקריאה של הדף הזה — אם השניים לא מסכימים, הסרטוט המקורי קובע.',
    'Overall length':'אורך כולל',
    'Overall length of the whole harness':'אורך כולל של כל הצמה',
    'The drawing states':'בסרטוט רשום',
    'but the longest route through this harness is':'אך המסלול הארוך ביותר בצמה הוא',
    'confirm before cutting.':'לאמת לפני חיתוך.',
    'Labels not placed on the figure':'תוויות שלא מוקמו בסרטוט',
    'Cut & Strip Specification':'מפרט חיתוך וחשיפה',
    'Drawing':'סרטוט','Revision':'מהדורה','Spec no.':'מספר מפרט','Workmanship':'תקן עבודה',
    'Cable':'כבל','Cut length':'אורך חיתוך','Issued':'הונפק','Status':'סטטוס',
    'Before you start — open items':'לפני שמתחילים — פריטים פתוחים',
    'Do not cut production material':'אין לחתוך חומר ייצור',
    'The dimensions below marked TBC were derived, not read from a manufacturer datasheet. Prove them on sample pieces and get engineering sign-off before the first production lot.':
      'המידות המסומנות TBC נגזרו ולא נקראו מ-datasheet של יצרן. יש להוכיח אותן על חתיכות דוגמה ולקבל אישור הנדסה לפני האצווה הראשונה.',
    'Discrepancies found in the source drawing':'סתירות שנמצאו בסרטוט המקור',
    'Material list':'רשימת חומרים',
    'Item':'פריט','Part number':'מק״ט יצרן','Manufacturer':'יצרן','Description':'תיאור','Qty':'כמות','Ref':'סימון',
    'Cable cross-section':'חתך הכבל',
    'Layer':'שכבה','Nominal Ø':'קוטר נומינלי','Material':'חומר',
    'Assembly overview — dimensions':'מבט כללי על המכלול — מידות',
    'Strip detail':'פרט חשיפה',
    'Strip dimensions':'מידות חשיפה',
    'End':'קצה','Connector':'מחבר','Value':'מידה','Basis':'מקור',
    'Operation sequence':'סדר פעולות',
    'Inspection':'בדיקה',
    'Tools & consumables':'כלים וחומרים מתכלים',
    'Tool':'כלי','Setting':'כיוונון','Note':'הערה',
    'All dimensions in millimetres. Not to scale.':'כל המידות במילימטרים. לא בקנה מידה.',
    'Cut length — cable only, connectors NOT included':'אורך חיתוך — כבל בלבד, ללא המחברים',
    'square cut':'חתך ישר',
    'Red faces = every cut square to the axis, free of burrs and nicks.':'הפאות האדומות = כל חתך ניצב לציר, ללא גדיליות ושריטות.',
    'TO BE CONFIRMED':'לאימות',
    'verified':'מאומת',
    'Prepared by':'הוכן על ידי','Checked by — Engineering':'נבדק על ידי — הנדסה','Approved for production':'אושר לייצור',
    'Print':'הדפסה','Export PDF':'ייצוא PDF','Back':'חזרה','Delete':'מחיקה','Re-analyse':'ניתוח מחדש',
    'Translating…':'מתרגם…','Page':'עמוד','of':'מתוך',
    'Edit':'עריכה','Save':'שמירה','Cancel':'ביטול','Saving…':'שומר…',
    'Cut length calculation':'חישוב אורך החיתוך',
    'Lengths as dimensioned on the drawing':'אורכים כפי שממודדים בסרטוט',
    'Span':'טווח',
    'A dimension on the drawing does not match the runs below':'מידה בסרטוט לא תואמת את המקטעים שלמטה',
    'drawing says':'בסרטוט',
    'the runs add up to':'סכום המקטעים',
    'The drawing is the authority. Fix the run lengths before cutting — a run split at the wrong point cuts wire short, and short wire is scrap.':'הסרטוט הוא הקובע. יש לתקן את אורכי המקטעים לפני החיתוך — מקטע שפוצל בנקודה שגויה גורם לחיתוך קצר מדי, וכבל קצר הוא פסולת.',
    'End to end':'מקצה לקצה',
    'Breakout':'נקודת פיצול',
    'from':'מ-',
    'Open wires':'חוטים חשופים',
    'Label table':'טבלת סימון',
    'Label':'סימון',
    'Text':'טקסט',
    'Kind':'סוג',
    'junction — nothing is terminated here':'צומת — לא מסתיים כאן דבר',
    'Connectors':'מחברים',
    'Positions':'מגעים',
    'Termination':'סוג חיבור',
    'Contact P/N':'מק״ט מגע',
    'Harness layout':'מבנה הצמה',
    'Cable run':'מקטע כבל',
    'This harness has':'בצמה הזו יש',
    'cable run(s)':'מקטעי כבל',
    'and':'ו-',
    'connector(s)':'מחברים',
    'Cable to draw from stores':'כבל למשיכה מהמחסן',
    'Runs':'מקטעים',
    'Total length':'אורך כולל',
    'Wiring table':'טבלת חיווט',
    'pin':'פין',
    'Signal':'אות',
    'Colour':'צבע',
    'AWG':'AWG',
    'Shield / drain':'מסך / חוט הארקה',
    'Each conductor':'כל מוליך',
    'each':'לכל',
    'CUT':'לחתוך',
    'Drawing name':'שם הסרטוט',
    'Project':'פרויקט',
    'Insulation removed from each individual conductor for its contact':'בידוד שמוסר מכל מוליך בנפרד עבור המגע שלו',
    'From the contact datasheet — a much smaller number than the jacket strip.':'מתוך datasheet של המגע — מספר קטן בהרבה מחשיפת המעטה.',
    'not described on the sheet':'לא מתואר בגיליון',
    'this end is on the drawing but the analysis produced no strip dimensions for it. Fill them in before use.':'הקצה הזה מופיע בסרטוט אבל הניתוח לא הפיק עבורו מידות חשיפה. יש למלא אותן לפני שימוש.',
    'Squaring the cut and re-doing a bad strip':
      'חיתוך ישר ותיקון חשיפה כושלת',
    'Prove them on 3 sample pieces before the first production lot.':
      'להוכיח על 3 חתיכות דוגמה לפני האצווה הראשונה.',
    'Finished length (from the drawing)':'אורך גמור (מהסרטוט)',
    'Allowance':'תוספת','Reason':'סיבה','trim':'ריווח חיתוך',
    'CUT THIS LENGTH':'זה האורך לחיתוך',
    'Do NOT cut to the drawing length. Cable is consumed inside each connector and by squaring the end — cut the length below.':
      'אין לחתוך לפי האורך שבסרטוט. חלק מהכבל נבלע בתוך כל מחבר ובחיתוך הישר — לחתוך לפי האורך שלמטה.',
    'What the drawing dimension measures':'מה המידה בסרטוט מודדת',
    'Bare cable, connectors excluded':'כבל בלבד, ללא המחברים',
    'Whole assembly, connector face to connector face':'המכלול כולו, מפאת מחבר לפאת מחבר',
    'The drawing does not say — confirm before cutting':'הסרטוט לא מציין — לאמת לפני החיתוך',
    'This specification predates the cut-length breakdown — the length below has no calculation behind it.':
      'המפרט הזה נוצר לפני חישוב אורך החיתוך — אין מאחורי האורך שלמטה פירוט.',
    'Confirmed':'מאומת','Add step':'הוסף שלב','Add check':'הוסף בדיקה','Remove':'הסר',
    'Editing':'מצב עריכה',
    'Tick Confirmed once a dimension is verified against a datasheet — the red TBC marking disappears from the sheet and the diagrams.':
      'סמן "מאומת" ברגע שמידה אומתה מול datasheet — הסימון האדום TBC ייעלם מהמפרט ומהשרטוטים.',
    'You are editing a translation. The original is left unchanged and your wording is saved for this specification.':
      'אתה עורך את הנוסח בעברית. מקור האנגלית נשמר ללא שינוי; הנוסח שלך נשמר עבור המפרט הזה.',
    'You are editing the specification itself. Saved translations of any line you change will be re-translated.':
      'אתה עורך את מקור האנגלית. נוסח קיים בעברית וברוסית עבור מה שתשנה יתורגם מחדש.',
    'CRITICAL':'קריטי',
    'Generated by AI from the drawing — verify against the drawing before use.':
      'הופק על ידי AI מתוך הסרטוט — לאמת מול הסרטוט לפני שימוש.',
  },
  ru:{
    "no strip dimension on the drawing — fill it in":"на чертеже нет размера зачистки — заполнить",
    "The harness is made of":"Жгут состоит из",
    "each":"каждый",
    "total":"всего",
    "wires":"проводов",
    "Datasheet":"Техдокументация",
    "On the BOM":"По BOM",
    "Cut into":"Разрезать на",
    "Left over":"Остаток",
    "conductors":"проводников",
    "Contact":"Контакт",
    "Manufacturing instructions":"Инструкции по изготовлению",
    "Document":"Документ",
    "Doc no.":"№ документа",
    "Rev":"Ред.",
    "Drawing #":"№ чертежа",
    "Title":"Название",
    "Steps":"Шаги",
    "Updated":"Обновлено",
    "Assembly name":"Название сборки",
    "Material list":"Перечень материалов",
    "Manufacturer":"Производитель",
    "Add material":"Добавить материал",
    "Operation sequence":"Последовательность операций",
    "Step title":"Название шага",
    "CRITICAL":"КРИТИЧНО",
    "No steps yet.":"Шагов пока нет.",
    "Add step":"Добавить шаг",
    "No checks yet.":"Проверок пока нет.",
    "Add check":"Добавить проверку",
    "Tools & consumables":"Инструменты и расходные материалы",
    "Tool":"Инструмент",
    "Setting":"Настройка",
    "Note":"Примечание",
    "Add tool":"Добавить инструмент",
    "New instruction":"Новая инструкция",
    "From a Cut & Strip spec":"Из спецификации резки и зачистки",
    "No manufacturing instructions yet":"Инструкций по изготовлению пока нет",
    "Search instructions…":"Поиск инструкций…",
    "Nothing matches that search":"Ничего не найдено",
    "Workmanship":"Стандарт исполнения",
    "Wire & cable cutting and stripping form":"Бланк резки и зачистки проводов и кабелей",
    "Planning":"Планирование",
    "Execution — cut & strip":"Выполнение — резка и зачистка",
    "Schematic — cut & strip":"Схема — резка и зачистка",
    "Customer":"Заказчик",
    "Length [mm]":"Длина [мм]",
    "Strip [mm]":"Зачистка [мм]",
    "Operator":"Исполнитель",
    "Approval":"Утверждение",
    "Approved by":"Утвердил",
    "Prepared by":"Составил",
    "Name":"Имя",
    "Signature":"Подпись",
    "Notes":"Примечания",
    "Date":"Дата",
    "Qty":"Кол-во",
    "Description":"Описание",
    "Part number":"Артикул",
    "Revision":"Ред.",
    "Harness layout":"Схема жгута",
    "Connectors":"Разъёмы",
    "Strip detail":"Детали зачистки",
    "Value":"Значение",
    "The drawing’s length is measured":"Длина на чертеже измеряется",
    "to the jacket end at each end":"до конца оболочки с каждой стороны",
    "the bare cable, connectors excluded":"только кабель, без разъёмов",
    "over the connectors, face to face":"с разъёмами, от торца до торца",
    "the drawing does not say":"чертёж не указывает",
    "assumed — the drawing does not say":"предположение — чертёж не указывает",
    "This is not a ready-made cable — it is built from individual wires":"Это не готовый кабель — он собирается из отдельных проводов",
    "Cut pieces":"Число отрезков",
    "Each [mm]":"Каждый [мм]",
    "Total needed":"Всего требуется",
    "BOM allows":"По BOM имеется",
    "wires of":"проводов длиной",
    "Search saved specifications…":"Поиск по сохранённым спецификациям…",
    "No saved specification matches that search.":"Нет сохранённых спецификаций по этому запросу.",
    "Sort by this column":"Сортировать по этому столбцу",
    "Clear":"Очистить",
    "These names are not printed on the drawing":"Эти имена на чертеже не напечатаны",
    "The drawing gives no designator for them, so this sheet assigned one. Match them by position, not by looking for the label.":"На чертеже для них нет обозначения, поэтому лист присвоил своё. Определяйте по положению, а не по метке.",
    "seen on the drawing as":"на чертеже видно как",
    "Outer covering":"Внешняя оболочка",
    "Conductor / core":"Проводник / жила",
    "The layer names were not captured from the drawing — the cable is drawn generically. The dimensions are as specified.":"Названия слоёв с чертежа не извлечены — кабель показан условно. Размеры указаны как заданы.",
    "measured inside A — it adds nothing to the cut length":"измеряется внутри A — к длине реза не добавляет",
    "This end adds to the cut length":"Этот конец добавляет к длине реза",
    "Cutting and stripping, step by step":"Резка и зачистка — по шагам",
    "Cut the cable":"Резка кабеля",
    "Cut {cable} to {len}.":"Отрезать {cable} длиной {len}.",
    "The length includes the connectors; nothing is added for the ends.":"Длина включает разъёмы; на концы ничего не добавляется.",
    "Prepare end {ref}":"Подготовка конца {ref}",
    "Strip {mm} of the outer jacket.":"Снять {mm} внешней оболочки.",
    "Trim the conductors, measured from the jacket end:":"Укоротить жилы, от края оболочки:",
    "Strip {mm} at the tip of each conductor and crimp terminal {pn}.":"Зачистить {mm} на конце каждой жилы и обжать наконечник {pn}.",
    "Strip {mm} at the tip of each conductor.":"Зачистить {mm} на конце каждой жилы.",
    "Strip {mm} from each conductor for the contacts of {pn}.":"Зачистить {mm} каждой жилы под контакты {pn}.",
    "Strip {mm} from each conductor.":"Зачистить {mm} каждой жилы.",
    "Pin":"Контакт",
    "Colour":"Цвет",
    "To":"Куда",
    "To be confirmed against the contact or terminal datasheet before cutting.":"Уточнить по документации на контакт или наконечник до резки.",
    "This analysis is based on the attached drawing and was calculated by artificial intelligence. Engineering approval is therefore required before work begins.":"Анализ основан на приложенном чертеже и выполнен искусственным интеллектом, поэтому до начала работ требуется инженерное утверждение.",
    "The length marked on the drawing. It is not the length you cut.":"Длина, указанная на чертеже. Это не длина реза.",
    "A dimension in the written instructions is not one of this sheet’s numbers":"Размер в текстовых инструкциях не совпадает ни с одним числом этого листа",
    "The tables and the figures are computed from the same fields, so they always agree. Text is written separately and can drift. Correct the text, or add the missing dimension where it belongs.":"Таблицы и рисунки считаются из одних и тех же полей и всегда согласованы. Текст пишется отдельно и может разойтись. Исправьте текст или добавьте недостающий размер.",
    "Step":"Шаг",
    "Inspection":"Контроль",
    "each conductor":"каждый проводник",
    "The letter in front of each line is the code used on the strip figure above.":"Буква перед строкой — код, показанный на рисунке зачистки выше.",
    "The drawing as supplied, with the title block masked. Nothing is drawn over the harness; the cut lengths are in the table above.":"Чертёж как получен, штамп закрыт. Поверх жгута ничего не нанесено; длины реза — в таблице выше.",
    "A run names a connector as its cable":"Линия указывает разъём как свой кабель",
    "is the part number of connector":"— это парт-номер разъёма",
    "Those runs are left out of the stores list below \u2014 you cannot draw a length of connector off a reel. Put the cable part number on the run before ordering.":"Эти линии исключены из складского списка — разъём с катушки не отмотать. Укажите парт-номер кабеля до заказа.",
    "jacket strip":"зачистка оболочки",
    "handling margin":"припуск на конец",
    "A strip dimension looks like it was also counted as an allowance":"Похоже, размер зачистки посчитан и как припуск",
    "the allowance":"припуск",
    "is the same as strip dimension":"совпадает с размером зачистки",
    "Stripping removes jacket, not length \u2014 a bared conductor is still where it was. If this is the strip counted twice, the cut length is too long by that much at each end. Check before cutting.":"Зачистка снимает изоляцию, а не длину — оголённый проводник остаётся на месте. Если это двойной счёт, длина реза завышена на эту величину с каждого конца. Проверьте до реза.",
    "The drawing exactly as supplied \u2014 nothing is drawn over it. The cut lengths it does not carry are in the table above.":"Чертёж точно как получен — поверх ничего не нанесено. Длины реза — в таблице выше.",
    "Work sheet \u2014 read this first":"Рабочий лист — читать первым",
    "Everything below is repeated in full later in this document. This page is the short version.":"Всё это повторяется полностью далее. Эта страница — краткая версия.",
    "Cut":"Рез",
    "Strip":"Зачистка",
    "Labels":"Метки",
    "Do not get these wrong":"Здесь ошибаться нельзя",
    "How it adds up":"Из чего складывается",
    "Cut length":"Длина реза",
    "Finished":"Готовая",
    "Longest piece to cut":"Самый длинный отрезок",
    "the drawing\u2019s":"на чертеже",
    "is a finished length \u2014 it does not include the connector allowances":"— готовая длина, без припусков на разъёмы",
    "End":"Конец",
    "Code":"Код",
    "TBC":"К уточн.",
    "Where it goes":"Куда клеится",
    "This sheet still has":"На листе ещё",
    "unverified dimension(s)":"неподтверждённых размеров",
    "Do not cut production material until they are confirmed.":"Не резать производственный материал до подтверждения.",
    "The drawing as supplied, with the cut lengths added. The drawing gives FINISHED lengths \u2014 the cut length is longer by the connector allowances.":"Чертёж как получен, плюс длины реза. На чертеже готовые длины — длина реза больше на припуски.",
    "The original drawing is not attached":"Исходный чертёж не приложен",
    "the figure below is this sheet's own reading of the drawing.":"Ниже — прочтение чертежа этим листом.",
    "The analysis counted more on the drawing than it wrote down":"Анализ насчитал на чертеже больше, чем записал",
    "Labels in the marking table":"Метки в таблице маркировки",
    "Connectors on the drawing":"Разъёмы на чертеже",
    "Cable runs":"Кабельные линии",
    "counted":"насчитано",
    "listed":"записано",
    "missing":"не хватает",
    "Check the drawing for what is missing and add it before this sheet is used.":"Проверьте по чертежу, чего не хватает, и добавьте до использования листа.",
    'Laced into one bundle':'Связано в один жгут',
    'These runs are laced into one bundle':'Эти линии связаны в один жгут',
    'into':'в',
    'Bundling changes how the harness is assembled — it never changes how long a wire is cut.':'Связывание меняет сборку жгута — но никогда не меняет длину реза провода.',
    'Engineering notes from the drawing':'Инженерные примечания с чертежа',
    'These come from the drawing itself. A part that measures correctly and ignores these is still rejected.':'Они взяты с самого чертежа. Деталь с верными размерами, но без их учёта, всё равно бракуется.',
    'Note':'Примечание',
    'Applies to':'Относится к',
    'What the operator must do':'Что должен сделать оператор',
    'background — nothing to do':'фон — действий нет',
    "The original drawing, as supplied. The figure below is this sheet's reading of it — if the two disagree, the drawing wins.":'Исходный чертёж как получен. Ниже — его прочтение этим листом; при расхождении верен чертёж.',
    'Overall length':'Общая длина',
    'Overall length of the whole harness':'Общая длина всего жгута',
    'The drawing states':'На чертеже указано',
    'but the longest route through this harness is':'но самый длинный маршрут в жгуте',
    'confirm before cutting.':'подтвердить перед резкой.',
    'Labels not placed on the figure':'Метки, не размещённые на чертеже',
    'Cut & Strip Specification':'Спецификация резки и зачистки',
    'Drawing':'Чертёж','Revision':'Ревизия','Spec no.':'№ спецификации','Workmanship':'Стандарт',
    'Cable':'Кабель','Cut length':'Длина реза','Issued':'Выпущено','Status':'Статус',
    'Before you start — open items':'Перед началом — открытые вопросы',
    'Do not cut production material':'Не резать производственный материал',
    'The dimensions below marked TBC were derived, not read from a manufacturer datasheet. Prove them on sample pieces and get engineering sign-off before the first production lot.':
      'Размеры с пометкой TBC получены расчётом, а не из datasheet производителя. Проверьте их на образцах и получите согласование инженера до первой партии.',
    'Discrepancies found in the source drawing':'Расхождения в исходном чертеже',
    'Material list':'Перечень материалов',
    'Item':'Поз.','Part number':'Артикул','Manufacturer':'Производитель','Description':'Описание','Qty':'Кол-во','Ref':'Обозн.',
    'Cable cross-section':'Сечение кабеля',
    'Layer':'Слой','Nominal Ø':'Ø номинальный','Material':'Материал',
    'Assembly overview — dimensions':'Общий вид сборки — размеры',
    'Strip detail':'Деталь зачистки',
    'Strip dimensions':'Размеры зачистки',
    'End':'Конец','Connector':'Разъём','Value':'Размер','Basis':'Основание',
    'Operation sequence':'Последовательность операций',
    'Inspection':'Контроль',
    'Tools & consumables':'Инструмент и расходные материалы',
    'Tool':'Инструмент','Setting':'Настройка','Note':'Примечание',
    'All dimensions in millimetres. Not to scale.':'Все размеры в миллиметрах. Не в масштабе.',
    'Cut length — cable only, connectors NOT included':'Длина реза — только кабель, без разъёмов',
    'square cut':'рез под 90°',
    'Red faces = every cut square to the axis, free of burrs and nicks.':'Красные торцы = каждый рез перпендикулярен оси, без заусенцев и задиров.',
    'TO BE CONFIRMED':'ПОДЛЕЖИТ УТОЧНЕНИЮ',
    'verified':'проверено',
    'Prepared by':'Подготовил','Checked by — Engineering':'Проверил — инженер','Approved for production':'Допущено к производству',
    'Print':'Печать','Export PDF':'Экспорт PDF','Back':'Назад','Delete':'Удалить','Re-analyse':'Проанализировать заново',
    'Translating…':'Перевод…','Page':'Стр.','of':'из',
    'Edit':'Редактировать','Save':'Сохранить','Cancel':'Отмена','Saving…':'Сохранение…',
    'Cut length calculation':'Расчёт длины реза',
    'Lengths as dimensioned on the drawing':'Длины по размерам чертежа',
    'Span':'Участок',
    'A dimension on the drawing does not match the runs below':'Размер на чертеже не совпадает с участками ниже',
    'drawing says':'по чертежу',
    'the runs add up to':'сумма участков',
    'The drawing is the authority. Fix the run lengths before cutting — a run split at the wrong point cuts wire short, and short wire is scrap.':'Чертёж — источник истины. Исправьте длины до реза: участок, разделённый не в том месте, режется коротким, а короткий провод — брак.',
    'End to end':'От края до края',
    'Breakout':'Точка разветвления',
    'from':'от',
    'Open wires':'Открытые провода',
    'Label table':'Таблица маркировки',
    'Label':'Маркер',
    'Text':'Текст',
    'Kind':'Тип',
    'junction — nothing is terminated here':'Узел — здесь ничего не заделывается',
    'Connectors':'Разъёмы',
    'Positions':'Контактов',
    'Termination':'Тип заделки',
    'Contact P/N':'Артикул контакта',
    'Harness layout':'Схема жгута',
    'Cable run':'Кабельный участок',
    'This harness has':'В этом жгуте',
    'cable run(s)':'кабельных участков',
    'and':'и',
    'connector(s)':'разъёмов',
    'Cable to draw from stores':'Кабель со склада',
    'Runs':'Участков',
    'Total length':'Общая длина',
    'Wiring table':'Таблица разводки',
    'pin':'конт.',
    'Signal':'Сигнал',
    'Colour':'Цвет',
    'AWG':'AWG',
    'Shield / drain':'Экран / дренажный провод',
    'Each conductor':'Каждый проводник',
    'each':'кажд.',
    'CUT':'РЕЗАТЬ',
    'Drawing name':'Название чертежа',
    'Project':'Проект',
    'Insulation removed from each individual conductor for its contact':'Изоляция, снимаемая с каждого проводника под контакт',
    'From the contact datasheet — a much smaller number than the jacket strip.':'Из datasheet контакта — значительно меньше, чем зачистка оболочки.',
    'not described on the sheet':'не описан в спецификации',
    'this end is on the drawing but the analysis produced no strip dimensions for it. Fill them in before use.':'Этот конец есть на чертеже, но анализ не выдал для него размеров зачистки. Заполните до применения.',
    'Squaring the cut and re-doing a bad strip':
      'Торцовка и переделка неудачной зачистки',
    'Prove them on 3 sample pieces before the first production lot.':
      'Проверьте на 3 образцах до первой партии.',
    'Finished length (from the drawing)':'Готовая длина (по чертежу)',
    'Allowance':'Припуск','Reason':'Обоснование','trim':'припуск на торцовку',
    'CUT THIS LENGTH':'РЕЗАТЬ ЭТУ ДЛИНУ',
    'Do NOT cut to the drawing length. Cable is consumed inside each connector and by squaring the end — cut the length below.':
      'НЕ режьте по длине с чертежа. Часть кабеля уходит внутрь каждого разъёма и на торцовку — режьте по длине ниже.',
    'What the drawing dimension measures':'Что измеряет размер на чертеже',
    'Bare cable, connectors excluded':'Только кабель, без разъёмов',
    'Whole assembly, connector face to connector face':'Вся сборка, от торца до торца разъёма',
    'The drawing does not say — confirm before cutting':'Чертёж не указывает — уточните до реза',
    'This specification predates the cut-length breakdown — the length below has no calculation behind it.':
      'Эта спецификация создана до появления расчёта длины реза — за длиной ниже нет расчёта.',
    'Confirmed':'Подтверждено','Add step':'Добавить шаг','Add check':'Добавить проверку','Remove':'Удалить',
    'Editing':'Режим редактирования',
    'Tick Confirmed once a dimension is verified against a datasheet — the red TBC marking disappears from the sheet and the diagrams.':
      'Отметьте «Подтверждено», когда размер сверен с datasheet — красная пометка TBC исчезнет из спецификации и с чертежей.',
    'You are editing a translation. The original is left unchanged and your wording is saved for this specification.':
      'Вы редактируете формулировку. Английский источник остаётся без изменений; ваш текст сохраняется для этой спецификации.',
    'You are editing the specification itself. Saved translations of any line you change will be re-translated.':
      'Вы редактируете английский источник. Существующие переводы изменённых строк будут переведены заново.',
    'CRITICAL':'ВАЖНО',
    'Generated by AI from the drawing — verify against the drawing before use.':
      'Сгенерировано ИИ по чертежу — сверьте с чертежом перед применением.',
  },
};
// ── Two lookups, deliberately separate ────────────────────────────────────────
// _csT  — FIXED CHROME. Section headings, column names, buttons. Always keyed by
//         the English literal written in this file, always answered from
//         _CS_LABELS. Never involves the AI, so the structure of the sheet
//         renders correctly even with no network at all.
//
// _csP  — SPEC PROSE. The sentences the AI wrote. These are stored in whatever
//         language the analysis was RUN in (spec.lang, Hebrew by default), so
//         when the sheet is displayed in that same language there is nothing to
//         translate and nothing that can fail.
//
// Conflating the two was a latent bug: with Hebrew-native specs, a chrome label
// would have been treated as already-translated and shown in English.
export function _csT(text){
  if(_csLang==='en') return text;
  return (_CS_LABELS[_csLang]||{})[String(text||'')] || text;
}
// Language the stored prose is written in. Specs created before Hebrew-native
// analysis have no marker and are English.
export function _csSrcLang(spec){ return (spec && spec.lang) || 'en'; }

// Lookup order matters. A human override saved on THIS spec beats the shared
// machine-translation cache, and both beat the source text. That is what makes
// "fix the wording and have it stay fixed" work: the correction is stored
// against the spec, so reopening — or someone else opening it — sees the
// corrected wording rather than the machine's first attempt.
export function _csP(text){
  const t=String(text||'');
  const src=_csSrcLang(S.csCurrent);
  const ov=(S.csCurrent && S.csCurrent.overrides && S.csCurrent.overrides[_csLang]) || {};
  if(ov[t]) return ov[t];
  if(_csLang===src) return t;                 // nothing to do — the common path
  return (_csCache[_csLang]||{})[t] || t;     // fall back to the source, never blank
}

// Makes sure every prose string has a translation before the sheet is drawn.
// Returns immediately — no network at all — when the sheet is being shown in
// the language it was generated in, which is the normal case.
//
// Deliberately non-fatal: if translation fails, the sheet still opens in its
// source language with the reason shown. A work instruction that renders in the
// wrong language is usable; one that refuses to render is not.
export async function _csEnsureLang(spec, lang, onProgress){
  if(!spec || lang===_csSrcLang(spec)) return true;
  const ov=(spec.overrides&&spec.overrides[lang])||{};
  const bucket=_csCache[lang]||{};
  const todo=_csProseStrings(spec).filter(t=>!ov[t] && !bucket[t]);
  if(!todo.length) return true;
  try{ await _csTranslate(todo, lang, onProgress); return true; }
  catch(e){
    console.warn('[CutStrip] auto-translate failed:', e.message);
    toast(`Showing in ${_CS_LANG_NAMES[_csSrcLang(spec)]||'the original language'} — ${e.message}`,'error');
    _csSetLang(_csSrcLang(spec));
    return false;
  }
}

// Every free-text string on the sheet that came from the AI rather than from
// the label table. Collected in one place so translation is a single batched
// request instead of one call per sentence.
export function _csProseStrings(spec){
  const _extra=[];
  (spec?.engineering_notes||[]).forEach(n=>{ _extra.push(n.text, n.action); });
  (spec?.markers||[]).forEach(m=>_extra.push(m.position));
  if(spec?.bundle){ _extra.push(spec.bundle.note, spec.bundle.method); }
  const out=[];
  const push=v=>{ const t=String(v||'').trim(); if(t) out.push(t); };
  _extra.forEach(push);
  (spec.steps||[]).forEach(s=>{ push(s.title); push(s.body); push(s.critical); });
  (spec.inspection||[]).forEach(push);
  (spec.open_items||[]).forEach(o=>{ push(o.what); push(o.why); push(o.action); });
  (spec.discrepancies||[]).forEach(d=>{ push(d.what); push(d.detail); });
  (spec.tools||[]).forEach(t=>{ push(t.tool); push(t.note); });
  (spec.materials||[]).forEach(m=>push(m.description));
  _csConnectors(spec).forEach(c=>push(c.description));
  _csSegments(spec).forEach(seg=>{
    push(seg.cable_description); push(seg.shield_treatment);
    (seg.layers||[]).forEach(l=>{ push(l.name); push(l.note); });
    (seg.allowances||[]).forEach(a=>push(a.reason));
    (seg.ends||[]).forEach(e=>(e.strip||[]).forEach(x=>{ push(x.label); push(x.basis); }));
    (seg.conductors||[]).forEach(w=>push(w.note));
  });
  return [...new Set(out)];
}


// Sent in CHUNKS, not as one request. A real spec routinely carries 150+
// sentences once open items and inspection lines are counted; asking for all of
// them at once produced a response big enough to blow the 60s request timeout,
// which failed the whole translation and left the sheet in the wrong language.
// Chunks also degrade gracefully: if the fourth batch fails, the first three are
// already cached and only the remainder is missing.
export const _CS_TR_CHUNK=20;
export async function _csTranslate(texts, lang, onProgress){
  const bucket=_csCache[lang] || (_csCache[lang]={});
  const todo=[...new Set(texts.map(t=>String(t||'').trim()).filter(t=>t && !bucket[t]))];
  if(!todo.length) return true;
  if(!_aiReady()) throw new Error(_AI_NO_KEY);

  const chunks=[];
  for(let i=0;i<todo.length;i+=_CS_TR_CHUNK) chunks.push(todo.slice(i,i+_CS_TR_CHUNK));
  let done=0, firstError=null;
  for(const chunk of chunks){
    try{ await _csTranslateChunk(chunk, lang, bucket); }
    catch(e){ if(!firstError) firstError=e; }
    done+=chunk.length;
    if(onProgress) onProgress(done, todo.length);
  }
  _csSaveCache();
  // Only fail outright if NOTHING landed. A partly translated sheet still shows
  // every dimension and diagram correctly, and the untranslated lines fall back
  // to their source text rather than going blank.
  const got=todo.filter(t=>bucket[t]).length;
  if(!got && firstError) throw firstError;
  if(firstError) toast(`${todo.length-got} of ${todo.length} lines could not be translated — those stay in the original language`,'error');
  return true;
}
