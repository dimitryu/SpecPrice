// Session state that more than one module reassigns. Everything else lives in
// the module that owns it. A module reads and writes these as S.name — one
// object, so a change made by one screen is the value every other screen sees.
export const S = {
  // owner: ai/client.js
  _csModelDown: false,
  // owner: ai/cutstrip.js
  // Set by the import screen so a long analysis can say what it is doing. A
  // continuation takes as long as the first request, and a progress bar that
  // sits still for four minutes reads as a hang.
  _csOnProgress: null,
  // owner: core/roles.js
  currentView: 'home',
  // owner: core/roles.js
  _rolesSeeded: false,
  // owner: core/roles.js
  roleViewsMap: {},
  // owner: core/session.js
  companyLogoB64: '',
  // owner: core/session.js
  currentUserEmail: '',
  // owner: core/session.js
  // Seeded from localStorage, which is where the Admin page saves them.
  // This read did not exist: the keys were written on save and then only ever
  // re-read from the company document, so a key typed into Admin worked until
  // the page was reloaded and then silently disappeared — taking every AI
  // feature with it, with no error anywhere.
  anthKey: localStorage.getItem('anth_key') || '',
  // owner: ai/client.js
  // True when the Anthropic key is stored on the server and every AI request
  // goes through the aiProxy function — see _aiFetch. Remembered so the first
  // request after a reload already takes that road.
  aiProxy: localStorage.getItem('ai_proxy') === '1',
  // owner: data/parts.js
  allParts: [],
  // owner: data/parts.js
  // Recycle bin of the Database screen: parts that were deleted but not yet
  // purged. Loaded with the same snapshot as allParts, kept apart from it so
  // no other screen ever sees a deleted part.
  trashParts: [],
  // owner: data/parts.js
  _psTrashDays: 30,
  // owner: features/cutstrip/list.js
  // ══════════════════════════════════════════════════════════════════════════════
  // CUT & STRIP
  // ------------------------------------------------------------------------------
  // Turns one cable/harness drawing into a specification a bench operator can
  // actually work from: verbal steps AND generated diagrams carrying the real
  // dimensions.
  //
  // The hard constraint that shapes this whole module: a WRONG strip dimension
  // destroys parts. Connector manufacturers publish strip dimensions in separate
  // assembly specs that are frequently not in the drawing and often not public at
  // all (Amphenol's SMP outline drawing, for instance, just says "see spec
  // 349-50687"). So every dimension carries a `confirmed` flag. Anything the AI
  // derived rather than read is rendered in red as TBC, and the sheet opens with
  // a "do not cut production material" block listing exactly what's unverified.
  // The operator is never left guessing which numbers are trustworthy.
  //
  // Specs are stored per drawing number at
  //   companies/{cid}/cut_strip_specs/{sanitised drawing number}
  // so re-analysing the same drawing UPDATES the sheet instead of piling up
  // near-duplicates, and so it can be reopened later without paying for another
  // AI call.
  // ══════════════════════════════════════════════════════════════════════════════
  csSpecs: [],
  // owner: features/cutstrip/sheet.js
  csCurrent: null,
  // owner: features/cutstrip/sheet.js
  // ── Editing ───────────────────────────────────────────────────────────────────
  // The single most valuable edit on this screen is an engineer receiving the
  // manufacturer's assembly spec, typing the real strip dimension in, and ticking
  // Confirmed — at which point the red TBC marking disappears from the table AND
  // from the diagrams, because both read the same field. That loop is what turns
  // a provisional sheet into a released one, so it has to be two clicks, not a
  // re-analysis.
  //
  // Every editable control carries where it writes back to, so collection is one
  // generic pass over the DOM rather than a bespoke reader per field.
  _csEditing: false,
  // owner: features/cutstrip/sheet.js
  _csEditBackup: null,
  // owner: features/manufacturing.js
  mfgCurrent: null,
  // owner: features/salesDesk/salesDesk.js
  _sdLaborRateMin: 0.5,
  // owner: features/salesDesk/salesDesk.js
  // AI cable-manufacturing-process analysis (Sales Desk "New Drawing" import only —
  // see handleSDFiles/aiAnalyzeCableProcess). _sdLaborBreakdowns holds one entry per
  // analyzed drawing ({drawingName, steps:[{operation,minutes,row_idx}], seriesTotal,
  // singleUnitMinutes, generalMinutes}) for the Cost Summary breakdown modal.
  // generalMinutes is step time that wasn't attributed to any specific BOM row
  // (general assembly/inspection) — it only counts toward the total labor time
  // while at least one row from THAT drawing is still present in sdItems (see
  // _sdActiveGeneralLaborMinutes), so deleting every row of a drawing correctly
  // drops its un-attributed time too, same as deleting a normal row drops its
  // own labor_total. _sdPendingLaborByKey is a short-lived
  // `${drawingName}|${part_number}` → minutes map bridging handleSDFiles' per-
  // file AI analysis to the row objects actually created when the user confirms
  // the BOM preview and the rows land in sdItems.
  _sdLaborBreakdowns: [],
  // owner: features/salesDesk/salesDesk.js
  _sdPendingLaborByKey: {},
};

