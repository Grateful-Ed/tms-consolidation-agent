# TMS Consolidation Agent — Pre-Alpha Demo

A working pre-alpha of the product designed in the **2026-10-16 session**
(William Harris + Repo Faye + Career Development Faye): a TMS shipment-planning
agent for a mid-market 3PL that **proposes** consolidations and **reports its
struggles** — and never makes a plan official.

**Live demo:** https://grateful-ed.github.io/tms-consolidation-agent/

## The one idea

Existing optimizers hand a planner a plan. This agent hands the planner a plan
**plus a struggle report**: what it couldn't satisfy, what it traded off, what it
assumed — each struggle priced in dollars and cited to the definition it rests
on. Silence is allowed and meaningful: a clean load says nothing, so when the
agent does speak, it counts.

## How it works (the five stages on the page)

1. **Onboarding interview.** Before planning, the agent interviews the planner
   (three questions here) about their working definitions. It mirrors back what
   it heard in first person, flags where the planner differs from the facility
   default, and **saves nothing until the planner says save** — drafts are
   labeled drafts.
2. **The planning desk.** The day's freight (the ledger) next to the
   **definitions in force** — every meaning carries its author and date.
3. **The run.** The deterministic engine groups the freight by lane, picks a
   carrier by **cheapest-that-holds** (freight + expected failure cost +
   client-retention value), and emits each load with its workings, its declared
   assumptions, and its struggle report, struggles ranked in dollars.
4. **Decisions.** Per struggle: **Take it** (accepted risk, documented — the
   planner's alibi), **Change it** (the planner teaches a rule in their own
   words; it is remembered per context), **Never flag this again** (the
   suppression itself goes on the record). Taking a plan marks it
   *Approved by you — not official*. Reliability is displayed as a **streak**,
   never a bare percentage.
5. **The loop.** Teaching changes the layer; re-running visibly changes the
   plan, with the payoff line quoting the taught words. The layer is
   **auditable**: everything saved can be inspected and struck, and it travels
   as a document (export/import JSON).

## Architecture (mirrors the design on purpose)

| Layer | File | Rule |
|---|---|---|
| Ledger | `data/shipments.json` | The record. The agent never writes to it. |
| Knowledge layer ("ontology") | `data/definitions.json` + the user layer | Entities, definitions, and meanings — each with author + date. The agent reasons over these and cites them. |
| Engine | `js/engine.js` | Deterministic. Owns **every number and every decision**. No model calls. |
| Agent language | `data/agent-language.json` | Written by **Muse Spark** via the Meta Model API (the same API the Ship Safe screener uses), under a standing rule: the model phrases; figures may not change. Tokens like `{{dollars}}` are filled from engine output. |
| Layer store | `js/layer.js` | Draft vs. saved states, the save gate, streak, suppressions, export/import. |
| UI | `index.html`, `css/app.css`, `js/app.js` | Renders engine output. Contains no planning logic. |

The user's answers genuinely steer the engine: tell it on-time means "the day"
and the appointment breach disappears; prefer cheapest-first and it obeys — and
flags the expected failure cost of your preference. Teach it to split late
Hartline freight and the re-plan does exactly that, at a visible price.

## Run it locally

```sh
python3 -m http.server 8902   # file:// blocks the data fetches
# open http://localhost:8902
```

## Tests

```sh
node test/engine.test.mjs     # 12 checks pinning the designed behavior
```

## Status & known limits (pre-alpha honesty)

- Sample data is fictional (Peach State Freight; anchor client Hartline Stores).
- The exception inbox (stage 5) is illustrative surface; in a real build its
  items come from the ledger and dock systems.
- Muse Spark's language was generated at build time. A public static page
  cannot hold an API key, so live per-user model calls are the **v0.1 step**
  (a small backend proxy), not a missing feature.
- The user layer persists in the browser (localStorage) and as an exported
  JSON document. No accounts, no server, nothing leaves the browser.

Design record: `docs/BUILD-SUMMARY.md` (running build log) and the session
summary + requirements R1–R43 (kept with the project's records).
