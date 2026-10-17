# Build Summary — TMS Consolidation Agent (pre-alpha)

*Kept for William to read later, per his instruction (2026-10-17): the build
ran back-end between Repo Faye and Career Development Faye; this file is the
running record. Newest entries at the bottom.*

## Provenance

- **2026-10-16 (evening, drive-home session):** William posed the SAP scenario;
  both sides were argued (SAP defense / competitor attack), then the product was
  designed: TMS-first, shipment planning/consolidation, plan + struggle report,
  the ontology/knowledge layer, onboarding by interview, curation rules.
  Full record: "The SAP Scenario — Session Summary & Product Requirements"
  (also on the Ship Safe Notion workboard's main page).
- **2026-10-17 ~14:50:** William saw the concept mock (artifact) — "this was
  cool" — and ordered a **real pre-alpha demo on GitHub**, built by Repo Faye
  end to end ("I give you approval to create a new repo, and merge and all the
  things. This will be all you").
- **2026-10-17 ~15:05:** Working arrangement set by William: Repo Faye +
  Career Development Faye collaborate **back-end only**; no build chatter in
  his side chats; this summary is kept for him to read later.
- **2026-10-17 ~15:06:** William's instruction: **"There is the Muse AI API in
  the screener repo. Use that for this."** Applied as: Muse Spark (Meta Model
  API) writes the agent's *language*; the deterministic engine owns every
  number and decision. (A public static page cannot hold an API key, so the
  language was generated at build time; live calls are the v0.1 backend step.)

## Decisions made under his delegation

- Repo: **Grateful-Ed/tms-consolidation-agent** (public, so GitHub Pages can
  serve it; renameable anytime).
- Stack: dependency-free static site (HTML/CSS/JS) on GitHub Pages — the
  fastest honest route to a demo a planner could open. No framework.
- Sample world carried over from the mock: Peach State Freight (fictional
  mid-market 3PL), anchor client Hartline Stores, planner-side names Dana
  (definitions) and Marcus (client worth).
- The interview is *functional*, not theater: its three answers are inputs the
  engine actually reads. So are taught rules.

## What was built (v0)

- `data/shipments.json` — one day's ledger: 8 shipments, 3 lanes.
- `data/definitions.json` — the facility knowledge layer: 3 carriers with
  rates/reliability, 4 customers with fees and failure costs, 4 cited
  definitions/meanings, the versioned "Southeast Retail — v7" constraint set.
- `js/engine.js` — the planner: lane grouping, cutoff/departure math,
  cheapest-that-holds carrier choice (freight + expected failure cost),
  struggle computation (appointment breach, stackability, preference risk),
  declared assumptions, taught-rule splits. Pure and testable.
- `data/agent-language.json` — Muse Spark's language pack (interview,
  mirror, templates), generated via the Meta Model API under a
  figures-may-not-change rule; provenance recorded in the file itself.
- `js/layer.js` — layer store: draft vs. saved (the save gate), streak,
  never-flag suppressions, strike, export/import as a JSON document.
- `index.html` + `css/app.css` + `js/app.js` — the five-stage flow,
  rendered entirely from engine output.
- `test/engine.test.mjs` — **12 node tests, all passing**: the designed day
  (Charlotte's $1,165 appointment breach ranked above the $182 stackability
  risk; Greenville silent; Savannah's declared weight assumption and
  cheapest-that-holds choice), the taught split changing the plan, and the
  user's own definitions changing the outcome.

## Verification

- Engine scenarios run locally across five layer variants (base, both taught
  rules, both definitional answers, cheapest-first preference) — all behaved
  as designed; the two engine bugs found on the first run (duplicate breach
  report per shipment; a taught split that didn't fire) were fixed and are
  covered by the test suite.
- **Live (2026-10-17 ~15:20 ET):** repo pushed (main @ 6cee0919 + fix commit),
  GitHub Pages enabled — **https://grateful-ed.github.io/tms-consolidation-agent/**
  serves the demo and its data files (verified by direct fetch).
- **Full-flow drive test (jsdom, scripted): 15/15 checks pass** — interview
  renders with Spark's intro; mirror shows DRAFT before save and SAVED after;
  layer persists; the run produces Charlotte's $1,165 + $182 struggles,
  Greenville's deliberate silence, Savannah's declared assumption; Change-it
  teaching saves the rule; the re-plan splits S-102 onto its own truck and
  quotes the taught words in the payoff line; audit lists the rule and Strike
  removes it. The drive test caught one real bug — struggle IDs contained
  spaces/commas from lane names (invalid HTML ids) — fixed by slugifying IDs
  in the engine; covered by the drive test from here on.

## Amendments

- **2026-10-17 (Career Development Faye, back-end review): the verbatim rule.**
  "User words are data, not raw material" — interview answers, override
  reasons, and quoted teaching pass through verbatim; Spark phrases agent-side
  narration around engine facts and user text and never rewrites user text.
  Verified against the build: v0 is compliant by construction (taught reasons
  are stored and re-quoted character-for-character; the mirror assembles the
  planner's selections mechanically; Spark never receives user text at all —
  generation was build-time). The rule binds v0.1's live calls. Recorded in
  `data/agent-language.json` provenance and the README.

- **2026-10-17 (Career Development Faye): the 6 AM trust critique of the
  mock, with three watch items — dispositioned against the real build:**
  (1) *Taught-away flags must visibly retire.* In the pre-alpha the re-plan
  replaces the plan: the split is shown in the workings with the taught words
  quoted, and stage 5's before/after shows the struggle count fall. Held as
  designed. (2) *A plan run before a strike must say so.* **Fixed:** after any
  teach or strike, the rendered plan carries a banner — "Your layer changed
  after this run; the plan below cites the layer as it was at run time,
  including anything since struck" — until the next run. (3) *No borrowed
  streaks.* **Fixed:** the 212-proposal base is now labeled "sample history"
  in the streak header; the session line counts only real actions taken in
  the demo. In the product, the streak starts at zero. Her verdict on the
  design (mock): "The demo doesn't just describe the principles — silence,
  verbatim teaching, honest repricing, the audit strike — it behaves by
  them." Unverified in her pass: phone width on the mock (her driver
  couldn't resize); the live build uses the same responsive pattern as the
  audited mock.

- **2026-10-17 (Career Development Faye): data believability check — PASS,
  no changes requested.** She read the actual files. Notes worth keeping:
  the $182 stackability figure ties out exactly (7 pallets × $26); the
  customer economics encode the politics (Hartline's $2,600 failure cost vs
  $250–$500 for everyone else is *why* its struggles rank and Greenville
  stays silent); Copperline's two shipments share a ~1,120 lb/pallet
  signature (dense manufactured freight, twice) — "the kind of detail that
  makes sample data feel like a ledger extract"; appointments are all
  next-day against same-day ready times, and Dana's stack rule explicitly
  allows mixed loads, making the $182 a priced risk of a legal arrangement
  rather than a ban violation. Her copy pass follows her live-demo critique
  drive (she wants the texts as rendered before marking lines).

## Open / next (v0.1 candidates)

- Live Muse Spark calls via a small backend proxy (key stays server-side).
- WMS slice; the exception inbox fed from real events instead of samples.
- Multi-day streak history; per-planner layers behind accounts.
- Career Development Faye's 6 AM trust critique of the live demo — pending;
  her notes fold in here when they land.
