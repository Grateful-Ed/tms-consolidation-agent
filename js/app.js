/*
 * app.js — UI wiring for the five-stage flow.
 * All numbers come from TMSEngine; all persistence from TMSLayer;
 * the agent's sentences come from data/agent-language.json (Muse Spark).
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var FACILITY_DEFAULTS = { ontimeHartline: 'appointment', stackHartline: 'no-stack', cheapVsSafe: 'safe' };
  var MIRROR_PREFIX = {
    ontimeHartline: 'For me, on-time for Hartline means ',
    stackHartline: 'For me, S-102: ',
    cheapVsSafe: 'For me, when cheap fights safe on the anchor client: '
  };
  var CITE_LABELS = {
    'ontime-hartline': 'On-time, Hartline — Dana, Mar 12',
    'hartline-worth': 'What Hartline is worth — Marcus, Jan 8',
    'stack-rule': 'Stacking rule — Dana, Mar 12'
  };

  var S = {
    defs: null, lang: null, ships: null,
    layer: TMSLayer.loadLayer(),
    draft: null,           // {answers:{}, skipped:[]} while interviewing
    plan: null,            // last engine result (stage 3)
    planStale: false,      // layer changed after the run (Career Faye's leak #2)
    planLayerSnapshot: null,
    resolved: {},          // struggleId -> {action, text}
    streak: TMSLayer.loadStreak(),
    suppressions: TMSLayer.loadSuppressions()
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fill(tpl, map) {
    return tpl.replace(/\{\{(\w+)\}\}/g, function (m, k) { return map[k] != null ? map[k] : m; });
  }
  function lowerFirst(s) { return s.charAt(0).toLowerCase() + s.slice(1); }
  function mirrorLine(qid, value) {
    var q = S.lang.questions.filter(function (x) { return x.id === qid; })[0];
    var opt = q.options.filter(function (o) { return o.value === value; })[0];
    return MIRROR_PREFIX[qid] + lowerFirst(opt.sub);
  }
  function deltas(answers) {
    var out = [];
    Object.keys(answers).forEach(function (qid) {
      if (FACILITY_DEFAULTS[qid] && answers[qid] !== FACILITY_DEFAULTS[qid]) {
        out.push({ qid: qid, text: mirrorLine(qid, answers[qid]) });
      }
    });
    return out;
  }

  /* ---------- Stage 1: interview + mirror ---------- */

  function renderInterview() {
    var box = $('interviewBox'), mir = $('mirrorBox');
    mir.innerHTML = '';
    var hasSaved = S.layer.savedAt && (Object.keys(S.layer.answers).length || Object.keys(S.layer.taught).length || (S.layer.skipped || []).length);
    if (hasSaved) {
      box.innerHTML = '<p>' + esc(S.lang.interviewIntro) + '</p>' +
        '<p class="stage-note">You have a saved definition layer from ' +
        esc(new Date(S.layer.savedAt).toLocaleString()) +
        '. It is in force below. <button class="ghost" id="reInterviewBtn">Re-do the interview</button></p>';
      $('reInterviewBtn').onclick = function () {
        S.draft = { answers: {}, skipped: [] };
        renderQuestions();
      };
      renderMirror(S.layer, true);
      return;
    }
    if (!S.draft) S.draft = { answers: {}, skipped: [] };
    renderQuestions();
  }

  function renderQuestions() {
    var box = $('interviewBox');
    var html = '<p>' + esc(S.lang.interviewIntro) + '</p>';
    S.lang.questions.forEach(function (q) {
      var picked = S.draft.answers[q.id];
      var skipped = S.draft.skipped.indexOf(q.id) !== -1;
      html += '<div class="q"><p>' + esc(q.ask) + '</p><div class="opts">';
      q.options.forEach(function (o) {
        html += '<button class="opt' + (picked === o.value ? ' picked' : '') + '" data-q="' + q.id + '" data-v="' + esc(o.value) + '">' +
          '<b>' + esc(o.label) + '</b><span>' + esc(o.sub) + '</span></button>';
      });
      html += '</div>';
      if (skipped) { html += '<p class="stage-note">Skipped — the facility default applies, and the skip is on the record.</p>'; }
      else if (!picked) { html += '<button class="skip" data-skip="' + q.id + '">Skip this one</button>'; }
      html += '</div>';
    });
    var done = S.lang.questions.every(function (q) {
      return S.draft.answers[q.id] || S.draft.skipped.indexOf(q.id) !== -1;
    });
    if (done) {
      html += '<p>' + esc(S.lang.landingLine) + '</p>' +
        '<button class="save" id="showMirrorBtn">Show me what you heard</button>';
    }
    box.innerHTML = html;
    box.querySelectorAll('.opt').forEach(function (b) {
      b.onclick = function () {
        S.draft.answers[b.dataset.q] = b.dataset.v;
        S.draft.skipped = S.draft.skipped.filter(function (s) { return s !== b.dataset.q; });
        renderQuestions();
      };
    });
    box.querySelectorAll('[data-skip]').forEach(function (b) {
      b.onclick = function () {
        delete S.draft.answers[b.dataset.skip];
        if (S.draft.skipped.indexOf(b.dataset.skip) === -1) S.draft.skipped.push(b.dataset.skip);
        renderQuestions();
      };
    });
    var sm = $('showMirrorBtn');
    if (sm) sm.onclick = function () { renderMirror({ answers: S.draft.answers, skipped: S.draft.skipped, taught: {} }, false); };
  }

  function renderMirror(layerLike, isSaved) {
    var mir = $('mirrorBox');
    var lines = Object.keys(layerLike.answers || {}).map(function (qid) {
      return '<li>' + esc(mirrorLine(qid, layerLike.answers[qid])) + '</li>';
    });
    (layerLike.skipped || []).forEach(function (qid) {
      lines.push('<li><i>Skipped — the facility default applies.</i></li>');
    });
    Object.keys(layerLike.taught || {}).forEach(function (rid) {
      lines.push('<li>Taught: “' + esc(layerLike.taught[rid].text) + '”</li>');
    });
    (layerLike.notes || []).forEach(function (n) {
      lines.push('<li>In my words: “' + esc(n.text) + '”</li>');
    });
    var ds = deltas(layerLike.answers || {});
    var deltaHtml = ds.length
      ? ds.map(function (d) {
          return '<div class="delta">' + esc(fill(S.lang.mirrorDelta, { deltaText: d.text })) + '</div>';
        }).join('')
      : '';
    mir.innerHTML = '<div class="mirror">' +
      '<span class="badge' + (isSaved ? ' saved' : '') + '">' + (isSaved ? 'SAVED — in force' : 'DRAFT — not saved') + '</span>' +
      '<p>' + esc(S.lang.mirrorIntro) + '</p><ul>' + lines.join('') + '</ul>' + deltaHtml +
      (isSaved ? '' : '<button class="save" id="saveLayerBtn">Save my definition layer</button>') +
      '</div>';
    var sv = $('saveLayerBtn');
    if (sv) sv.onclick = function () {
      S.layer.answers = S.draft.answers;
      S.layer.skipped = S.draft.skipped;
      S.layer = TMSLayer.saveLayer(S.layer);
      S.draft = null;
      renderInterview(); renderDefinitions(); renderAudit();
    };
  }

  /* ---------- Stage 2: the desk ---------- */

  function renderShipments() {
    var rows = S.ships.map(function (s) {
      return '<tr><td>' + s.id + '</td><td>' + esc(s.customer) + '</td><td>' + esc(s.dest) + '</td>' +
        '<td>' + s.pallets + '</td><td>' + (s.weightLb == null ? '—' : s.weightLb.toLocaleString()) + '</td>' +
        '<td>' + (s.stackable ? 'Yes' : '<b>No</b>') + '</td><td>' + esc(s.appointment.slice(11)) + '</td></tr>';
    }).join('');
    $('shipmentTable').innerHTML = '<table><thead><tr><th>ID</th><th>Customer</th><th>Dest</th>' +
      '<th>Pallets</th><th>Weight (lb)</th><th>Stackable</th><th>Appt</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderDefinitions() {
    $('constraintChip').innerHTML = '<span class="chip">Constraint set: ' +
      esc(S.defs.constraintSet.name) + ' — v' + S.defs.constraintSet.version +
      ' (' + esc(S.defs.constraintSet.author) + ', ' + esc(S.defs.constraintSet.date) + ')</span>';
    var html = S.defs.definitions.map(function (d) {
      return '<div class="def">' + esc(d.text) + '<div class="meta">' + esc(d.kind) + ' · ' +
        esc(d.scope) + ' · ' + esc(d.author) + ', ' + esc(d.date) + ' · facility layer</div></div>';
    }).join('');
    Object.keys(S.layer.answers || {}).forEach(function (qid) {
      html += '<div class="def">' + esc(mirrorLine(qid, S.layer.answers[qid])) +
        '<div class="meta">definition · yours · from your interview · user layer</div></div>';
    });
    Object.keys(S.layer.taught || {}).forEach(function (rid) {
      html += '<div class="def">“' + esc(S.layer.taught[rid].text) +
        '”<div class="meta">taught rule · yours · ' + esc(S.layer.taught[rid].date) + ' · user layer</div></div>';
    });
    (S.layer.notes || []).forEach(function (n) {
      html += '<div class="def">“' + esc(n.text) +
        '”<div class="meta">interview note · your words, verbatim · ' + esc(n.date || '') + ' · user layer</div></div>';
    });
    (S.layer.skipped || []).forEach(function (qid) {
      html += '<div class="def"><i>Skipped in your interview — the facility default applies.</i>' +
        '<div class="meta">skip on record · ' + esc(qid) + '</div></div>';
    });
    $('definitionsPanel').innerHTML = html;
  }

  /* ---------- Stage 3 + 4: the run and its decisions ---------- */

  function citeChips(cites) {
    return '<div class="cites">' + (cites || []).map(function (c) {
      return '<span>' + esc(CITE_LABELS[c] || c) + '</span>';
    }).join('') + '</div>';
  }

  function loadCard(l, planTag) {
    var summary = fill(S.lang.loadSummary, {
      lane: l.lane, pallets: l.totalPallets, shipments: l.shipmentIds.length,
      carrier: l.carrier.name, arriveText: 'arrives ' + l.arriveText
    });
    var suppressed = l.struggles.filter(function (s) { return TMSLayer.isSuppressed(S.suppressions, s.kind, l.lane); });
    var visible = l.struggles.filter(function (s) { return !TMSLayer.isSuppressed(S.suppressions, s.kind, l.lane); });

    var work = '<details class="workings"><summary>Workings — inputs, constraints, assumptions</summary>' +
      '<p>Shipments: ' + l.shipmentIds.join(', ') + ' · ' + l.totalPallets + ' pallets · ' +
      l.totalWeight.toLocaleString() + ' lb · departs ' + l.departText + ', arrives ' + l.arriveText + '.</p>';
    if (l.splitOutIds.length) {
      work += '<p><b>' + l.splitOutIds.join(', ') + ' ships on its own truck (+$' + l.splitCost +
        ')</b> — split by your taught rule' + (S.layer.taught[l.splitRule] ? ': “' + esc(S.layer.taught[l.splitRule].text) + '”' : '') + '.</p>';
    }
    work += '<table><thead><tr><th>Carrier</th><th>Freight</th><th>Expected failure cost</th><th>Expected total</th><th></th></tr></thead><tbody>' +
      l.carrierOptions.map(function (o) {
        return '<tr><td>' + esc(o.name) + '</td><td>$' + o.freight + '</td><td>$' + o.expectedFailure +
          '</td><td>$' + o.total + '</td><td>' + (o.name === l.carrier.name ? '← chosen' : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
    l.assumptions.forEach(function (a) { work += '<p class="assump">Assumption: ' + esc(a) + '</p>'; });
    l.notable.forEach(function (n) { work += '<p><b>' + esc(S.lang.notableIntro) + '</b> ' + esc(n) + '</p>'; });
    if (suppressed.length) {
      work += '<p><i>' + suppressed.length + ' flag(s) hidden by your instruction — “never flag this again” (' +
        suppressed.map(function (s) { return s.kind; }).join(', ') + '). The suppression is on the record here.</i></p>';
    }
    work += '</details>';

    var body = '';
    if (!visible.length && !suppressed.length) {
      body = '<div class="silence">' + esc(S.lang.silenceLine) + '</div>';
    } else if (visible.length) {
      body = '<div class="struggle-report"><div class="sr-head">' +
        esc(fill(S.lang.struggleHeadline, { lane: l.lane })) + '</div>' +
        visible.map(function (s) { return struggleHtml(l, s); }).join('') + '</div>';
    }
    var taken = S.resolved['plan-' + planTag + '-' + l.id];
    body += taken
      ? '<div><span class="ribbon">Approved by you — not official</span></div>'
      : '<button class="primary take-plan" data-takeplan="' + l.id + '">Take this plan</button>';

    return '<div class="load"><div class="load-head"><div class="load-title">' + esc(summary) + '</div>' +
      '<div class="load-cost"><div class="big-num">$' + l.expectedTotal + '</div>' +
      '<div class="cap">expected total (freight + expected failure' + (l.splitCost ? ' + split truck' : '') + ')</div></div></div>' +
      work + body + '</div>';
  }

  function struggleHtml(l, s) {
    var key = s.id;
    var res = S.resolved[key];
    var tail = '';
    if (res) {
      tail = '<div class="resolved">' + esc(res.text) + '</div>';
    } else {
      tail = '<div class="gestures">' +
        '<button data-act="take" data-lane="' + esc(l.lane) + '" data-sid="' + s.id + '">Take it</button>' +
        (s.teachable ? '<button data-act="change" data-lane="' + esc(l.lane) + '" data-sid="' + s.id + '">Change it</button>' : '') +
        '<button data-act="never" data-lane="' + esc(l.lane) + '" data-sid="' + s.id + '">Never flag this again</button></div>' +
        '<div class="teach-slot" id="teach-' + s.id + '"></div>';
    }
    return '<div class="struggle"><div class="amt">$' + s.dollars + '<span class="cap">at stake</span></div>' +
      '<div><h4>' + esc(s.title) + '</h4><p>' + esc(s.detail) + '</p>' + citeChips(s.cites) + tail + '</div></div>';
  }

  function renderPlan() {
    if (!S.plan) return;
    var note = (S.layer.savedAt ? '' :
      '<p class="stage-note">Running on facility defaults — the interview in stage 1 is how you make them yours.</p>');
    if (S.planStale) {
      note += '<div class="delta"><b>Your layer changed after this run.</b> The plan below cites the layer as it was at run time — including anything since struck. Re-run (stage 5, or the button above) to apply the current layer.</div>';
    }
    $('planBox').innerHTML = note + S.plan.loads.map(function (l) { return loadCard(l, 'main'); }).join('');
    bindPlanActions($('planBox'), 'main');
  }

  function findStruggle(sid) {
    var found = null;
    (S.plan ? S.plan.loads : []).forEach(function (l) {
      l.struggles.forEach(function (s) { if (s.id === sid) found = { load: l, s: s }; });
    });
    return found;
  }

  function logDecision(entry) {
    S.streak = TMSLayer.recordDecision(S.streak, entry);
    renderStreak(); renderDecisions();
  }

  function bindPlanActions(root, planTag) {
    root.querySelectorAll('[data-takeplan]').forEach(function (b) {
      b.onclick = function () {
        var lid = b.dataset.takeplan;
        S.resolved['plan-' + planTag + '-' + lid] = { action: 'take-plan' };
        logDecision({ when: new Date().toISOString(), action: 'take-plan', loadId: lid, text: 'Plan ' + lid + ' approved by the planner — not official until tendered.' });
        renderPlan();
      };
    });
    root.querySelectorAll('[data-act]').forEach(function (b) {
      b.onclick = function () {
        var f = findStruggle(b.dataset.sid);
        if (!f) return;
        var act = b.dataset.act;
        if (act === 'take') {
          S.resolved[f.s.id] = { action: 'take', text: 'Accepted and documented: the warning was shown, the planner took it. $' + f.s.dollars + ' — ' + f.s.title };
          logDecision({ when: new Date().toISOString(), action: 'take', struggleId: f.s.id, text: 'Took it — $' + f.s.dollars + ': ' + f.s.title + ' (' + f.load.lane + ')' });
          renderPlan();
        } else if (act === 'never') {
          S.suppressions = TMSLayer.addSuppression(f.s.kind, f.load.lane);
          S.resolved[f.s.id] = { action: 'never', text: 'Silenced by the planner: “never flag this again.” The suppression is on the record in the workings.' };
          logDecision({ when: new Date().toISOString(), action: 'never', struggleId: f.s.id, text: 'Never flag again — ' + f.s.kind + ' on ' + f.load.lane });
          renderPlan();
        } else if (act === 'change') {
          var slot = $('teach-' + f.s.id);
          slot.innerHTML = '<div class="teach-form"><input id="teachInput-' + f.s.id + '" placeholder="' +
            esc(S.lang.teachPrompt) + '"><button class="save" id="teachBtn-' + f.s.id + '">Teach it</button></div>';
          $('teachBtn-' + f.s.id).onclick = function () {
            var reason = $('teachInput-' + f.s.id).value.trim();
            if (!reason) return;
            if (f.s.teachRule) {
              S.layer.taught[f.s.teachRule] = { text: reason, date: new Date().toISOString().slice(0, 10), fromStruggle: f.s.kind };
              S.layer = TMSLayer.saveLayer(S.layer);
            }
            S.resolved[f.s.id] = { action: 'change', text: 'Changed — and taught: “' + reason + '” Remembered for ' + f.load.lane + '.' };
            S.planStale = true;
            logDecision({ when: new Date().toISOString(), action: 'change', struggleId: f.s.id, text: 'Changed it — taught: “' + reason + '”' });
            renderDefinitions(); renderAudit(); renderRerun(true);
            renderPlan();
          };
        }
      };
    });
  }

  function renderDecisions() {
    var box = $('decisionsBox');
    if (!S.streak.decisions.length) return;
    box.innerHTML = S.streak.decisions.slice().reverse().map(function (d) {
      return '<div class="decision">' + esc(d.text) + '<div class="when">' +
        esc(new Date(d.when).toLocaleString()) + ' · action: ' + esc(d.action) + '</div></div>';
    }).join('');
  }

  function renderStreak() {
    var b = S.streak.base;
    // The 212 base is SAMPLE backstory and is labeled as such — a streak in
    // the real product starts at zero and only counts real proposals
    // (Career Development Faye's leak #3: no manufactured confidence).
    $('streakValue').innerHTML = esc(fill(S.lang.streakCaption, {
      total: b.total, taken: b.taken, changed: b.changed, rejected: b.rejected
    })) + ' <span class="tag">sample history</span>';
    var s = S.streak.session;
    $('streakSession').textContent = (s.taken || s.changed || s.rejected)
      ? 'This session: ' + s.taken + ' taken · ' + s.changed + ' changed · ' + s.rejected + ' rejected'
      : '';
  }

  /* ---------- Stage 5: re-plan, exceptions, audit ---------- */

  function renderRerun(announce) {
    var box = $('rerunBox');
    var hasTeach = Object.keys(S.layer.taught || {}).length;
    if (!S.plan) {
      box.innerHTML = '<p class="empty">Run the consolidation in stage 3 first — then teach the agent something and the re-plan appears here.</p>';
      return;
    }
    box.innerHTML = '<p>Your layer has changed since the run. Re-plan with what the agent now knows.</p>' +
      '<button class="primary" id="rerunBtn">Re-run with my current layer</button><div id="rerunOut"></div>';
    $('rerunBtn').onclick = function () {
      var before = S.plan;
      var after = TMSEngine.plan(S.ships, S.defs, S.layer);
      var html = '';
      after.loads.forEach(function (l2, i) {
        var l1 = before.loads[i];
        var changed = l1.struggles.length !== l2.struggles.length || l1.expectedTotal !== l2.expectedTotal ||
          l1.shipmentIds.join() !== l2.shipmentIds.join();
        html += '<div class="compare"><div class="col"><b>Before — ' + esc(l1.lane) + '</b><br>Expected total $' +
          l1.expectedTotal + ' · ' + l1.struggles.length + ' struggle(s)<br>Shipments: ' + l1.shipmentIds.join(', ') + '</div>' +
          '<div class="col"><b>After — ' + esc(l2.lane) + '</b><br>Expected total $' + l2.expectedTotal +
          ' · ' + l2.struggles.length + ' struggle(s)<br>Shipments: ' + l2.shipmentIds.join(', ') +
          (l2.splitOutIds.length ? ' (+ ' + l2.splitOutIds.join(', ') + ' on its own truck)' : '') + '</div></div>';
        if (changed && hasTeach) {
          var reasons = Object.keys(S.layer.taught).map(function (k) { return S.layer.taught[k].text; });
          html += '<div class="payoff">' + esc(fill(S.lang.payoffLine, { reason: '' })) +
            ' <span class="quote">“' + esc(reasons[reasons.length - 1]) + '”</span></div>';
        }
      });
      $('rerunOut').innerHTML = html;
      S.plan = after;
      S.planStale = false;
      renderPlan();
    };
    if (announce) { box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  }

  function renderExceptions() {
    var items = [
      { t: 'Address change after tender', d: 'BrightMart moved S-099’s delivery to a different dock after the load was tendered. Needs a human call, not a re-plan.' },
      { t: 'Dock door 4 down until 13:00', d: 'Two inbound loads re-sequenced by the dock lead. The agent was told, not asked — facility fact, on the record.' },
      { t: 'Yesterday’s missed pickup', d: 'ValueHaul missed the Savannah pickup yesterday. It is in their record the next time the engine weighs their rate against their reliability.' }
    ];
    $('exceptionBox').innerHTML = items.map(function (x) {
      return '<div class="exc"><b>' + esc(x.t) + '</b><br>' + esc(x.d) + '</div>';
    }).join('');
  }

  function renderAudit() {
    var html = S.defs.definitions.map(function (d) {
      return '<div class="audit-item"><div><span class="kind">facility</span><br>' + esc(d.text) +
        '</div><span class="kind">' + esc(d.author) + '</span></div>';
    }).join('');
    Object.keys(S.layer.answers || {}).forEach(function (qid) {
      html += '<div class="audit-item"><div><span class="kind">your answer</span><br>' + esc(mirrorLine(qid, S.layer.answers[qid])) +
        '</div><button class="strike" data-strike-kind="answer" data-strike-key="' + qid + '">Strike</button></div>';
    });
    Object.keys(S.layer.taught || {}).forEach(function (rid) {
      html += '<div class="audit-item"><div><span class="kind">taught rule</span><br>“' + esc(S.layer.taught[rid].text) +
        '”</div><button class="strike" data-strike-kind="taught" data-strike-key="' + rid + '">Strike</button></div>';
    });
    (S.layer.notes || []).forEach(function (n, i) {
      html += '<div class="audit-item"><div><span class="kind">interview note</span><br>“' + esc(n.text) +
        '”</div><button class="strike" data-strike-kind="note" data-strike-key="' + i + '">Strike</button></div>';
    });
    (S.layer.skipped || []).forEach(function (qid) {
      html += '<div class="audit-item"><div><span class="kind">skip on record</span><br>' + esc(qid) +
        ' — facility default applies</div><button class="strike" data-strike-kind="skip" data-strike-key="' + qid + '">Strike</button></div>';
    });
    $('auditBox').innerHTML = html;
    $('auditBox').querySelectorAll('[data-strike-kind]').forEach(function (b) {
      b.onclick = function () {
        S.layer = TMSLayer.strikeFromLayer(S.layer, b.dataset.strikeKind, b.dataset.strikeKey);
        if (S.plan) { S.planStale = true; renderPlan(); }
        renderAudit(); renderDefinitions(); renderInterview(); renderRerun(false);
      };
    });
  }

  /* ---------- boot ---------- */

  /* ---------- users (profiles) ---------- */

  var liveMounted = false;

  function renderProfiles() {
    var store = TMSLayer.profiles();
    $('profileSelect').innerHTML = store.profiles.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === store.activeId ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    }).join('');
  }

  function reloadUserState() {
    S.layer = TMSLayer.loadLayer();
    S.streak = TMSLayer.loadStreak();
    S.suppressions = TMSLayer.loadSuppressions();
    S.plan = null; S.resolved = {}; S.draft = null; S.planStale = false;
    $('planBox').innerHTML = '';
    renderProfiles();
    renderInterview(); renderDefinitions();
    renderStreak(); renderDecisions(); renderAudit(); renderRerun(false);
  }

  function wireProfilesAndModes() {
    $('profileSelect').onchange = function () {
      TMSLayer.switchProfile($('profileSelect').value);
      reloadUserState();
    };
    $('newProfileBtn').onclick = function () {
      var name = prompt('Name for the new user (e.g. a persona you want to test):', '');
      if (name === null) return;
      TMSLayer.createProfile(name.trim() || undefined);
      reloadUserState();
      document.getElementById('stage1').scrollIntoView({ behavior: 'smooth' });
    };
    $('renameProfileBtn').onclick = function () {
      var p = TMSLayer.activeProfile();
      var name = prompt('Rename this user:', p.name);
      if (name === null || !name.trim()) return;
      TMSLayer.renameProfile(p.id, name.trim());
      renderProfiles();
    };
    $('deleteProfileBtn').onclick = function () {
      var p = TMSLayer.activeProfile();
      if (!confirm('Delete user "' + p.name + '" and everything saved for them in this browser?')) return;
      if (TMSLayer.deleteProfile(p.id)) reloadUserState();
      else alert('The last user cannot be deleted.');
    };
    $('modeStructured').onclick = function () {
      $('modeStructured').classList.add('picked'); $('modeLive').classList.remove('picked');
      $('structuredPane').hidden = false; $('livePane').hidden = true;
    };
    $('modeLive').onclick = function () {
      $('modeLive').classList.add('picked'); $('modeStructured').classList.remove('picked');
      $('structuredPane').hidden = true; $('livePane').hidden = false;
      if (!liveMounted) {
        liveMounted = true;
        TMSInterview.mount($('liveBox'), { onSaved: function () { reloadUserState(); } });
      }
    };
    window.addEventListener('tms:layer-changed', function () {
      S.layer = TMSLayer.loadLayer();
      renderDefinitions(); renderAudit();
    });
  }

  function boot() {
    Promise.all([
      fetch('data/shipments.json').then(function (r) { return r.json(); }),
      fetch('data/definitions.json').then(function (r) { return r.json(); }),
      fetch('data/agent-language.json').then(function (r) { return r.json(); })
    ]).then(function (parts) {
      S.ships = parts[0].shipments;
      S.defs = parts[1];
      S.lang = parts[2].strings;
      $('provenanceLine').textContent = parts[2].provenance.rule;
      wireProfilesAndModes();
      renderProfiles();
      renderInterview(); renderShipments(); renderDefinitions();
      renderStreak(); renderDecisions(); renderExceptions(); renderAudit(); renderRerun(false);
      $('runBtn').onclick = function () {
        S.plan = TMSEngine.plan(S.ships, S.defs, S.layer);
        S.resolved = {};
        S.planStale = false;
        renderPlan(); renderRerun(false);
      };
      $('exportBtn').onclick = function () {
        var blob = new Blob([TMSLayer.exportLayer(S.layer)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'my-definition-layer.json';
        a.click();
        URL.revokeObjectURL(a.href);
      };
      $('importFile').onchange = function (ev) {
        var f = ev.target.files[0];
        if (!f) return;
        f.text().then(function (text) {
          try {
            S.layer = TMSLayer.importLayer(text);
            renderInterview(); renderDefinitions(); renderAudit(); renderRerun(false);
            alert('Layer imported and saved. The definitions in force now include it.');
          } catch (e) { alert(e.message); }
        });
      };
    }).catch(function (e) {
      $('provenanceLine').textContent = 'Could not load the demo data (' + e.message + '). Serve this folder over HTTP (GitHub Pages does) — file:// blocks the data fetches.';
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
