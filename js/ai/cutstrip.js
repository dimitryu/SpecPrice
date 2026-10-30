import { S } from '../core/state.js';
import { _AI_NO_KEY, _CS_MAX_REPLY_CHARS, _aiFetch, _aiReady, _csComplete, _csDeadProviders, _csIsKeyError, _csLoopy, _csModel, _csModelRejected, _csProviderHint, _csSalvageJson, _csStitch, _csTrimPrefill } from './client.js';
import { logSystemAudit } from '../core/audit.js';
import { _CS_CABLE_RE, _CS_CUT_MODEL, _csEndLegs, _csNormalize, _csProposeStrips, _csSyncCutLength } from '../domain/cutstrip.js';
import { _CS_SOURCE_LANG } from '../features/cutstrip/i18n.js';

// ── AI analysis ───────────────────────────────────────────────────────────────
// Reading a whole drawing and emitting several thousand tokens of structured
// JSON is the longest single request this app makes. 60s — the app-wide default
// — was cutting it off mid-generation and reporting it as a hang.
// A 64k-token reply takes longer to write than a 32k one, and a request that
// is aborted mid-answer wastes the whole analysis. Five minutes per request.
export const _CS_ANALYSIS_TIMEOUT = 300000;
// Output budget. 8192 was enough for one coax with two ends in English; it is
// not enough for a real harness. The schema now carries connectors, one block
// per cable run, and a wiring table per run — and Hebrew costs roughly twice
// the tokens of the same English text. The two together overran the limit and
// the reply came back cut off mid-string, which surfaced as "malformed JSON"
// when the real cause was that the model was still writing.
// Asked in bites rather than in one 64k mouthful. A model that falls into a
// repetition loop fills whatever window it is given, so a big window means a
// long wait and a big waste before anyone notices; a small one is caught in
// seconds, the loop check runs between bites, and the continuation carries on
// from where the last one stopped. Four bites reach the same ceiling as one
// 64k reply, and a real specification needs one or two.
export const _CS_MAX_TOKENS = 16000;
export const _CS_MAX_CONTINUATIONS = 4;

// The analysis writes its prose DIRECTLY in the language the sheet will be read
// in. This is not a convenience — it removes the entire translate-after-the-fact
// round trip from the normal path. That second call was both the slowest part of
// creating a spec and its most common failure: a real drawing yields well over a
// hundred sentences, and translating them all was enough to hit the request
// timeout. Writing them in Hebrew the first time costs nothing extra, because
// the model is composing those sentences either way.
// The analysis is asked for in two bites, and the split is not an optimisation
// — it is what makes the cutting form reliable. Everything the bench cuts from
// (the dimensions, the ends, the strip, and the BOM the wire count is worked
// out of) is asked for FIRST, on its own. The row-heavy parts — the wiring
// table, the markers, the sleeves, the drawing notes — come second, in their
// own request with their own window.
//
// Before this, one reply had to carry all of it, and on a real drawing it ran
// out of room somewhere in the middle: the operator lost the part list, and
// with it the instruction to cut four 3 m pieces out of each 12 m reel. A
// wiring table that arrives half-finished costs a re-run; a part list that
// never arrives costs the whole point of the sheet.
export const _CS_PHASE_CORE='core', _CS_PHASE_DETAIL='detail';
export function _csPrompt(lang, phase){
  const core = phase!==_CS_PHASE_DETAIL;
  const LANGS={he:'Hebrew', ru:'Russian', en:'English'};
  const langName=LANGS[lang]||'Hebrew';
  // Deliberately repeated at the end of the prompt as well. Everything between
  // the two copies is English — the schema comments, the rules, the worked
  // examples — and a model that has just read four thousand words of English
  // writes English unless told otherwise as the last thing it sees.
  const langTail = langName==='English' ? '' :
`
──────────────────────────────────────────────────────────────────────
BEFORE YOU WRITE THE JSON, CHECK THIS ONE THING:
Every human-readable VALUE goes in ${langName}. Everything above is written in English because it is
instruction to you, not output — do not copy that language into your answer.
In ${langName}: every open_items "what"/"why"/"action", every discrepancies "what"/"detail", every
engineering_notes "text" and "action", every "reason", every "position", every description, every
layer name and note, every strip label and "basis" text.
Notes and text ON THE DRAWING are usually printed in English — translate them into ${langName} as you
record them. "Copy the note" means keep its meaning and its number, not its language.
In Latin, untranslated: part numbers, manufacturer names, standards, reference designators (P1, P4),
dimension codes (A, B, C), signal names, colours, units, drawing_number, drawing_name, project, and
every JSON key and enum value.
If you have written an open item or a discrepancy in English, rewrite it in ${langName} before you answer.
──────────────────────────────────────────────────────────────────────`;

  const langRule = langName==='English' ? '' :
`
OUTPUT LANGUAGE — read this before anything else:
Write every human-readable string in ${langName}. That means: every layer name and note, every strip
label and "basis" text, all open_items and discrepancies text, all engineering notes, and all
descriptions.

Keep these in their original Latin form, never translated or transliterated:
  - drawing_number, drawing_name and project — copy these from the title block EXACTLY as printed,
    in their original language. They identify the document; a translated title matches no paperwork.
  - part numbers and catalogue numbers (ISDF-04-D-M, RG-405SS, 50-57-9403)
  - manufacturer names (AMPHENOL, Samtec, Molex, TE)
  - standards (IPC/WHMA-A-620 Class 3, IPC-620, MIL-DTL-17)
  - reference designators (P1, J1, WSRV1) and dimension codes (A, B, C)
  - signal names and wire colours as printed (PWSERVO_R1, GRN, WHT)
  - units and numbers (320 mm, Ø2.20 mm, 28 AWG)
  - materials and technical terms an Israeli technician says in English (PTFE, SPCW, VSWR, crimp)
The JSON KEYS below stay exactly as written — English. Only the VALUES are in ${langName}.
Enum values ("coax", "multi_conductor", "crimp", "cable_only" …) also stay English.
`;
  return `You are a cable-harness manufacturing engineer. From this drawing, produce a CUT AND STRIP specification that a bench operator can work from.
${langRule}
Return ONLY a JSON object. No markdown fence, no commentary.

HEBREW AND THE DOUBLE QUOTE — this is the single most common way a reply is thrown away.
Hebrew abbreviations are written with a double quote inside the word: מק"ט, מ"מ, ס"מ, ח"כ. That
character ENDS the JSON string it sits in and destroys the rest of the answer. Never type " inside a
value. Write the abbreviation with the Hebrew gershayim ״ (U+05F4) — מק״ט, מ״מ — or spell the word
out. The same goes for a quoted phrase: use ״ ״ or drop the quotes entirely.

OUTPUT SIZE — a reply that runs out of room is a wasted analysis, and this is the most common way this
job fails. Return MINIFIED JSON: no indentation, no line breaks between fields, no spaces after colons
or commas. Omit a key entirely rather than writing an empty string or an empty array. Never restate in
prose a number that already has its own field.

This sheet is the CUT and the STRIP. It is not the build sequence: there is no "steps", no
"inspection" and no "tools" key in the schema below, and writing one is how a reply runs out of room
before it has finished the dimensions. The assembly instructions are produced separately, from this
specification, on their own sheet.
${core ? `
THIS PASS IS THE CUTTING DATA ONLY. Do NOT write "conductors", "markers", "sleeves" or
"engineering_notes": they are not in the schema below and they are asked for in a second request of
their own, so writing them here only takes room from the numbers. What this pass must not miss, in
this order: every cable run with its length and its ends, every strip dimension, and the COMPLETE
part list in "materials" — every row of the BOM, because how many wires to cut is worked out from
it. A reply that skips the part list is a reply the bench cannot work from.
` : ''}
Hard limits, and they are limits, not targets:
  - every prose string: 120 characters
  - "engineering_notes": only notes that change what the operator DOES; at most 6
  - "open_items" and "discrepancies": at most 5 each
  - "materials": one line per BOM row, description copied short — never re-described
The dimensions, the ends and the wiring table are what this sheet is for. Everything else is
supporting text, and supporting text that crowds out a dimension has cost more than it is worth.

{
  "drawing_number": "the DRAWING NO from the title block — the part number of THIS harness",
  "drawing_name": "the Description / title of the harness, copied VERBATIM from the title block — never translated",
  "project": "the Project field, e.g. \\"H-120 GEN C\\" — the programme this belongs to, NOT the drawing number",
  "revision": "e.g. 01.0",
  "standard": "workmanship standard called out on the drawing, else \\"\\"",

  "counts": {"marking_table_rows": <how many rows the marking/label table has>,
             "connectors_on_drawing": <how many distinct connector refs the assembly view and part list show>,
             "cable_runs": <how many separate cable runs there are>},

  "topology": "point_to_point | breakout | multi_branch",
  "route_dimensions": [ {"from":"P1","to":"P4","mm":200,"what":"what the arrow spans, as drawn"} ],
  "overall_length_mm": <the longest end-to-end dimension on the drawing — the harness's own overall length>,
  "breakouts": [ {"id":"BR1","note":"where the trunk fans out into the branches"} ],
  "bundle": {"at":"P1","length_mm":<how far back from that connector the runs are laced/taped into ONE bundle, or null>,
             "method":"lacing cord | spiral wrap | tape | braided sleeve", "part_number":"",
             "note":"what the drawing says about tying them together"},

${core ? '' : `  "engineering_notes": [ {"n":"1","text":"the note restated for the operator, in the output language — its number is kept, its wording is yours",
                          "applies_to":"P1 | S1 | labels | glue | whole harness",
                          "action":"what the operator must actually DO because of it, or \"\" if it is background"} ],
`}

  "connectors": [
    { "ref":"J1", "kind":"connector | open_wires | splice | ring_terminal",
      "ref_source":"drawing | assigned",
      "ref_seen_as":"the exact text you read on the drawing for this connector, or \"\" if it has none",
      "part_number":"ISDF-04-D-M", "manufacturer":"Samtec",
      "description":"what it is",
      "positions": <number of contacts, or null>,
      "termination":"crimp|solder|clamp|idc",
      "contact_pn":"the separate contact/socket/pin part number if the connector uses loose contacts, else \\"\\"",
      "body_length_mm": <how far this connector extends beyond the point where the cable enters it, in mm, or null if unknown — only needed when a run's length_basis is over_connectors>,
      "datasheet_ref":"the assembly spec that governs its cable prep, if named" }
  ],

  "segments": [
    { "id":"S1", "from":"P1", "to":"WSRV1",
      "cable_part_number":"", "cable_description":"",
      "type":"coax|single_wire|multi_conductor|twisted_pair",

      "finished_length_mm": <number>,
      "length_basis":"to_jacket_end|cable_only|over_connectors|unclear",
      "allowances":[ {"ref":"P1","mm":4.0,"reason":"cable insertion depth into the connector body","confirmed":false} ],
      "trim_allowance_mm": <number>, "trim_allowance_confirmed": <true|false>,
      "cut_length_mm": <number>,
      "cut_length_tolerance_mm": <number>, "cut_length_tolerance_confirmed": <true|false>,

      "layers":[ {"name":"Jacket","od_mm":3.6,"material":"PVC","note":"what the operator must watch out for"},
                 {"name":"Braid shield","od_mm":3.0,"material":"tinned Cu","note":""},
                 {"name":"Conductor insulation","od_mm":0.9,"material":"PE","note":""} ],
      "layers_confirmed": <true|false>,

      "ends":[
        { "ref":"P1",
          "strip":[ {"code":"A","label":"Jacket removed from the cable end","value_mm":25,"derived":false,
                     "confirmed":false,"basis":"where this number came from"} ],
          "strip_tolerance_mm":0.5,
          "legs":[ {"conductor":"Brown","to":"T1","length_mm":50,"strip_mm":8,"terminal_pn":"3200522",
                    "confirmed":true} ] }
      ],

      "conductor_strip_mm": <number>, "conductor_strip_confirmed": <true|false>,
      "shield_treatment":"what happens to the shield/drain at each end, in plain language, or \\"\\""${core ? '' : `,
      "conductors":[ {"name":"PWSERVO_R1","color":"GRN","awg":28,
                      "from_pin":"1","to_pin":"1","note":""} ]`}
    }
  ],

${core ? '' : `  "sleeves":  [ {"part_number":"","kind":"heatshrink","segment":"S1","from_end":"P1","distance_mm":0,
                 "length_mm":5,"qty":2,"position":"plain-language position","confirmed":true} ],
  "markers":  [ {"part_number":"","label":"A","segment":"S1","from_end":"P1","distance_mm":50,
                 "position":"where the drawing says to put it, in words, when it gives no dimension",
                 "confirmed":false,"text_lines":["DB9 FEMALE","RS422"]} ],
`}
  "materials":[ {"item":1,"part_number":"","manufacturer":"","description":"","qty":"1","ref":"P1",
                 "kind":"wire|cable|connector|contact|label|sleeve|other",
                 "length_mm": <the length this BOM line calls for, in mm, when it gives one (convert m and inches) — else null>} ],
  "open_items":[ {"what":"","why":"","action":""} ],
  "discrepancies":[ {"what":"","detail":""} ]
}

RULES — these matter more than completeness:

0. HOW MANY CABLES THERE ARE comes from the PART LIST, not from the number of dimensions.
   Read the BOM first. A line that is a CABLE — several conductors under one jacket, e.g. "Power Cable
   14AWG, 3 Cond, Unshielded", with a quantity like "1m" — is ONE ready-made cable, and that is ONE
   segment, with that part number, cut to the overall length. Only a harness built from separate wires,
   or one with several separate cables, has more than one segment.
   A DIMENSION CHAIN ALONG ONE CABLE IS NOT A LIST OF CABLES. On a single cable the drawing dimensions
   many things — 70 at one end, 20 to a label, 1000 overall, 30 and 50 at the other end. Those are the
   jacket strip, the label positions and the breakout lengths OF THAT ONE CABLE. Never turn a dimension
   into a segment of its own. A segment always runs between two ENDS of cable — a connector, a set of
   terminals, or free wires — never between a label and a connector.
   LABELS ALONG THE CABLE are markers. A box or rectangle drawn on the cable with text in it ("Elec.
   Cabinet W2", "601-1201-022 REV 3", "Main Switch") is a printed label or heat-shrink marker — it goes in
   "markers", with its distance from the nearer end. It is never a connector and never an end. The BOM
   usually confirms it with a LABEL or TUBING line whose quantity is the number of labels.
   HEAT-SHRINK TUBING, SLEEVES AND LABELS are never a cable and never a segment.
   ONE END CAN FAN OUT. When a cable end splits into its individual conductors, each finished with its
   own terminal, ferrule or lug (T1, T2, T3 …), that is ONE end of the cable — not one segment per wire.
   Put the jacket strip on that end ("strip" code A = how far the jacket is removed), and one entry per
   conductor in "legs": its colour, where it goes ("to": T1), its length measured from the jacket end
   ("length_mm" — when the drawing staggers them, T1 50 and T2/T3 30, copy each), the insulation strip at
   its tip ("strip_mm"), and the terminal's part number ("terminal_pn"). For a ferrule, the strip is the
   ferrule's sleeve length — the "8" in AI 2.5-8 is 8 mm — confirmed:false unless printed. The terminals
   themselves are contacts on that end, not connectors: do not list T1, T2, T3 in "connectors".
   A NOTE THAT GIVES A STRIP ("on side A strip 70 mm from the cable insulation so the wires will bend in
   the 90 deg connector") is the jacket strip at that end: code A = 70, confirmed:true, and the reason
   goes in its "basis".
   THE OVERALL LENGTH of a ready-made cable with connectors fitted is measured over the connectors unless
   the drawing says otherwise: length_basis "over_connectors".
   THE ENDS ARE NAMED BY SIDE when the drawing does — "SIDE A", "SIDE B". Use the connector's own
   reference for a connector end, and for a fan-out end use the side name ("SIDE B").

1. A LABEL TABLE IS NOT A CONNECTOR LIST. Read this before anything else.
   Many drawings carry a LABEL TABLE / MARKING TABLE: single letters A, B, C … each with the TEXT to
   print on a marker sleeve. Those letters identify SLEEVES placed along the cable — they are markers,
   and they belong in "markers" with their text in "text_lines". They are NOT connectors and must never
   become entries in "connectors" or appear as "from"/"to" on a segment.
   EVERY ROW OF THAT TABLE MUST APPEAR IN "markers" — all of them, not the ones that were easy to place.
   A marking table with rows B, C, D, E and F produces FIVE markers. If a label's position is described in
   words rather than dimensioned ("place E on the soldering points", "as close as possible to the
   connector"), still create the marker: put the words in "position", leave "distance_mm" null, and add an
   open item asking for the dimension. A label left out is a label the operator never fits.

   Connectors come from the PART LIST and from the connector bodies drawn on the assembly view.

   USE THE DESIGNATOR PRINTED NEXT TO EACH CONNECTOR BODY, EXACTLY AS DRAWN. If the assembly view labels
   the fans P2, P3, P4 then those are their refs — do not renumber them, do not shift them, and do not
   take them from a different table. Copy the qualifier too when there is one: "P2 (FAN1)" tells the
   operator which physical part it is, so keep it in "description".
   If the WIRING TABLE uses different designators from the assembly view (a real drawing may say P2/P3/P4
   on the picture and P3/P4/P5 in the table), follow the ASSEMBLY VIEW, and record the disagreement in
   "discrepancies" naming both. Do not quietly pick one — an operator plugging into the wrong fan is a
   fault nobody catches until the unit is running.
   NEVER INVENT P1, P2, P3. A drawing that marks its ends X7, X9 and X16-18 has no P1 on it anywhere, and
   a sheet that says "cut from P1 to P4" sends an operator looking for something that does not exist. If a
   connector carries a mark of ANY kind — X7, J3, a letter from a table, a balloon number, a pin-list
   column header — that mark is its name. Copy it and set "ref_source":"drawing".
   Only when a connector truly carries no mark at all may you name it, and then name it for what it IS and
   where it IS — "BACKSHELL-LEFT", "OPEN-END-TOP", "38999-RIGHT" — never with a designator pattern the
   drawing does not use. Set "ref_source":"assigned" and put the text you actually saw in "ref_seen_as".
   The sheet prints assigned names with a note saying they are not on the drawing, so the operator knows
   to match by position instead of hunting for a label.

   A LABEL AND A CONNECTOR ARE AT DIFFERENT PLACES. The marking table says which text goes on which
   label; the assembly view says WHERE on the cable that label sits. Read the position off the assembly
   view — which run it is on, which connector it is measured from — not off the table. A label drawn
   near the fan end does not belong at the plug end because the table happens to list it first.

   LIST THE CONNECTORS IN THE ORDER THEY APPEAR ON THE DRAWING, top to bottom on the assembly view
   (so P2, P3, P4 if that is how they are stacked). The generated figure stacks its branches in this
   order, so listing them in a different order silently redraws the harness in a shape the operator
   cannot match against the drawing in front of them.

2. BUNDLING IS NOT A BREAKOUT. Get this right before you assign any length.
   Wires that simply run side by side — laced, taped, tied or sleeved together — are still SEPARATE runs.
   Each one goes the whole way from its connector to its connector, and each carries its OWN full length.
   Model that as one segment per destination, from connector to connector, with no breakout at all.
   A drawing that shows three fans on one plug with lengths 180, 180 and 200 has THREE runs of 180, 180
   and 200 — not a shared trunk with stubs hanging off it.
   Use a "breakouts" node ONLY when a SINGLE jacketed cable physically splits and its conductors leave in
   different directions — and in that case the drawing dimensions the trunk separately from the branches.
   When in doubt, do not create a breakout: separate full-length runs are always safe to cut, whereas a
   wrongly split run tells the operator to cut a wire far too short, and short wire is scrap.
   And when there IS a breakout, model it as a node: the trunk is a segment from the far connector to the
   breakout id, and each branch is a segment from that id to whatever it ends at. Do NOT chain the
   connectors together (A→B→C) when the drawing shows them fanning from one point — that describes a
   different harness from the one on the paper.

3. NOT EVERY BRANCH ENDS IN A CONNECTOR. A branch can finish as OPEN WIRES, a splice, or ring terminals.
   Give it a connectors[] entry with the matching "kind" and a ref like "OPEN", so the run has somewhere
   to end and the operator is told how to finish it. For open wires, say in the segment's
   "shield_treatment" what is stripped, tinned and how far the wires are separated.

4. LENGTHS ON A DRAWING ARE END TO END. This is the single most common way to get a harness wrong.
   A dimension arrow runs from one connector to another connector. "200 mm" means: from THAT connector to
   THAT connector, the whole way. It never means "as far as the point where the bundle separates".
   So "finished_length_mm" on a segment is the FULL length of that run, connector to connector, exactly as
   the arrow measures it — and a wiring-table "Length (mm)" column is the same thing, per wire.
   Record every dimension you can see in "route_dimensions" as it appears, saying what it spans:
     "route_dimensions":[ {"from":"P1","to":"P4","mm":200,"what":"overall, longest run"},
                          {"from":"P1","to":"P2","mm":180,"what":""} ]
   Then make each segment's finished_length_mm agree with the dimension that measures it. Never put the
   overall length on every run, and never leave a run without the length that is actually drawn for it.
   If a genuine trunk exists, the trunk gets its own dimension and the branches get theirs; if the drawing
   only gives end-to-end figures, model separate full-length runs (see rule 2) so nothing has to be guessed.
   Contradictory dimensions go in "discrepancies" — do not silently pick one.
   CHECK EVERY ROUTE DIMENSION AGAINST THE WIRING TABLE. The wiring table lists a length per connector
   column, and that is the arbiter of WHICH run a dimension belongs to. If the table says the Fan3
   column is 200 and the other two are 180, then the 200 mm arrow spans the Fan3 connector to P1 — even
   if the arrow is drawn nearer the top of the picture. Map the table's column headers onto the assembly
   view's designators first, put that mapping in "discrepancies" when the two disagree, and only then
   decide which connector each dimension reaches. Attaching a 200 to the wrong fan gives one run 20 mm
   too much and another 20 mm too little, and only one of those two errors is recoverable.
   When several runs are laced, taped or sleeved together over their common stretch, that is a BUNDLE:
   fill in "bundle" with the connector they run into, how far back the lacing goes, and what holds them.
   The runs stay separate full-length cables in "segments" — bundling changes how the harness is
   assembled and drawn, never how long any wire is cut.
   Set "overall_length_mm" to the largest end-to-end dimension the drawing gives: the length of the whole
   harness, the figure a planner quotes and a stores clerk checks against. On the fan harness above that
   is 200, the longest run — not the sum of the runs, and not the shortest one.

5. YOU ARE GIVEN EVERY SHEET OF THE DRAWING. They arrive labelled SHEET 1 OF n. A harness package puts
   the assembly view on one sheet and the connector names, the pin lists and the wiring tables on the
   others — so the sheet that tells you what an end is CALLED is usually not the sheet that shows you
   where it is. Read them all before you write anything.
   A designator that appears only on sheet 3 is still that connector's designator. A pin list on sheet 2
   belongs to the connector drawn on sheet 1. Match them up by reference and by position, and put what you
   learn in "conductors" with from_pin and to_pin filled in.
   If two sheets disagree, that goes in "discrepancies" naming both sheets.

6. READ THE WHOLE HARNESS BEFORE YOU WRITE ANY OF IT. A drawing with balloons numbered to 27, a branch
   table, four dimension chains and several terminations is not one cable with two ends. Walk the picture:
   follow every line from every termination back to where it joins another, and list one segment per run
   and one connector per termination. Count the terminations by pointing at each one in turn.
   If the harness branches, say so in "topology" and give the breakouts. Collapsing a branched assembly
   into a single run is not a simplification — it produces one cut length for a harness that needs
   several, and every one of them will be wrong.
   BREAKOUTS NEST. A trunk that splits into two, one of those splitting again further along, is normal:
   give a breakout for each split, a segment from the connector to the first, a segment from the first to
   the second, and a segment from each breakout out to whatever it feeds. The overall length is then the
   longest path THROUGH the harness — trunk plus branch — and the sheet works it out from the segments,
   so getting the chain right is what makes the total right.
   When the drawing genuinely defeats you — too dense, a view you cannot resolve — say that in
   "open_items" and give what you are sure of. An honest partial reading can be finished by a person; a
   confident wrong one gets cut.

7. DECLARE YOUR COUNTS, THEN MATCH THEM. Before writing the arrays, count on the drawing: how many rows
   the marking/label table has, how many distinct connector references the assembly view and part list
   show, and how many separate cable runs there are. Put those three numbers in "counts".
   Then make the arrays match them exactly — five marking-table rows means five entries in "markers",
   four connector refs means four entries in "connectors". The sheet compares your arrays against your
   own counts and shows the operator any gap, so a dropped label or connector is visible rather than
   silent. Getting the count right matters more than getting every field of every entry right: an entry
   with an open item is workable, a missing entry is invisible.

8. COUNT THE CABLES AND THE CONNECTORS FIRST, AND COVER ALL OF THEM.
   Look at the assembly view and count every connector body and every separate cable run. A harness with
   three connectors and two cable runs gets THREE entries in "connectors" and TWO in "segments" —
   one segment per cable run, each naming the two connectors it links. Do NOT collapse a branched
   harness into a single cable with two ends, and do not stop after the first run you recognise.
   Cross-check your count against the part list quantities: a connector with QTY 2 is fitted at two
   places, and a wiring table with two destination columns means two runs.
   If a connector or a cable run appears on the drawing but you cannot work out its details, still list
   it, fill in what you can, and put the gap in "open_items" — a missing run is far worse than a thin one.

9. DRAWING NUMBER vs NAME vs PROJECT. The title block has all three and they are different things.
   "drawing_number" is this harness's own part number (DRAWING NO). "drawing_name" is its description.
   "project" is the programme it belongs to. Never put the project name in drawing_number.

10. READ THE ENGINEERING NOTES BLOCK. Almost every drawing carries one, and it is where the
   instructions live that are nowhere else on the sheet: the workmanship standard, whether the stated
   length includes the connectors, which item is the lacing cord, where each label goes, where glue may
   and may not reach, what to check afterwards. An operator working only from the dimensions will get a
   part that measures correctly and is still rejected.
   Put EVERY note in "engineering_notes", keeping its number, and say in "action" what the operator has
   to DO about it, in a few words — "tie all wires together at these points". A note that only gives
   background (what "##" stands for, "see PIC 1") keeps "action":"".
   Write each note ONCE. This sheet is the cut and the strip; the build sequence is written elsewhere.
   If a note contradicts a dimension or a table, that goes in "discrepancies".

11. CONFIRMED vs DERIVED. Set "confirmed": true ONLY when the value is printed on the drawing, or comes
   from a manufacturer datasheet you actually know for that exact part number. If you calculated it,
   inferred it from connector geometry, or took it from a similar part, set "confirmed": false and say
   so plainly in "basis". A wrong strip dimension destroys parts — never dress up a guess as a fact.

12. Still give a number. When a dimension is not confirmed, provide your best engineering proposal anyway
   with confirmed:false, so the sheet is usable while engineering verifies it. Only use null when you
   have no defensible basis at all.

13. OPEN ITEMS. Every unconfirmed dimension gets an entry in "open_items" naming what is unverified, why,
   and the action that closes it.

14. DISCREPANCIES. Report contradictions in the drawing rather than silently picking one: file name vs
   title block, balloon numbers vs part-list item numbers, dimensions that do not add up, a wiring table
   with more wires than the connector has positions. Do not "fix" them.

15. CUT LENGTH vs FINISHED LENGTH — per segment, and it is what the operator actually cuts.
   "finished_length_mm" is the length AS DIMENSIONED ON THE DRAWING for that run, and "length_basis"
   says what that dimension measures:
     - "to_jacket_end"    the dimension runs to where the JACKET ends at each end. THIS IS THE DEFAULT
                          for this shop — use it unless the drawing plainly says otherwise. Leaving the
                          field out, or saying "unclear", is treated as this too.
     - "cable_only"       the dimension is the bare cable, connectors excluded
     - "over_connectors"  the dimension spans the whole run, connector face to connector face
     - "unclear"          the drawing does not say
   "cut_length_mm" is ALWAYS finished_length_mm + sum of allowances + trim_allowance_mm, and must equal
   that sum exactly — do not report a cut length that contradicts its own parts.
   UNDER "to_jacket_end" THE APP DOES THE ADDING, NOT YOU. Each end costs the jacket strip plus a fixed
   1.5 mm handling margin, and the app reads the strip straight out of "strip" on that end. So a 180 mm
   run with an 8 mm jacket strip at both ends is cut at 180 + (8 + 1.5) + (8 + 1.5) = 199 mm, and you
   supply only the 180 and the 8s. Do NOT also put those 8s in "allowances" — you would be handing over
   the same number twice and the app would add it twice.
   Leave "allowances" for something genuinely extra that the drawing calls for and that nothing else
   accounts for, such as a service loop. Most runs have none, and an empty list is the right answer.
   A genuine extra belongs to the RUN, so leave its "ref" empty. An allowance naming an END is taken to
   be another attempt at that end's cost, which the app has already worked out — it is struck through on
   the sheet rather than added, because adding both is the same double count wearing a different name.

   AN ALLOWANCE IS CABLE YOU WOULD NOT OTHERWISE HAVE. Ask one question of every entry: does this make
   the piece coming off the reel LONGER? Only two things do — cable that disappears inside the connector
   body (insertion depth), and slack the drawing calls for. Squaring and re-stripping is material cut
   off, so it goes in trim_allowance_mm.
   A STRIP DIMENSION IS NOT AN ALLOWANCE. Stripping removes jacket; it removes no length. A conductor
   bared 8 mm back from the end is still in the same place it was — the cable is not one millimetre
   shorter for it, so nothing has to be added to compensate. Putting an 8 mm strip into "allowances"
   alongside the 4 mm insertion depth counts the same end twice and sends the operator 8 mm of scrap
   per end. Strip dimensions belong in "strip" on the end, and nowhere else.
     - length_basis "cable_only" with nothing else consuming cable may legitimately give 0 allowances —
       say so in "reason" rather than inventing a number. Zero is a real answer here and often the right
       one; a fabricated allowance is worse than an honest zero with an open item against it.
     - length_basis "over_connectors" means the cable is SHORTER than the dimension: use NEGATIVE mm.
     - Insertion depth comes from the connector's assembly spec. Without it, give a defensible estimate,
       set confirmed:false, and say what it was derived from.

   READ THE DIMENSION LINE BEFORE YOU DECIDE THE BASIS. This is the single most expensive field on the
   sheet, so decide it from what the drawing actually shows, not from habit:
     - arrows landing on the OUTER FACES of the two connectors, or on the extreme ends of the assembled
       harness → "over_connectors". This is the common case on a finished-harness drawing: one long
       dimension across the whole picture, from the back of one connector to the back of the other,
       with the connectors drawn inside it. Also give each connector's "body_length_mm", because the
       cable is shorter than the dimension by exactly those lengths and the app subtracts them. Under
       this basis the app adds NOTHING for the ends and never issues a piece longer than the dimension
       — the figure is the finished article, so do not put end allowances in "allowances" either.
     - arrows landing where the JACKET ENDS / at the back of each backshell → "to_jacket_end".
     - a note such as "cable length", "wire length", "cut length", or a dimension on a bare cable with
       no connectors drawn → "cable_only".
     - genuinely ambiguous → "unclear". Say so; do not pick one to look decisive. The sheet prints
       "assumed" against an unclear basis and asks a human, which is the correct outcome.

18b. THE QUANTITY COLUMN IS OFTEN A LENGTH. These BOMs have QTY and UNIT columns side by side:
   "12" with UNIT "m" is TWELVE METRES of wire, not twelve pieces. Copy both columns as they are
   printed — "qty":"12","unit":"m" — and put the converted length in "length_mm" (12000). Never turn a
   length into a piece count, and never copy the harness length onto a wire line: a wire line saying
   12 m against a 3 m harness means four pieces of 3 m, and writing it as "12 × 3000" orders 36 metres
   the drawing never asked for.

18c. A TERMINATED END ALWAYS GETS A STRIP DIMENSION. Drawings rarely dimension the strip — it belongs
   to the contact, not to the cable — but the operator still has to strip the wire, so an end with an
   empty "strip" is a sheet nobody can work from. Give your best number from the contact and the wire
   gauge (a 22 AWG crimp contact is bared about 3.5 mm), set "confirmed":false, and say in "basis"
   that it comes from the contact rather than the drawing. Do the same for "conductor_strip_mm".

19. READY-MADE CABLE, OR WIRES YOU BUILD IT FROM? Compare the wire/cable length on the BOM with the run
   length. A BOM line for 12 000 mm against a 4 000 mm run is not a 12 m cable: it is three 4 m wires,
   and the assembly is built from loose wire rather than from a jacketed cable. When that is what the
   drawing shows:
     - give the BOM line "kind":"wire" and its "length_mm",
     - fill "conductors" with one entry per wire, because that list is what says how many pieces to cut,
     - set the segment "type" to "single_wire" or "multi_conductor" as appropriate and leave
       "cable_part_number" as the WIRE part number.
   The app then prints "cut N wires of X mm" on the form. Do not silently average the BOM length into
   one long run — no such piece exists.

16. MULTI-CONDUCTOR CABLE. Fill in "conductors" from the wiring table: one entry per wire, with its
   signal name, colour, AWG and the pin it lands on at each end. This table IS the work instruction for
   a crimped harness — an operator cannot terminate without it, so do not leave it empty when the
   drawing has a wiring table. "conductor_strip_mm" is how much insulation comes off each individual
   wire for its contact (a different, much smaller number than the jacket strip "A").
   Say in "shield_treatment" what happens to the shield and drain wire at each end — grounded to a pin,
   cut back and insulated, or terminated to a ferrule. Getting this wrong is a functional failure that
   inspection will not catch.

17. LAYERS — always give at least the outer covering and the conductor, even on a simple wire. Without
   them the strip figure has to draw a generic cable and says so on the sheet, which is worse than the
   real thing. LAYERS run OUTERMOST FIRST. For single_wire there are two layers (insulation, conductor) and only
   strip code "A". For a shielded multi-conductor cable list jacket, shield, and conductor insulation.

18. STRIP CODES. "A" is always measured from the cable end. "derived":true marks a dimension that is
    arithmetic from the others (like C = A − B) rather than an independent setting.

19. NEVER PUT A DIMENSION IN THE PROSE THAT IS NOT IN THE FIELDS. The sheet computes its tables and its
   figures from the structured values, so those always agree with each other. Step text does not — it is
   whatever you wrote. If a step says "allow 4 mm at each end" while "strip" says 8, the operator has two
   different instructions and no way to tell which is real.
   So: every millimetre figure you write into a step, a check or a note must be one you also put in a
   field — a strip value, a finished length, a cut length, a marker distance. Better still, refer to it by
   name: "cut to the length in the cut table", "strip to dimension A". The sheet flags any number in your
   prose that it cannot find among its own, so an invented one will be visible.

20. STEPS. Write for someone holding the cable, not for an engineer. Tag each step with the "segment"
    it belongs to when the harness has more than one, so the operator knows which run they are on.
    Include threading sleeves on BEFORE connectors if the assembly has sleeves — that mistake scraps
    the cable. Every segment must be covered by the steps, not just the first one.

21. Units in millimetres throughout.
${langTail}`;
}

export const _CS_TRUNCATED='The analysis was cut off before it finished — this drawing produces more detail than one reply can hold. Try again; if it keeps happening, split the drawing or analyse it in English (Hebrew costs about twice the space).';
// Unbalanced braces mean the JSON stopped mid-object. Saying "malformed" for
// that sends the user looking for a bad drawing when the reply was simply
// unfinished, which is a different problem with a different fix.
export function _csLooksTruncated(text){
  let depth=0, inStr=false, esc=false;
  for(const ch of String(text||'')){
    if(esc){ esc=false; continue; }
    if(ch==='\\'){ esc=true; continue; }
    if(ch==='"'){ inStr=!inStr; continue; }
    if(inStr) continue;
    if(ch==='{') depth++;
    else if(ch==='}') depth--;
  }
  return inStr || depth>0;
}
// ── Rescuing an answer that did not arrive whole ─────────────────────────────
// Until now an unfinished or malformed reply threw everything away: the
// operator waited two minutes, watched the upload, and got "nothing was saved,
// try again" — which costs another two minutes and usually ends the same way.
//
// Three things go wrong with model-written JSON, and each has its own repair:
//   1. it stops mid-sentence  → close what is open and keep the head
//   2. a raw newline or tab sits inside a string, or a comma dangles before a
//      closing bracket → both are one-character fixes
//   3. something inside is broken beyond repair (an unescaped quote in a
//      Hebrew note, most often) → cut back to the last point that still parses
// Everything before the damage is exactly what the model meant to write, so a
// partial cut-and-strip form an engineer can finish beats no form at all.
// The last reply that could not be read, kept so the operator can hand it over
// instead of describing it. A failure nobody can see is a failure nobody can fix.
export let _csLastRawReply='';
export function _csParse(raw){
  const text=String(raw||'').trim();
  if(!text) throw new Error('The AI returned an empty response');
  // Parse it, correct the harmless mistakes, or cut back to the last point that
  // still parses — in that order, so as little as possible is lost.
  const got=_csSalvageJson(text);
  if(!got){
    // Nothing in it could be read at all. Say which failure it was and show
    // where it broke, so the next report is diagnosable instead of a shrug.
    console.error('[CutStrip] unreadable reply:', text);
    _csLastRawReply=text;
    if(_csLooksTruncated(text)) throw new Error(_CS_TRUNCATED);
    let where='';
    try{ JSON.parse(text.slice(text.indexOf('{'))); }
    catch(e){
      const at=/position (\d+)/.exec(e.message||'');
      where = at ? ` — at character ${at[1]}: …${text.slice(Math.max(0,+at[1]-60), +at[1]+60)}…`
                 : ` — ${e.message}`;
    }
    throw new Error('The AI reply could not be read as a specification'+where);
  }
  const obj=got.obj, partial=got.partial;
  if(typeof obj!=='object') throw new Error('AI response was not an object');
  // A cutting form needs runs and ends; the operation steps moved to the
  // Manufacturing Instructions screen and are no longer what makes a reply
  // usable. Refuse only when there is nothing of a harness in it at all.
  const hasHarness = (Array.isArray(obj.segments) && obj.segments.length)
                  || (Array.isArray(obj.ends) && obj.ends.length)
                  || (obj.cable && typeof obj.cable==='object')
                  || (Array.isArray(obj.steps) && obj.steps.length);
  if(!hasHarness){
    // The reply was readable but has no harness in it. Say which of the two
    // happened — the model read the drawing as something else, or the answer
    // was damaged so early that only its header survived — and keep the reply
    // so it can be handed over instead of described.
    console.error('[CutStrip] no runs in reply:', text);
    _csLastRawReply=text;
    throw new Error(partial
      ? `The reply was damaged near the start — only its header could be read (${Object.keys(obj).length} fields, no cable runs). Try again; if it repeats, use the Copy button and send the reply on.`
      : 'The AI read this drawing but found no cable runs in it — it may not be a cable/harness drawing');
  }
  // Repairing a stray Hebrew quote in a reply that DID finish is not the same
  // as a reply that was cut off: only the second is missing anything.
  if(partial && !_csComplete(text)) obj._partial=true;
  // Normalise the shapes the renderer indexes into, so a partial response
  // degrades to a thinner sheet rather than throwing halfway through drawing.
  obj.ends       = Array.isArray(obj.ends) ? obj.ends : [];
  obj.sleeves    = Array.isArray(obj.sleeves) ? obj.sleeves : [];
  obj.markers    = Array.isArray(obj.markers) ? obj.markers : [];
  obj.engineering_notes = Array.isArray(obj.engineering_notes) ? obj.engineering_notes : [];
  if(obj.bundle && typeof obj.bundle!=='object') obj.bundle=null;
  obj.materials  = Array.isArray(obj.materials) ? obj.materials : [];
  obj.inspection = Array.isArray(obj.inspection) ? obj.inspection : [];
  obj.tools      = Array.isArray(obj.tools) ? obj.tools : [];
  obj.open_items = Array.isArray(obj.open_items) ? obj.open_items : [];
  obj.discrepancies = Array.isArray(obj.discrepancies) ? obj.discrepancies : [];
  obj.cable      = obj.cable && typeof obj.cable==='object' ? obj.cable : {};
  obj.cable = obj.cable && typeof obj.cable==='object' ? obj.cable : {};
  obj.cable.layers = Array.isArray(obj.cable.layers) ? obj.cable.layers : [];
  obj.cable.allowances = Array.isArray(obj.cable.allowances) ? obj.cable.allowances : [];
  obj.ends.forEach(e=>{ e.strip = Array.isArray(e.strip) ? e.strip : []; });
  _csNormalize(obj);
  _csSyncCutLength(obj);
  return obj;
}
// The second bite: the wiring table, the markers, the sleeves and the drawing
// notes, asked for on their own once the cutting data is safely in hand. The
// model sees the same drawing plus the skeleton it already produced, so the
// segment ids and connector refs line up without being guessed at twice.
export function _csDetailPrompt(lang, core){
  const LANGS={he:'Hebrew', ru:'Russian', en:'English'};
  const langName=LANGS[lang]||'Hebrew';
  const segs=(core?.segments||[]).map(sg=>
    `${sg.id||'S1'}: ${sg.from||''} → ${sg.to||''}${sg.cable_description?` (${sg.cable_description})`:''}`);
  const refs=(core?.connectors||[]).map(c=>
    `${c.ref||''}${c.positions?` (${c.positions} pos)`:''} ${c.part_number||''}`.trim());
  return `The cut and strip data for this drawing has already been read. What is missing is the
wiring, the markings and the drawing notes. Read them off the SAME drawing and return them.

Return ONE JSON object, minified, and nothing else:
{"segments":[{"id":"S1","conductors":[{"name":"","color":"","awg":22,"from_pin":"1","to_pin":"1","note":""}]}],
 "markers":[{"part_number":"","label":"A","segment":"S1","from_end":"P1","distance_mm":50,"position":"","confirmed":false,"text_lines":[""]}],
 "sleeves":[{"part_number":"","kind":"heatshrink","segment":"S1","from_end":"P1","distance_mm":0,"length_mm":5,"qty":2,"position":"","confirmed":true}],
 "engineering_notes":[{"n":"1","text":"","applies_to":"","action":""}]}

Use ONLY these segment ids — they are the runs already read from this drawing:
${segs.length?segs.join('\n'):'S1'}
And only these connector references:
${refs.length?refs.join('\n'):'(none read)'}

EVERY ROW of the wiring table becomes one entry in that segment's "conductors" — a table with 13
rows produces thirteen, not the ones that were easy. EVERY ROW of the label or marking table becomes
one "markers" entry, with its printed text in "text_lines"; a label whose place is described in words
rather than dimensioned still becomes a marker, with the words in "position" and "distance_mm" null.
EVERY numbered note on the drawing becomes one "engineering_notes" entry, keeping its number, with
"action" saying what the operator must DO about it — or "" when it is only background.

Limits: each string at most 140 characters; at most 10 notes. Omit a key rather than writing an
empty array.

Write the prose values in ${langName}. Part numbers, reference designators, signal names, colours,
units and every JSON key stay in Latin. Never type a double quote inside a value: in Hebrew use the
gershayim \u05F4 (מק״ט, מ״מ).`;
}
// How much of a harness a reading holds — enough to choose between two
// readings of the same drawing, not a quality score.
export function _csCompleteness(spec){
  if(!spec) return 0;
  // Distinct entries only — a repetition loop must not score by repeating.
  const uniq=(arr,key)=>new Set((Array.isArray(arr)?arr:[]).map(key)).size;
  const segs=Array.isArray(spec.segments)?spec.segments:[];
  const ends=segs.reduce((n,sg)=>n+uniq(sg.ends, e=>String(e?.ref||'')),0);
  return uniq(segs, x=>String(x?.id||''))*10 + ends*3
       + uniq(spec.materials, m=>`${m?.item??''}|${m?.part_number||''}`)*2
       + uniq(spec.connectors, c=>String(c?.ref||''))*2;
}
// The part list on its own. Small, flat, and the single input the wire count
// depends on — so it is the one thing worth a request of its own when the
// main reading came back without it.
export function _csBomPrompt(lang){
  return `Read the PART LIST / BOM table on this drawing and return it, every row, as ONE minified JSON
object and nothing else:
{"materials":[{"item":1,"part_number":"","manufacturer":"","description":"","qty":"12","unit":"m","kind":"wire|cable|connector|contact|label|sleeve|other","length_mm":12000}]}

Copy every row — a table with ten rows gives ten entries. "qty" and "unit" are copied exactly as
printed: a wire row reading 12 in QTY and m in UNIT is twelve metres, so "length_mm" is 12000 and it is
the whole length of that line, not the length of one piece. Descriptions are copied short and in their
original language. Never type a double quote inside a value.`;
}
// Folds the second bite into the first. Only ever ADDS: a core value already
// read from the drawing is never overwritten by the detail pass, because the
// core pass is the one whose numbers the bench cuts to.
export function _csMergeDetail(spec, det){
  if(!spec || !det || typeof det!=='object') return 0;
  let n=0;
  const segs=Array.isArray(spec.segments)?spec.segments:[];
  (Array.isArray(det.segments)?det.segments:[]).forEach(d=>{
    const id=String(d.id||'').trim().toUpperCase();
    const tgt=segs.find(sg=>String(sg.id||'').trim().toUpperCase()===id) || (segs.length===1?segs[0]:null);
    if(!tgt) return;
    const cs=Array.isArray(d.conductors)?d.conductors:[];
    if(cs.length && !(tgt.conductors||[]).length){ tgt.conductors=cs; n+=cs.length; }
  });
  ['markers','sleeves','engineering_notes'].forEach(k=>{
    const v=Array.isArray(det[k])?det[k]:[];
    if(v.length && !(Array.isArray(spec[k])?spec[k]:[]).length){ spec[k]=v; n+=v.length; }
  });
  return n;
}
export async function _csAnthropic(text, isImage, imgData, lang){
  const prompt=_csPrompt(lang, _CS_PHASE_CORE);
  // Each sheet is announced before its image. Without the labels the model sees
  // a pile of pictures; with them it can say "the pin list on sheet 2" and mean it.
  const sheets = (imgData && imgData.pages && imgData.pages.length) ? imgData.pages
               : (imgData && imgData.b64 ? [imgData.b64] : []);
  const imgBlocks = sheets.flatMap((b64,i)=>[
    {type:'text', text:`SHEET ${i+1} OF ${sheets.length}`},
    {type:'image', source:{type:'base64', media_type:imgData.mimeType, data:b64}}]);
  const messages = isImage
    ? [{role:'user',content:[...imgBlocks, {type:'text',text:prompt}]}]
    : [{role:'user', content: prompt+'\n\nDRAWING TEXT:\n'+String(text||'').slice(0,24000)}];
  // temperature 0 for the same reason as the labor estimate: reading dimensions
  // off a drawing is not a creative task, and a spec that comes back different
  // every time it is run cannot be checked against itself.
  const ask=async (msgs, temp)=>{
    const resp=await _aiFetch({
      // The first pass is at 0: reading dimensions off a drawing is not a
      // creative task, and a spec that comes back different every run cannot be
      // checked against itself. A continuation runs slightly warm, because a
      // reply that filled its window at 0 will often walk straight back into
      // the same repetition when continued at 0.
      body:JSON.stringify({model:_csModel(),max_tokens:_CS_MAX_TOKENS,
                           temperature:(temp!=null ? temp : (msgs.length>1?0.2:0)),messages:msgs})
    }, _CS_ANALYSIS_TIMEOUT);
    if(!resp.ok){let m=`Anthropic error ${resp.status}`;
      try{const e=await resp.json();m=e.error?.message||m;}catch{}
      // The stronger model is not available on every account. That is a
      // reason to fall back, once, to the one that is — not to fail the
      // analysis. Anything else is a real error and is reported as before.
      if(_csModelRejected(resp.status, m)){ S._csModelDown=true; return ask(msgs, temp); }
      throw new Error(_csProviderHint('Anthropic', m));}
    const d=await resp.json();
    return {text:(d.content&&d.content[0]&&d.content[0].text)||'', stop:d.stop_reason};
  };

  // A long structured answer can outrun one reply. Rather than throwing the
  // work away and telling the operator to "try again" — which costs another
  // full analysis and usually ends the same way — the unfinished answer is
  // handed back to the model to carry on from, and the pieces are joined.
  // Each phase gets its own run of this, and therefore its own budget.
  const run=async (msgs, temp)=>{
  let out=await ask(msgs, temp);
  let reply=out.text, rounds=0, stopReason='';
  while(out.stop==='max_tokens' && rounds<_CS_MAX_CONTINUATIONS){
    // Three ways a continuation is not worth buying, all of them meaning the
    // model is no longer making progress towards a closing brace. Spotting
    // them matters more than the ceiling does: a run that spends its whole
    // budget on a stutter hands over a partial sheet after four minutes.
    if(_csLoopy(reply)){ stopReason='loop'; break; }
    if(reply.length>=_CS_MAX_REPLY_CHARS){ stopReason='budget'; break; }
    if(_csComplete(reply)){ stopReason='complete'; break; }
    rounds++;
    if(S._csOnProgress) S._csOnProgress(rounds);
    // The partial answer becomes a prefilled assistant turn; the model writes
    // the rest of it. Trailing whitespace in a prefill is rejected by the API.
    const partial=_csTrimPrefill(reply);
    const before=partial.length;
    out=await ask([...msgs, {role:'assistant', content:partial}]);
    reply=_csStitch(partial, out.text);
    // A continuation that adds almost nothing, or that only repeats what it
    // was handed, will do the same again next round.
    if(reply.length-before<40){ stopReason='stalled'; break; }
  }
  // Out of continuations and still unfinished: rather than throwing away
  // everything the model did write, the reply is repaired and whatever it
  // contains becomes the sheet — marked partial, so nobody mistakes it for a
  // complete reading of the drawing. _csParse only throws now when there is
  // genuinely nothing usable in the answer.
    // Partial means the answer really was cut off mid-thought. A reply that the
    // salvage could close, or that we stopped because it had said everything it
    // was going to say, is a whole reading even if the API's last stop_reason
    // was max_tokens — flagging those taught the operator to ignore the banner,
    // which is worse than not having one.
    const cut = out.stop==='max_tokens' && stopReason!=='complete' && !_csComplete(reply);
    return {reply, cut, rounds, why:stopReason, stop:out.stop};
  };

  let a=await run(messages);
  let spec=_csParse(a.reply);
  if(a.cut) spec._partial=true;
  logSystemAudit('cut_strip_reply',
    {phase:'core', stop:a.stop, why:a.why, rounds:a.rounds, chars:a.reply.length,
     partial:!!spec._partial}, true);

  // A cut-off core reply is handled here, not reported to the operator. The
  // usual cause is the model walking into a repetition at temperature 0, and a
  // fresh sampling slightly warm almost always takes a different path through
  // the same drawing — so it is asked once more, and whichever reading is the
  // more complete is kept. Nobody at the bench needs to know it took two tries.
  if(spec._partial){
    try{
      if(S._csOnProgress) S._csOnProgress(0, 'retry');
      const b=await run(messages, 0.3);
      const again=_csParse(b.reply);
      if(b.cut) again._partial=true;
      // A reading that finished is preferred to one that did not — unless it
      // finished by saying much less. (The count is over distinct entries, so a
      // loop cannot win by repeating the same row.) Whichever is kept, anything
      // it lacks that the other one has is carried across, so the second try
      // never costs a table the first one had.
      const ca=_csCompleteness(again), cs=_csCompleteness(spec);
      const better = (!again._partial && spec._partial && ca >= cs*0.8)
                  || (!!again._partial===!!spec._partial && ca > cs);
      const [keep, other] = better ? [again, spec] : [spec, again];
      ['materials','connectors','segments'].forEach(k=>{
        if(!(Array.isArray(keep[k]) && keep[k].length) && Array.isArray(other[k]) && other[k].length)
          keep[k]=other[k];
      });
      ['drawing_number','drawing_name','project','revision','standard','customer'].forEach(k=>{
        if(!String(keep[k]||'').trim() && String(other[k]||'').trim()) keep[k]=other[k];
      });
      if(better){ spec=again; a=b; }
      logSystemAudit('cut_strip_reply',
        {phase:'core-retry', stop:b.stop, why:b.why, chars:b.reply.length,
         partial:!!again._partial, kept:spec===again}, true);
    }catch(e){ console.warn('[CutStrip] core retry', e.message); }
  }

  // The part list is what the wire count comes from. If it still did not come
  // back, it is asked for on its own — one small table, which cannot run out
  // of room — rather than leaving the sheet without its build instruction.
  if(!(Array.isArray(spec.materials) && spec.materials.length)){
    try{
      if(S._csOnProgress) S._csOnProgress(0, 'bom');
      const bp=_csBomPrompt(lang);
      const bm = isImage
        ? [{role:'user', content:[...imgBlocks, {type:'text', text:bp}]}]
        : [{role:'user', content: bp+'\n\nDRAWING TEXT:\n'+String(text||'').slice(0,24000)}];
      const r=await run(bm);
      const got=(_csSalvageJson(r.reply)||{}).obj;
      const mats=Array.isArray(got?.materials) ? got.materials : [];
      if(mats.length){ spec.materials=mats; }
      logSystemAudit('cut_strip_reply', {phase:'bom', chars:r.reply.length, rows:mats.length}, true);
    }catch(e){ console.warn('[CutStrip] BOM pass', e.message); }
  }

  // Second bite. Its failure is never the analysis's failure: the sheet the
  // bench cuts from is already complete, and a missing wiring table is a gap
  // the engineer can see and fill, not a reason to make them run the whole
  // drawing again.
  try{
    if(S._csOnProgress) S._csOnProgress(0, 'detail');
    const dprompt=_csDetailPrompt(lang, spec);
    const dmsgs = isImage
      ? [{role:'user', content:[...imgBlocks, {type:'text', text:dprompt}]}]
      : [{role:'user', content: dprompt+'\n\nDRAWING TEXT:\n'+String(text||'').slice(0,24000)}];
    const b=await run(dmsgs);
    const det=(_csSalvageJson(b.reply)||{}).obj;
    const added=_csMergeDetail(spec, det);
    if(!added) spec._detail_thin=true;
    logSystemAudit('cut_strip_reply',
      {phase:'detail', stop:b.stop, why:b.why, rounds:b.rounds, chars:b.reply.length, added}, true);
  }catch(e){
    spec._detail_thin=true;
    console.warn('[CutStrip] detail pass', e.message);
  }
  _csNormalize(spec);
  return spec;
}

// A few readings are wrong in ways that can be recognised from the reading
// itself, and are cheaper to put right than to explain on the sheet:
//  - a "cable run" whose cable is really heat-shrink, a sleeve or a label;
//  - terminals at the tips of a fan-out end listed as if they were connectors.
// Nothing here invents data. It only removes what the part list itself says
// is not a cable, or what already appears as a leg of an end.
export const _CS_NOT_CABLE_RE=/\b(tubing|heat[- ]?shrink|shrink|sleeve|label|marker|boot|tape|tie|lacing)\b/i;
export function _csTidyStructure(spec){
  if(!spec) return;
  const mats=Array.isArray(spec.materials)?spec.materials:[];
  const byPn=pn=>mats.find(m=>String(m.part_number||'').trim().toUpperCase()===String(pn||'').trim().toUpperCase());
  if(Array.isArray(spec.segments) && spec.segments.length>1){
    const keep=spec.segments.filter(sg=>{
      const m=byPn(sg.cable_part_number);
      const txt=`${m?.description||''} ${m?.kind||''} ${sg.cable_description||''}`;
      return !(_CS_NOT_CABLE_RE.test(txt) && !_CS_CABLE_RE.test(`${m?.description||''}`));
    });
    if(keep.length && keep.length<spec.segments.length) spec.segments=keep;
  }
  const legTargets=new Set();
  (spec.segments||[]).forEach(sg=>(sg.ends||[]).forEach(e=>_csEndLegs(e).forEach(l=>{
    if(l.to) legTargets.add(String(l.to).trim().toUpperCase()); })));
  if(legTargets.size && Array.isArray(spec.connectors))
    spec.connectors=spec.connectors.filter(c=>!legTargets.has(String(c.ref||'').trim().toUpperCase()));
}
export async function aiAnalyzeCutStrip(text, isImage, imgData, lang){
  if(!_aiReady()) throw new Error(_AI_NO_KEY);
  if(_csDeadProviders.anthropic) throw new Error(_csDeadProviders.anthropic);
  let spec;
  try{ spec=await _csAnthropic(text,isImage,imgData,lang); }
  catch(e){
    if(_csIsKeyError(e.message)) _csDeadProviders.anthropic=e.message;
    throw e;
  }
  // Records which language the prose is written in, so _csP knows when there is
  // nothing to translate and the sheet can be reopened years later without
  // guessing.
  spec.lang = lang || _CS_SOURCE_LANG;
  spec.cut_model = _CS_CUT_MODEL;
  try{ _csTidyStructure(spec); }catch(e){ console.warn('[CutStrip] tidy', e.message); }
  // A drawing rarely dimensions the strip — it belongs to the contact. Rather
  // than hand the bench a blank, propose the ordinary length for the gauge and
  // mark it TBC (see _csProposeStrips).
  try{
    const n=_csProposeStrips(spec);
    if(n) logSystemAudit('cut_strip_proposed_strips',{drawing:spec.drawing_number, count:n}, true);
  }catch(e){ console.warn('[CutStrip] strip proposal', e.message); }
  return spec;
}
