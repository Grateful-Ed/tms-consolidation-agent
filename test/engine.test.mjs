// Engine tests — run: node test/engine.test.mjs
// The engine is the authority for every number in the demo; these tests pin
// the behavior the 2026-10-16 session designed.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const engine = require('../js/engine.js');

const ships = JSON.parse(readFileSync(new URL('../data/shipments.json', import.meta.url))).shipments;
const defs = JSON.parse(readFileSync(new URL('../data/definitions.json', import.meta.url)));

let failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) failures += 1;
}
const byLane = (loads, lane) => loads.find(l => l.lane === lane);

// Base layer: the designed day.
{
  const { loads } = engine.plan(ships, defs, {});
  const cha = byLane(loads, 'Charlotte, NC');
  const gre = byLane(loads, 'Greenville, SC');
  const sav = byLane(loads, 'Savannah, GA');
  check('three lane loads', loads.length === 3);
  check('Charlotte top struggle is the $1,165 appointment breach',
    cha.struggles[0].kind === 'appointment-breach' && cha.struggles[0].dollars === 1165);
  check('Charlotte second struggle is the $182 stackability risk',
    cha.struggles[1].kind === 'stackability' && cha.struggles[1].dollars === 182);
  check('struggles are ranked in dollars', cha.struggles[0].dollars >= cha.struggles[1].dollars);
  check('Greenville is clean — silence is meaningful', gre.struggles.length === 0);
  check('Savannah declares the assumed weight for S-107',
    sav.assumptions.length === 1 && sav.assumptions[0].includes('S-107'));
  check('Savannah picks Meridian (cheapest-that-holds), not ValueHaul',
    sav.carrier.name === 'Meridian Freight' && sav.notable.length === 1);
}

// Taught rule: split the late freight — the plan itself changes.
{
  const { loads } = engine.plan(ships, defs, { taught: { 'split-late-freight': { text: 'x' } } });
  const cha = byLane(loads, 'Charlotte, NC');
  check('taught split removes S-102 from the Charlotte load',
    !cha.shipmentIds.includes('S-102') && cha.splitOutIds.includes('S-102'));
  check('taught split clears the original two struggles',
    !cha.struggles.some(s => s.kind === 'appointment-breach') &&
    !cha.struggles.some(s => s.kind === 'stackability'));
  check('the split has a visible price and a stated basis',
    cha.splitCost === 419 && /60% of a full/.test(cha.splitBasis || ''));
  // The split protects the rest of the load; it cannot fix S-102's own
  // clock (still 10:30 vs a 10:00 appointment) — reported, not absorbed.
  check('the split-off shipment still breaches, and the engine says so',
    cha.struggles.length === 1 && cha.struggles[0].kind === 'split-residual' &&
    cha.struggles[0].dollars === 1165 && cha.splitArriveText === '10:30');
}

// A taught rule whose words forbid splitting blocks the remedy — visibly.
{
  const { loads } = engine.plan(ships, defs, {
    taught: { 'split-late-freight': { text: 'Hartline loads never split across two trailers — receiving counts pallets per trailer.' } }
  });
  const cha = byLane(loads, 'Charlotte, NC');
  check('never-split rule keeps S-102 in the load',
    cha.shipmentIds.includes('S-102') && cha.splitOutIds.length === 0);
  check('the blocked remedy is confessed on the card',
    cha.struggles.some(s => s.kind === 'rule-conflict') &&
    cha.struggles.some(s => s.kind === 'appointment-breach'));
}

// The user's own definitions change the plan (the ontology is real, not set dressing).
{
  const { loads } = engine.plan(ships, defs, { answers: { ontimeHartline: 'day' } });
  const cha = byLane(loads, 'Charlotte, NC');
  check('if on-time means the day, there is no appointment breach',
    !cha.struggles.some(s => s.kind === 'appointment-breach'));
}
{
  const { loads } = engine.plan(ships, defs, { answers: { cheapVsSafe: 'cheap' } });
  const sav = byLane(loads, 'Savannah, GA');
  check('cheapest-first preference is honored — and flagged with its expected cost',
    sav.carrier.name === 'ValueHaul' &&
    sav.struggles.some(s => s.kind === 'preference-risk' && s.dollars === 646));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
