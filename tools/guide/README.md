# User guide — how it is built and kept current

The Hebrew user guide has **one source**: `web/guide/content.json` (+ screenshots in
`web/guide/img/`). From it:

- the app shows it on the **📘 User Guide** screen (`web/js/features/guide.js`);
- `node tools/build-guide-docx.js` writes `docs/user-guide/SpecPrice-User-Guide.docx`.

## Rule: every change to a screen updates the guide

When a button, field, flow or message changes:

1. Edit the matching chapter in `web/guide/content.json` (block format: see the top of
   `web/js/features/guide.js`). Bump `"version"` to the release number.
2. If the screen looks different, re-take its screenshot (below). The numbered red markers
   in a screenshot must match the order of that image's `callouts` list.
3. `node tools/build-guide-docx.js` to regenerate the Word file.
4. `node tests/guide-check.js` — every image exists, no unused images, ids unique.

## Re-taking screenshots

Demo data only (Demo Cables Ltd., DEMO-… drawings) — never real customer data.

```bash
cd web && python -m http.server 8820 --bind 127.0.0.1     # serve the app (needs web/index.html)
cd tools/guide
npm i playwright            # once, or set NODE_PATH to an existing install
node shots-1-login-database.js    # 01–09
node shots-2-sales-desk.js        # 10–19
node shots-3-cut-strip.js         # 20–33 (also writes .specs-db.json for script 4)
node shots-4-mfg-settings-admin.js# 34–51
node shots-5-guide.js             # 52
python shrink_images.py           # optional: 256-colour PNGs, ~60% smaller
```

`lib.js` holds the demo data, the mocked AI replies and the `mark()` helper that draws
the numbered markers.
