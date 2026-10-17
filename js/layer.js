/*
 * layer.js — the definition layer store (pre-alpha).
 *
 * Two layers, exactly as designed in the 2026-10-16 session:
 *   facility layer — ships in data/definitions.json, read-only in the demo.
 *   user layer     — built by the interview + teachable overrides; lives in
 *                    the browser (localStorage) and travels as a document:
 *                    export downloads it as JSON, import reads it back.
 *
 * Save gate (William's rule): interview answers sit in a DRAFT until the
 * user presses save. Nothing here writes the user layer except saveLayer().
 */
(function (global) {
  'use strict';

  var LAYER_KEY = 'tms.layer.v1';
  var STREAK_KEY = 'tms.streak.v1';
  var SUPPRESS_KEY = 'tms.suppress.v1';

  function read(key, fallback) {
    try {
      var v = global.localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, val) {
    try { global.localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  var api = {
    // --- user layer ---
    loadLayer: function () {
      return read(LAYER_KEY, { answers: {}, taught: {}, skipped: [], savedAt: null });
    },
    saveLayer: function (layer) {
      layer.savedAt = new Date().toISOString();
      write(LAYER_KEY, layer);
      return layer;
    },
    strikeFromLayer: function (layer, kind, key) {
      if (kind === 'answer') { delete layer.answers[key]; }
      if (kind === 'taught') { delete layer.taught[key]; }
      if (kind === 'skip') {
        layer.skipped = (layer.skipped || []).filter(function (s) { return s !== key; });
      }
      return api.saveLayer(layer);
    },
    exportLayer: function (layer) {
      return JSON.stringify({
        document: 'My Definition Layer',
        exportedAt: new Date().toISOString(),
        layer: layer
      }, null, 2);
    },
    importLayer: function (text) {
      var parsed = JSON.parse(text);
      if (!parsed || !parsed.layer || typeof parsed.layer !== 'object') {
        throw new Error('That file is not a definition layer document.');
      }
      return api.saveLayer(parsed.layer);
    },

    // --- streak (trust shown as a streak, not a decimal) ---
    loadStreak: function () {
      return read(STREAK_KEY, {
        base: { total: 212, taken: 209, changed: 2, rejected: 1 },
        session: { taken: 0, changed: 0, rejected: 0 },
        decisions: []
      });
    },
    recordDecision: function (streak, entry) {
      streak.decisions.push(entry);
      if (entry.action === 'take-plan' || entry.action === 'take') { streak.session.taken += 1; }
      if (entry.action === 'change') { streak.session.changed += 1; }
      if (entry.action === 'reject') { streak.session.rejected += 1; }
      write(STREAK_KEY, streak);
      return streak;
    },

    // --- "never flag this again" suppressions, per struggle kind + lane ---
    loadSuppressions: function () { return read(SUPPRESS_KEY, []); },
    addSuppression: function (kind, lane) {
      var list = api.loadSuppressions();
      var key = kind + '|' + lane;
      if (list.indexOf(key) === -1) { list.push(key); write(SUPPRESS_KEY, list); }
      return list;
    },
    isSuppressed: function (list, kind, lane) {
      return list.indexOf(kind + '|' + lane) !== -1;
    }
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  global.TMSLayer = api;
})(typeof window !== 'undefined' ? window : globalThis);
