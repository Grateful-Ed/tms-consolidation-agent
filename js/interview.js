/*
 * interview.js — the LIVE interview (v0.2, William's request 2026-10-17).
 *
 * Not a form. Muse Spark conducts a real conversation: one question at a
 * time, follow-ups when an answer is vague, rehearsed, or contradicts
 * itself, a soft ten-minute limit, a signaled landing, then a first-person
 * mirror quoting the user's words verbatim — and a machine-readable layer
 * extract the engine can read. Nothing is saved until the user presses
 * save on the mirror (the save gate applies to live interviews too).
 *
 * The API key: a public static page cannot hold one, so the user pastes
 * their own Meta Model API key here. It is kept in sessionStorage only
 * (dies with the tab), sent only to api.meta.ai, and never written into
 * the layer, the streak, or anywhere else. The API answers browser calls
 * (Access-Control-Allow-Origin: *), verified 2026-10-17.
 */
(function (global) {
  'use strict';

  var API_URL = 'https://api.meta.ai/v1/chat/completions';
  var MODEL = 'muse-spark-1.3';
  var KEY_SLOT = 'tms.apikey.session';
  var SOFT_LIMIT_MS = 10 * 60 * 1000;

  var SYSTEM = [
    'You are the planning agent inside a TMS (transportation management) tool at a mid-market 3PL, Peach State Freight. You are a new hire being trained by the planner in front of you. Before you plan anything, you interview them to learn how THEY work — their definitions, not the generic defaults. This conversation is that interview.',
    '',
    'How to run it:',
    '- Open with two or three plain sentences: what this is, why it comes before any planning, that they can inspect or strike anything saved about them at any time. Then ask your first question.',
    '- ONE question at a time. Plain dispatcher language. Never offer multiple choice, never list options — ask like a person.',
    '- You must come away knowing these three things (work them in naturally, in any order): (1) what "on-time" means for Hartline Stores, their biggest customer — by the dock-door appointment time exactly, or anywhere on the promised day? (2) whether Hartline\'s S-102 freight, marked non-stackable in the system, really cannot have freight stacked on it. (3) when the cheap carrier is shakier and the freight is the anchor client\'s, which way they lean by default — protect the client, or cheapest first and take the risk.',
    '- Also listen for: what a good day looks like to them, tolerances, exceptions, and anything they volunteer about how they actually work. Do NOT ask about things they have already told you.',
    '- CRITICAL: if an answer is vague, sounds like the official policy rather than what they really do, hesitates, or contradicts something earlier, FOLLOW UP. Ask for the last real example. Ask what happens when the rule meets a bad day. A foundation answer you had to dig for is worth three surface answers.',
    '- Keep it tight: this should take about ten minutes. When you hold working answers for the three required topics, signal the landing in plain words ("one or two things left, then I\'ll show you what I heard"), ask ONE final catch-all ("Anything I should know that I didn\'t ask about?"), take that answer in, and close.',
    '- The user may end it at any time ("that\'s enough") — close immediately with what you have.',
    '',
    'Closing (when coverage is complete, the catch-all is answered, or the user ends it):',
    'Reply with the mirror FIRST: a short summary in first person, in the user\'s own words and phrases, quoting their exact wording for every definition — never paraphrase their words, never tidy their grammar. Start lines with "For me, ...". Separately, list any place they contradicted themselves, as a plain question. Mark anything not covered as a gap, not a guess.',
    'Then, on its own, output exactly one fenced JSON block like this and nothing after it:',
    '```json',
    '{"answers":{"ontimeHartline":"appointment"|"day"|null,"stackHartline":"no-stack"|"can-stack"|null,"cheapVsSafe":"safe"|"cheap"|null},"notes":["<a verbatim statement of theirs worth saving, exactly as they said it>"],"skipped":["<any of the three answer keys never covered>"]}',
    '```',
    'Map their words to the values honestly; when you cannot tell, use null and list the key in skipped. Notes: at most 4, each a direct quote of something they actually said.'
  ].join('\n');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function mount(root, opts) {
    var state = {
      key: '',
      messages: [], startedAt: null, timer: null, nudgeSent: false,
      pending: null, busy: false
    };
    try { state.key = global.sessionStorage.getItem(KEY_SLOT) || ''; } catch (e) {}

    root.innerHTML =
      '<div class="live-wrap">' +
      '<p class="stage-note">A real conversation with the agent (Muse Spark), not a form. It asks one question at a time, digs when an answer sounds rehearsed, and wraps up in about ten minutes. Your words are quoted back verbatim in the mirror — nothing is saved until you say save.</p>' +
      '<div class="live-key"><input type="password" id="liveKey" placeholder="Paste your Meta Model API key" value="' + esc(state.key) + '">' +
      '<button class="save" id="liveStart">Start the interview</button></div>' +
      '<p class="live-keynote">Your key stays in this browser tab (session storage only), goes only to api.meta.ai, and is never written into your layer. A public page cannot hold a key of its own — that is what a backend would fix.</p>' +
      '<div class="live-meta" id="liveMeta" hidden><span id="liveClock">0:00</span><span id="liveCount"></span>' +
      '<button class="ghost" id="liveWrap">That\'s enough — show me what you heard</button></div>' +
      '<div class="live-log" id="liveLog"></div>' +
      '<div class="live-input" id="liveInputRow" hidden><input id="liveText" placeholder="Answer like you would talk…"><button class="primary" id="liveSend">Send</button></div>' +
      '<div id="liveMirror"></div>' +
      '</div>';

    var $ = function (id) { return root.querySelector('#' + id); };
    var log = $('liveLog');

    function addMsg(who, text) {
      var d = document.createElement('div');
      d.className = 'live-msg ' + who;
      d.innerHTML = '<b>' + (who === 'agent' ? 'Agent' : 'You') + '</b><p>' + esc(text) + '</p>';
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
    }
    function clock() {
      if (!state.startedAt) return;
      var ms = Date.now() - state.startedAt;
      var s = Math.floor(ms / 1000);
      $('liveClock').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + ' / 10:00';
      if (ms > SOFT_LIMIT_MS && !state.nudgeSent) {
        state.nudgeSent = true;
        var note = document.createElement('p');
        note.className = 'stage-note';
        note.textContent = 'Ten minutes — the agent has been told to land it.';
        log.appendChild(note);
      }
    }
    function extractJson(text) {
      var m = text.match(/```json\s*([\s\S]*?)```/);
      if (!m) return null;
      try { return { data: JSON.parse(m[1]), prose: text.slice(0, m.index).trim() }; }
      catch (e) { return null; }
    }
    function call(extraSystemNote) {
      state.busy = true;
      $('liveSend').disabled = true;
      var msgs = state.messages.slice();
      if (extraSystemNote) msgs.push({ role: 'system', content: extraSystemNote });
      return fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.key },
        body: JSON.stringify({ model: MODEL, messages: msgs, temperature: 0.5 })
      }).then(function (r) {
        if (!r.ok) throw new Error(r.status === 401 ? 'That key was not accepted by the API.' : 'The API answered ' + r.status + '.');
        return r.json();
      }).then(function (j) {
        var text = j.choices[0].message.content;
        state.messages.push({ role: 'assistant', content: text });
        var ex = extractJson(text);
        if (ex) {
          addMsg('agent', ex.prose || '(mirror)');
          finishInterview(ex.data, ex.prose);
        } else {
          addMsg('agent', text);
        }
      }).catch(function (e) {
        addMsg('agent', '⚠ ' + e.message + ' Check the key and try again.');
      }).finally(function () {
        state.busy = false;
        $('liveSend').disabled = false;
        var n = state.messages.filter(function (m) { return m.role === 'assistant'; }).length;
        $('liveCount').textContent = n + (n === 1 ? ' question' : ' questions') + ' so far';
      });
    }
    function finishInterview(data, prose) {
      state.pending = data;
      clearInterval(state.timer);
      $('liveInputRow').hidden = true;
      $('liveWrap').hidden = true;
      var notes = (data.notes || []).map(function (n) {
        return '<li>“' + esc(n) + '”</li>';
      }).join('');
      var lines = Object.keys(data.answers || {}).filter(function (k) { return data.answers[k]; }).map(function (k) {
        return '<li>' + esc(k) + ' → <b>' + esc(data.answers[k]) + '</b></li>';
      }).join('');
      $('liveMirror').innerHTML = '<div class="mirror"><span class="badge">DRAFT — not saved</span>' +
        '<p><b>What the agent heard</b> (its mirror — your words, quoted):</p>' +
        '<p class="live-prose">' + esc(prose).replace(/\n/g, '<br>') + '</p>' +
        (lines ? '<p>What this sets in your layer:</p><ul>' + lines + '</ul>' : '') +
        (notes ? '<p>Saved as interview notes, in your words:</p><ul>' + notes + '</ul>' : '') +
        ((data.skipped || []).length ? '<p><i>Not covered: ' + esc((data.skipped || []).join(', ')) + ' — recorded as skipped, facility default applies.</i></p>' : '') +
        '<button class="save" id="liveSave">Save my definition layer</button></div>';
      $('liveSave').onclick = function () {
        var layer = TMSLayer.loadLayer();
        Object.keys(data.answers || {}).forEach(function (k) {
          if (data.answers[k]) layer.answers[k] = data.answers[k];
        });
        (data.notes || []).forEach(function (n) {
          layer.notes.push({ text: n, date: new Date().toISOString().slice(0, 10), source: 'live interview' });
        });
        layer.skipped = (data.skipped || []).filter(function (k) { return !data.answers[k]; });
        TMSLayer.saveLayer(layer);
        $('liveMirror').innerHTML = '<div class="mirror"><span class="badge saved">SAVED — in force</span>' +
          '<p>Your layer is saved for this user. The desk, the run, and the audit below are all reading it now.</p></div>';
        if (opts && opts.onSaved) opts.onSaved();
        global.dispatchEvent(new Event('tms:layer-changed'));
      };
    }
    function send(text) {
      if (!text || state.busy) return;
      addMsg('you', text);
      state.messages.push({ role: 'user', content: text });
      var note = null;
      if (state.nudgeSent) note = 'Time is past ten minutes. Signal the landing if you have not, ask the catch-all if it remains, and close with the mirror + JSON block now.';
      call(note);
    }

    $('liveStart').onclick = function () {
      state.key = $('liveKey').value.trim();
      if (!state.key) { alert('Paste your Meta Model API key first — it never leaves this tab.'); return; }
      try { global.sessionStorage.setItem(KEY_SLOT, state.key); } catch (e) {}
      state.messages = [{ role: 'system', content: SYSTEM }];
      state.startedAt = Date.now();
      $('liveMeta').hidden = false;
      $('liveInputRow').hidden = false;
      $('liveStart').disabled = true;
      $('liveKey').disabled = true;
      state.timer = setInterval(clock, 1000); clock();
      state.messages.push({ role: 'user', content: '(The planner has just arrived for onboarding. Begin.)' });
      call(null);
    };
    $('liveSend').onclick = function () {
      var v = $('liveText').value.trim();
      $('liveText').value = '';
      send(v);
    };
    $('liveText').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('liveSend').click(); });
    $('liveWrap').onclick = function () { send("That's enough — show me what you heard."); };
  }

  global.TMSInterview = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
