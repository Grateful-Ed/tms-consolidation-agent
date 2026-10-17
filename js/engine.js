/*
 * engine.js — the deterministic planning engine (pre-alpha).
 *
 * Authority split (session rule): THIS file owns every number and every
 * decision. The AI layer (Muse Spark, via the Meta Model API) only phrases
 * language. Nothing in here calls a model.
 *
 * Inputs:  shipments (the ledger), definitions (facility layer + economics),
 *          layer (the user's saved definition layer: answers + taught rules).
 * Output:  loads[] — each with carrier choice, times, costs, declared
 *          assumptions, workings, and a struggle report (possibly empty:
 *          silence is meaningful).
 */
(function (global) {
  'use strict';

  var CUTOFF_HOUR = 17;        // freight ready after 17:00 departs next morning
  var LOAD_HOURS = 1.0;         // dock time to build a consolidated load
  var MORNING_DEPART = 6;       // 06:00 next-day departure after cutoff miss
  var MIN_CHARGE_FACTOR = 0.6;  // split-off partial truck minimum charge

  function parseT(s) { return new Date(s); }
  function fmtT(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function money(n) { return Math.round(n); }

  // Effective definition lookup: user layer answers override facility text.
  // A shipment is "late" when its ready time + load time crosses the cutoff.
  function isLate(s) {
    var ready = parseT(s.readyBy);
    return ready.getHours() + LOAD_HOURS >= CUTOFF_HOUR;
  }

  function userAnswer(layer, key) {
    return layer && layer.answers ? layer.answers[key] : undefined;
  }
  function taught(layer, ruleId) {
    return !!(layer && layer.taught && layer.taught[ruleId]);
  }

  function plan(shipments, defs, layer) {
    layer = layer || {};
    var byLane = {};
    shipments.forEach(function (s) {
      (byLane[s.dest] = byLane[s.dest] || []).push(s);
    });

    var loads = Object.keys(byLane).sort().map(function (dest, idx) {
      return planLane(dest, byLane[dest], defs, layer, idx);
    });
    return { loads: loads };
  }

  function planLane(dest, ships, defs, layer, idx) {
    var lane = defs.lanes[dest];
    var assumptions = [];
    var struggles = [];
    var notable = [];

    // Weights: a missing weight is an ASSUMED weight, declared, never silent.
    var totalWeight = 0;
    ships.forEach(function (s) {
      if (s.weightLb == null) {
        var assumed = s.pallets * defs.economics.defaultPalletWeightLb;
        assumptions.push('S-107 weight missing from the ledger — assumed ' +
          s.pallets + ' pallets × ' + defs.economics.defaultPalletWeightLb +
          ' lb = ' + assumed.toLocaleString() + ' lb.');
        totalWeight += assumed;
      } else { totalWeight += s.weightLb; }
    });

    // Taught rules can split a shipment out of the consolidation.
    var splitOut = [];
    var inLoad = ships.slice();
    var splitRule = null;
    ships.forEach(function (s) {
      var lateSplit = taught(layer, 'split-late-freight') &&
        s.customer === 'Hartline Stores' && isLate(s);
      var mixSplit = taught(layer, 'never-mix-nonstack') &&
        s.stackable === false && ships.length > 1;
      if (lateSplit || mixSplit) {
        splitOut.push(s);
        splitRule = lateSplit ? 'split-late-freight' : 'never-mix-nonstack';
      }
    });
    inLoad = inLoad.filter(function (s) { return splitOut.indexOf(s) === -1; });

    // Departure: after the last in-load freight is ready + load time;
    // past the 17:00 cutoff the load departs next morning.
    var lastReady = inLoad.reduce(function (m, s) {
      return Math.max(m, parseT(s.readyBy).getTime());
    }, 0);
    var depart = new Date(lastReady + LOAD_HOURS * 3600e3);
    if (depart.getHours() >= CUTOFF_HOUR) {
      depart = new Date(depart.getFullYear(), depart.getMonth(), depart.getDate() + 1, MORNING_DEPART, 0);
    }
    var arrive = new Date(depart.getTime() + lane.driveHours * 3600e3);

    // Carrier choice: cheapest-that-holds. Expected total = freight +
    // (miss probability × sum of customers' failure costs on the load).
    var failureBase = inLoad.reduce(function (sum, s) {
      var c = defs.customers[s.customer];
      return sum + c.lateFeePerOccurrence + c.serviceFailureCost;
    }, 0);
    var options = defs.carriers.map(function (c) {
      var freight = c.ratePerMile * lane.miles;
      var expectedFailure = (1 - c.onTimePct / 100) * failureBase;
      return { carrier: c, freight: money(freight), expectedFailure: money(expectedFailure), total: money(freight + expectedFailure) };
    });
    options.sort(function (a, b) { return a.total - b.total; });
    var chosen = options[0];
    var cheapest = options.slice().sort(function (a, b) { return a.freight - b.freight; })[0];

    // The user's cheap-vs-safe preference, where they set one, is honored —
    // and shown. A preference that picks the riskier carrier raises a flag
    // with the expected failure cost attached (the plan obeys; it does not
    // hide what the obedience costs).
    var pref = userAnswer(layer, 'cheapVsSafe');
    if (pref === 'cheap' && cheapest.carrier.id !== chosen.carrier.id) {
      struggles.push({
        id: 'pref-cheap-' + dest, kind: 'preference-risk', teachable: false,
        dollars: cheapest.expectedFailure,
        title: 'Your “cheapest first” preference picked ' + cheapest.carrier.name,
        detail: cheapest.carrier.name + ' is $' + (chosen.freight - cheapest.freight) +
          ' cheaper on freight, but its expected failure cost on this load is $' +
          cheapest.expectedFailure + ' against ' + chosen.carrier.name + '’s $' +
          chosen.expectedFailure + '. The plan follows your preference — the risk rides with it.',
        cites: ['hartline-worth']
      });
      chosen = cheapest;
    }
    if (chosen.carrier.id !== cheapest.carrier.id) {
      notable.push('Cheapest freight was ' + cheapest.carrier.name + ' at $' + cheapest.freight +
        '. Cheapest-that-holds is ' + chosen.carrier.name + ' at $' + chosen.total +
        ' expected total ($' + chosen.freight + ' freight + $' + chosen.expectedFailure +
        ' expected failure cost), against ' + cheapest.carrier.name + '’s $' + cheapest.total + '.');
    }

    // Struggle 1: appointment breach under the customer's on-time
    // definition — reported once per load, against the earliest affected
    // appointment (one load, one breach, however many shipments it carries).
    var hartlineInLoad = inLoad.filter(function (s) { return s.customer === 'Hartline Stores'; });
    if (hartlineInLoad.length && userAnswer(layer, 'ontimeHartline') !== 'day') {
      var cust = defs.customers['Hartline Stores'];
      var appt = hartlineInLoad.reduce(function (m, s) {
        return Math.min(m, parseT(s.appointment).getTime());
      }, Infinity);
      appt = new Date(appt);
      if (arrive > appt) {
        var lateHrs = Math.max(1, Math.ceil((arrive - appt) / 3600e3));
        var lateIds = inLoad.filter(isLate).map(function (x) { return x.id; });
        var dollars = cust.lateFeePerOccurrence +
          defs.economics.detentionPerHour * lateHrs +
          (cust.anchor ? Math.round(cust.serviceFailureCost * 0.25) : 0);
        struggles.push({
          id: 'appt-' + dest, kind: 'appointment-breach', teachable: true,
          teachRule: 'split-late-freight',
          dollars: dollars,
          title: 'Consolidating puts Hartline past their appointment',
          detail: 'This load arrives ' + fmtT(arrive) + '; Hartline’s appointment is ' +
            fmtT(appt) + '. The late freight (' + lateIds.join(', ') +
            ') misses the 17:00 cutoff and pushes the whole load to a next-morning departure. Cost of the breach: $' +
            cust.lateFeePerOccurrence + ' late fee + $' + (defs.economics.detentionPerHour * lateHrs) +
            ' detention (1 hr) + $' + (cust.anchor ? Math.round(cust.serviceFailureCost * 0.25) : 0) +
            ' service-risk provision on the anchor account. Splitting the late freight onto its own truck would cost about $' +
            money(chosen.carrier.ratePerMile * lane.miles * MIN_CHARGE_FACTOR) + ' instead.',
          cites: ['ontime-hartline', 'hartline-worth']
        });
      }
    }

    // Struggle 2: non-stackable freight mixed into a consolidated load.
    var nonStack = inLoad.filter(function (s) { return s.stackable === false; });
    var userSaysStacks = userAnswer(layer, 'stackHartline') === 'can-stack';
    if (nonStack.length && inLoad.length > 1 && !userSaysStacks) {
      var pallets = nonStack.reduce(function (n, s) { return n + s.pallets; }, 0);
      struggles.push({
        id: 'stack-' + dest, kind: 'stackability', teachable: true,
        teachRule: 'never-mix-nonstack',
        dollars: defs.economics.damageRiskPerNonStackPallet * pallets,
        title: 'Non-stackable freight rides in a mixed load',
        detail: nonStack.map(function (s) { return s.id; }).join(', ') + ' (' + pallets +
          ' pallets) cannot take weight on top. The facility rule allows the mix only if it rides on top, alone — one dock mistake from $' +
          (defs.economics.damageRiskPerNonStackPallet * pallets) + ' in expected damage (' +
          pallets + ' pallets × $' + defs.economics.damageRiskPerNonStackPallet + ').',
        cites: ['stack-rule']
      });
    }

    struggles.sort(function (a, b) { return b.dollars - a.dollars; });

    var splitCost = splitOut.length
      ? money(chosen.carrier.ratePerMile * lane.miles * MIN_CHARGE_FACTOR)
      : 0;

    return {
      id: 'L' + (idx + 1), lane: dest,
      shipmentIds: inLoad.map(function (s) { return s.id; }),
      splitOutIds: splitOut.map(function (s) { return s.id; }),
      splitRule: splitRule, splitCost: splitCost,
      carrier: chosen.carrier, freightCost: chosen.freight,
      expectedFailure: chosen.expectedFailure, expectedTotal: chosen.total + splitCost,
      departAt: depart.toISOString(), arriveAt: arrive.toISOString(),
      arriveText: fmtT(arrive), departText: fmtT(depart),
      totalWeight: totalWeight,
      totalPallets: inLoad.reduce(function (n, s) { return n + s.pallets; }, 0),
      assumptions: assumptions, struggles: struggles, notable: notable,
      carrierOptions: options.map(function (o) {
        return { name: o.carrier.name, freight: o.freight, expectedFailure: o.expectedFailure, total: o.total };
      })
    };
  }

  var api = { plan: plan };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  global.TMSEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
