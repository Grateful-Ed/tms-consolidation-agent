/*
 * layer.js — the definition layer store (pre-alpha v0.2: multi-user).
 *
 * Two layers, exactly as designed in the 2026-10-16 session:
 *   facility layer — ships in data/definitions.json, read-only in the demo.
 *   user layer     — built by the interview + teachable overrides; lives in
 *                    the browser (localStorage) and travels as a document.
 *
 * Multi-user (William's request, 2026-10-17): the demo supports several
 * USERS (profiles) in one browser. Each user has their own layer, streak,
 * and suppressions — their own interview, their own teaching. Switching
 * users switches everything. Storage keys are per-profile; the pre-profile
 * single-user data is adopted into the first profile on first load.
 *
 * Save gate (William's rule): interview answers sit in a DRAFT until the
 * user presses save. Nothing here writes a user layer except saveLayer().
 */
(function (global) {
  'use strict';

  var PROFILES_KEY = 'tms.profiles.v2';
  var OLD = { layer: 'tms.layer.v1', streak: 'tms.streak.v1', suppress: 'tms.suppress.v1' };

  function read(key, fallback) {
    try {
      var v = global.localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, val) {
    try { global.localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function remove(key) { try { global.localStorage.removeItem(key); } catch (e) {} }

  function keyFor(kind, profileId) { return 'tms.p.' + profileId + '.' + kind; }

  function loadProfiles() {
    var store = read(PROFILES_KEY, null);
    if (store && store.profiles && store.profiles.length) return store;
    // First run: create the first profile, adopting any pre-profile data.
    var first = { id: 'u1', name: 'Planner 1', createdAt: new Date().toISOString() };
    store = { activeId: 'u1', profiles: [first] };
    write(PROFILES_KEY, store);
    [['layer', OLD.layer], ['streak', OLD.streak], ['suppress', OLD.suppress]].forEach(function (pair) {
      var old = global.localStorage.getItem(pair[0] === 'layer' ? OLD.layer : pair[0] === 'streak' ? OLD.streak : OLD.suppress);
      if (old != null && global.localStorage.getItem(keyFor(pair[0], 'u1')) == null) {
        try { global.localStorage.setItem(keyFor(pair[0], 'u1'), old); } catch (e) {}
      }
    });
    return store;
  }
  function saveProfiles(store) { write(PROFILES_KEY, store); }

  var api = {
    // --- profiles ---
    profiles: function () { return loadProfiles(); },
    activeProfile: function () {
      var s = loadProfiles();
      return s.profiles.filter(function (p) { return p.id === s.activeId; })[0] || s.profiles[0];
    },
    createProfile: function (name) {
      var s = loadProfiles();
      var id = 'u' + Date.now().toString(36);
      var p = { id: id, name: name || ('Planner ' + (s.profiles.length + 1)), createdAt: new Date().toISOString() };
      s.profiles.push(p);
      s.activeId = id;
      saveProfiles(s);
      return p;
    },
    switchProfile: function (id) {
      var s = loadProfiles();
      if (s.profiles.some(function (p) { return p.id === id; })) { s.activeId = id; saveProfiles(s); }
      return api.activeProfile();
    },
    renameProfile: function (id, name) {
      var s = loadProfiles();
      s.profiles.forEach(function (p) { if (p.id === id && name) p.name = name; });
      saveProfiles(s);
    },
    deleteProfile: function (id) {
      var s = loadProfiles();
      if (s.profiles.length <= 1) return false;
      s.profiles = s.profiles.filter(function (p) { return p.id !== id; });
      remove(keyFor('layer', id)); remove(keyFor('streak', id)); remove(keyFor('suppress', id));
      if (s.activeId === id) s.activeId = s.profiles[0].id;
      saveProfiles(s);
      return true;
    },

    // --- user layer (active profile) ---
    loadLayer: function () {
      var d = read(keyFor('layer', api.activeProfile().id),
        { answers: {}, taught: {}, notes: [], skipped: [], savedAt: null });
      if (!d.notes) d.notes = [];
      return d;
    },
    saveLayer: function (layer) {
      layer.savedAt = new Date().toISOString();
      write(keyFor('layer', api.activeProfile().id), layer);
      return layer;
    },
    strikeFromLayer: function (layer, kind, key) {
      if (kind === 'answer') { delete layer.answers[key]; }
      if (kind === 'taught') { delete layer.taught[key]; }
      if (kind === 'note') { layer.notes = (layer.notes || []).filter(function (n, i) { return String(i) !== String(key); }); }
      if (kind === 'skip') {
        layer.skipped = (layer.skipped || []).filter(function (s) { return s !== key; });
      }
      return api.saveLayer(layer);
    },
    exportLayer: function (layer) {
      return JSON.stringify({
        document: 'My Definition Layer',
        user: api.activeProfile().name,
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

    // --- streak (active profile) ---
    loadStreak: function () {
      return read(keyFor('streak', api.activeProfile().id), {
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
      write(keyFor('streak', api.activeProfile().id), streak);
      return streak;
    },

    // --- "never flag this again" suppressions (active profile) ---
    loadSuppressions: function () { return read(keyFor('suppress', api.activeProfile().id), []); },
    addSuppression: function (kind, lane) {
      var list = api.loadSuppressions();
      var key = kind + '|' + lane;
      if (list.indexOf(key) === -1) { list.push(key); write(keyFor('suppress', api.activeProfile().id), list); }
      return list;
    },
    isSuppressed: function (list, kind, lane) {
      return list.indexOf(kind + '|' + lane) !== -1;
    }
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  global.TMSLayer = api;
})(typeof window !== 'undefined' ? window : globalThis);
