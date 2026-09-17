/* ═══════════════════════════════════════════════════════════════════════════
   report-render.js — shared activity ROLL-UP + task-card renderer for every
   daily report (sales / accounting / admin), the management oversight views,
   the weekly view, the submission snapshot, and the PDFs.

   The ActivityLog appends one row per action, so a record touched N times today
   produces N rows. This module collapses those into ONE "task" per record
   (keyed on Module + Ref No), preserving the full touch history — so counts
   reflect DISTINCT work done, not raw actions, and the timeline reads as one
   card per record with an expandable "what was done" sub-list.

   Records with a blank or "N/A" Ref No (miscellaneous, code-less items) are NOT
   merged — each stays its own task so unrelated items never collapse together.
   Emails and calls are already distinct and are handled by their own sections.
   ═══════════════════════════════════════════════════════════════════════════ */

function _rrEsc(s) { return (typeof flowEsc === 'function') ? flowEsc(s) : String(s == null ? '' : s); }
function _rrMoney(v) { return (typeof flowMoney === 'function') ? flowMoney(v, 'PHP') : '₱' + Number(v || 0).toFixed(2); }
function _rrNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function _rrModClass(m) { return 'mod-' + String(m || '').replace(/\s+/g, ''); }
function _rrTime(ts) { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }
function _rrTsNum(ts) { const d = new Date(ts); return isNaN(d) ? 0 : d.getTime(); }

/* ── A155: recover the client/supplier name on legacy rows ─────────────────────
   Client/Supplier "Saved" rows logged before FlowAPI v89 carry a BLANK Ref No and read as a
   bare "—", so a manager can't tell who the client was. Those rows are always the automatic
   master-capture that fires seconds after a Pricing Request / Payment Request by the same user
   (A145), so the record they belong to is recoverable from the log itself — no backend change
   and no rewriting of stored rows.

   Two tiers, degrading honestly:
     • name map primed  → the card is titled with the client/supplier name (so repeat saves of
       one client collapse into a single card, matching native v89+ behaviour);
     • map absent/failed → title stays blank but the detail still says "via PR-…";
     • no correlation    → left exactly as it was. Never guessed.

   Keyed by MODULE + number on purpose: pricing requests and payment requests both number as
   PR-YYYYMM-NNN from separate counters, so a number alone can collide across the two. */
const _rrRefNames = {};
const _RR_TRIGGER = { Client: 'Pricing Request', Supplier: 'Payment Request' };
const _RR_LINK_WINDOW_MS = 120000;

/** Fetch the number→name maps once per page. Optional: enrichment degrades without it.
    Idempotent, so the 60 s report pollers re-calling it cost nothing. */
let _rrPrimed = null;
async function flowPrimeRefNames() {
  if (_rrPrimed) return _rrPrimed;
  if (typeof fetchFlow !== 'function') return _rrRefNames;
  const grab = async function (action, module, nameKeys) {
    try {
      const r = await fetchFlow(action);
      ((r && r.data) || []).forEach(function (x) {
        const no = x.prNo || x.refNo;
        if (!no) return;
        for (let i = 0; i < nameKeys.length; i++) {
          if (x[nameKeys[i]]) { _rrRefNames[module + ' ' + no] = String(x[nameKeys[i]]); return; }
        }
      });
    } catch (_) { /* leave the map short — cards fall back to "via <ref>" */ }
  };
  _rrPrimed = Promise.all([
    grab('getPricingRequests', 'Pricing Request', ['customer']),
    grab('getPaymentRequests', 'Payment Request', ['payee', 'supplier'])
  ]).then(function () { return _rrRefNames; });
  return _rrPrimed;
}

/** Attribute blank-ref Client/Supplier rows to the request that triggered them. Pure — copies. */
function _rrEnrich(entries) {
  const list = (entries || []).slice()
    .sort(function (a, b) { return _rrTsNum(a.timestamp) - _rrTsNum(b.timestamp); });
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const trigger = _RR_TRIGGER[e.module];
    if (!trigger) continue;
    if (String(e.refNo == null ? '' : e.refNo).trim()) continue;  // v89+ rows already carry the name
    for (let j = i - 1; j >= 0; j--) {
      const p = list[j];
      if (_rrTsNum(e.timestamp) - _rrTsNum(p.timestamp) > _RR_LINK_WINDOW_MS) break;
      if (p.user !== e.user || p.module !== trigger) continue;
      const ref = String(p.refNo || '').trim();
      if (!ref) break;
      list[i] = Object.assign({}, e, {
        refNo: _rrRefNames[trigger + ' ' + ref] || e.refNo,
        summary: (e.summary || '') + ' · via ' + ref
      });
      break;
    }
  }
  return list;
}

/**
 * Collapse raw ActivityLog entries into one task per record.
 * @param {Array} entries  rows from getActivityLog: {timestamp,date,user,module,action,refNo,summary,amount,currency}
 * @returns {Array} tasks, newest-first by last touch:
 *   { module, refNo, user, touches, verbs:[distinct actions, time order],
 *     firstTs, lastTs, latestSummary, amount (last non-zero), currency,
 *     actions:[{time,action,summary,amount}] (time-ascending) }
 */
function flowRollupActivity(entries) {
  const byKey = {};
  const tasks = [];
  let loose = 0;
  _rrEnrich(entries).forEach(function (e) {
    const ref = String(e.refNo == null ? '' : e.refNo).trim();
    const distinct = ref && ref.toUpperCase() !== 'N/A';
    // Separator is a printable pair, not a NUL: a NUL made git classify this whole file as
    // binary (no reviewable diffs, and grep skips it). '||' can't occur in a module name or ref.
    const key = distinct ? (String(e.module) + '||' + ref) : ('||loose' + (loose++));
    let t = distinct ? byKey[key] : null;
    if (!t) {
      t = { module: e.module || 'Other', refNo: ref, user: e.user || '', touches: 0,
            verbs: [], actions: [], firstTs: e.timestamp, lastTs: e.timestamp,
            latestSummary: '', amount: 0, currency: e.currency || 'PHP' };
      if (distinct) byKey[key] = t;
      tasks.push(t);
    }
    t.actions.push({ time: e.timestamp, action: e.action, summary: e.summary || '', amount: _rrNum(e.amount) });
    if (e.currency) t.currency = e.currency;
    if (!t.user && e.user) t.user = e.user;
  });
  // Post-process each task: time-order the touches, derive verbs/summary/amount/span.
  tasks.forEach(function (t) {
    t.actions.sort(function (a, b) { return _rrTsNum(a.time) - _rrTsNum(b.time); });
    t.touches = t.actions.length;
    t.firstTs = t.actions[0].time;
    t.lastTs = t.actions[t.actions.length - 1].time;
    t.verbs = [];
    t.actions.forEach(function (a) { if (a.action && t.verbs.indexOf(a.action) < 0) t.verbs.push(a.action); });
    // latest non-empty summary + latest non-zero amount (walk newest→oldest)
    for (let i = t.actions.length - 1; i >= 0; i--) { if (t.actions[i].summary) { t.latestSummary = t.actions[i].summary; break; } }
    for (let i = t.actions.length - 1; i >= 0; i--) { if (t.actions[i].amount) { t.amount = t.actions[i].amount; break; } }
  });
  // Newest work first.
  tasks.sort(function (a, b) { return _rrTsNum(b.lastTs) - _rrTsNum(a.lastTs); });
  return tasks;
}

/** Distinct-task counts derived from a rolled-up task list (or raw entries). */
const _RR_DOC_VERBS = ['Created', 'Issued', 'Received', 'Added'];
/* ── A280 · A SUBMITTED REPORT'S OWN COUNTERS ────────────────────────────────────────────────
 *
 * 'Counts JSON' is not one shape. A sales, admin or accounting report submits
 * flowActivityCounts().byModule — module names the card ALREADY draws as mod-badges two lines up,
 * so a generic Object.entries() dump would print the same numbers twice, three lines apart.
 * Accounting's `metrics` are PESO AMOUNTS, which as bare integers read as counts of things. And a
 * lead-gen report carries fifteen keys, one of which ('working') is a BOOLEAN.
 *
 * So: a per-role map, keyed and ORDERED, and silence for a role with no entry. That keeps this
 * additive — a role that starts sending counts renders nothing until somebody writes down what its
 * keys mean, which is the right default for a number on a manager's screen. The map is CODE, not
 * data, so it applies to every report already sitting in the sheet; a metricsJson the page supplied
 * would only ever describe reports submitted after the change.
 *
 * Why lead-gen needs it at all: only saveLeadgenRecord/deleteLeadgenRecord are in _MODULE_MAP, so a
 * full lead-gen day produces almost no ActivityLog rows and the card's Movements and task columns
 * read near-zero. These eight ARE the day.
 *
 * 'eod' is deliberately absent — it is 1 by definition on a card that exists, and the card's own
 * header already says when it was submitted. So are the weekly extras (leads, meetings,
 * intelUpdates, introEmails, replies, suppliersHandedOff): getLeadgenCounts returns them per-day so
 * the week can be summed, and a Tuesday's `leads: 0` is a wrong-looking zero, not information. They
 * belong on the Friday report, where they already are.
 */
const FLOW_REPORT_COUNTERS = {
  leadgen: [
    ['attempts',      'Outbound attempts'],
    ['conversations', 'Decision-makers reached'],
    ['emails',        'Prospecting emails'],
    ['linkedin',      'LinkedIn touches'],
    ['suppliers',     'Suppliers researched'],
    ['accounts',      'Target accounts researched'],
    ['crm',           'CRM records touched'],
    ['scheduled',     'Meetings / calls scheduled'],
  ],
};

/** The counters worth showing for one submitted report, as [label, value] pairs — or [], never a
 *  generic dump. A key absent from the payload is skipped rather than rendered as 0. */
function flowReportCounters(sub) {
  const map = FLOW_REPORT_COUNTERS[String((sub && sub.role) || '').toLowerCase()];
  if (!map || !sub || !sub.counts) return [];
  return map
    .filter(([k]) => sub.counts[k] !== undefined && sub.counts[k] !== null && typeof sub.counts[k] !== 'boolean')
    .map(([k, label]) => [label, _rrNum(sub.counts[k])]);
}

/** The chip row itself, so the management card and the all-reports list cannot drift apart. The
 *  shape deliberately matches the chips the person saw on their own page before submitting. */
function flowReportCountersHtml(sub) {
  const rows = flowReportCounters(sub);
  if (!rows.length) return '';
  return '<div style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-top:0.5rem;">'
    + rows.map(([l, v]) => `<span style="display:inline-flex;gap:0.3rem;align-items:baseline;padding:0.2rem 0.55rem;`
        + `border-radius:999px;background:var(--bg-inset,#f1f5f9);font-size:0.75rem;">`
        + `<b style="font-size:0.85rem;">${v}</b><span style="color:var(--text-muted,#64748b);">${_rrEsc(l)}</span></span>`).join('')
    + '</div>';
}

function flowActivityCounts(entriesOrTasks) {
  const tasks = (entriesOrTasks && entriesOrTasks.length && entriesOrTasks[0] && entriesOrTasks[0].actions)
    ? entriesOrTasks : flowRollupActivity(entriesOrTasks);
  const byModule = {};
  let docs = 0, pdfs = 0, totalActions = 0;
  tasks.forEach(function (t) {
    byModule[t.module] = (byModule[t.module] || 0) + 1;
    totalActions += t.touches;
    if (t.verbs.some(function (v) { return _RR_DOC_VERBS.indexOf(v) >= 0; })) docs++;
    if (t.verbs.indexOf('PDF Saved') >= 0) pdfs++;
  });
  return { tasks: tasks.length, totalActions: totalActions, byModule: byModule, docs: docs, pdfs: pdfs, list: tasks };
}
/** Count distinct tasks in a module (optionally only those that had a given verb). */
function flowTasksIn(tasks, module, verb) {
  return tasks.filter(function (t) { return t.module === module && (!verb || t.verbs.indexOf(verb) >= 0); }).length;
}
/** Sum the (latest) amount across distinct tasks in a module — no double-count from repeat saves. */
function flowTaskAmount(tasks, module) {
  return tasks.filter(function (t) { return t.module === module; }).reduce(function (s, t) { return s + _rrNum(t.amount); }, 0);
}

/** One card per record, grouped by module. opts:{moduleOrder,withUser,emptyText,startOpen}. */
function flowRenderTaskCards(tasks, opts) {
  opts = opts || {};
  const order = opts.moduleOrder || [];
  const withUser = !!opts.withUser;
  if (!tasks || !tasks.length) {
    return '<div class="dr-empty" style="padding:0.8rem;">' + _rrEsc(opts.emptyText || 'No recorded activity for this day.') + '</div>';
  }
  const byMod = {};
  tasks.forEach(function (t) { (byMod[t.module] = byMod[t.module] || []).push(t); });
  const mods = order.filter(function (m) { return byMod[m]; })
    .concat(Object.keys(byMod).filter(function (m) { return order.indexOf(m) < 0; }));
  return mods.map(function (m) {
    const list = byMod[m];
    const cards = list.map(function (t) {
      const span = t.touches > 1 ? (_rrTime(t.firstTs) + '–' + _rrTime(t.lastTs)) : _rrTime(t.lastTs);
      const latest = t.verbs[t.verbs.length - 1] || '';
      const updates = t.touches > 1 ? ('<span class="rr-updates">×' + t.touches + ' updates</span>') : '';
      const amt = t.amount ? ('<span class="rr-amt">' + _rrMoney(t.amount) + '</span>') : '';
      const who = withUser && t.user ? ('<span class="rr-who">' + _rrEsc(t.user) + '</span>') : '';
      const sub = t.actions.map(function (a) {
        return '<tr><td class="rr-t">' + _rrEsc(_rrTime(a.time)) + '</td>'
          + '<td><span class="act-chip">' + _rrEsc(a.action) + '</span></td>'
          + '<td class="rr-d">' + _rrEsc(a.summary) + '</td>'
          + '<td class="num">' + (a.amount ? _rrMoney(a.amount) : '') + '</td></tr>';
      }).join('');
      return '<details class="rr-card"' + (opts.startOpen ? ' open' : '') + '>'
        + '<summary class="rr-sum">'
        + '<span class="rr-ref">' + _rrEsc(t.refNo || '—') + '</span>'
        + '<span class="act-chip">' + _rrEsc(latest) + '</span>' + updates + who
        + '<span class="rr-span">' + _rrEsc(span) + '</span>' + amt
        + '</summary>'
        + '<div class="rr-body"><table class="flow-table"><thead><tr>'
        + '<th>Time</th><th>Action</th><th>Detail</th><th class="num">Amount</th></tr></thead>'
        + '<tbody>' + sub + '</tbody></table></div>'
        + '</details>';
    }).join('');
    return '<div class="dr-sect rr-mod">'
      + '<div class="dr-sect-title"><span class="mod-badge ' + _rrModClass(m) + '">' + _rrEsc(m) + '</span> '
      + '<span class="pill">' + list.length + ' task' + (list.length === 1 ? '' : 's') + '</span></div>'
      + '<div class="rr-cards">' + cards + '</div></div>';
  }).join('');
}

/** Small shared CSS for the task cards — injected once so every page picks it up. */
function flowRenderInjectCss() {
  if (document.getElementById('rrCss')) return;
  const s = document.createElement('style');
  s.id = 'rrCss';
  s.textContent = [
    '.rr-cards{display:flex;flex-direction:column;gap:0.4rem;}',
    '.rr-card{border:1px solid var(--border,#e2e8f0);border-radius:10px;background:var(--bg-card,#fff);overflow:hidden;}',
    '.rr-sum{list-style:none;cursor:pointer;display:flex;align-items:center;gap:0.55rem;padding:0.5rem 0.75rem;font-size:0.85rem;}',
    '.rr-sum::-webkit-details-marker{display:none;}',
    '.rr-sum::before{content:"▸";color:var(--text-muted,#94a3b8);font-size:0.8rem;transition:transform .15s;}',
    'details[open] .rr-sum::before{transform:rotate(90deg);}',
    '.rr-ref{font-weight:700;color:var(--text-primary,#1e293b);}',
    '.rr-updates{font-size:0.72rem;font-weight:600;color:#b45309;background:#fffbeb;border-radius:999px;padding:0.05rem 0.45rem;}',
    '.rr-who{font-size:0.75rem;color:var(--text-secondary,#475569);}',
    '.rr-span{margin-left:auto;font-size:0.75rem;color:var(--text-muted,#94a3b8);}',
    '.rr-amt{font-size:0.8rem;font-weight:600;color:var(--text-primary,#1e293b);font-variant-numeric:tabular-nums;}',
    '.rr-body{border-top:1px solid var(--border,#eef2f7);padding:0.3rem 0.5rem 0.5rem;}',
    '.rr-body .flow-table{font-size:0.8rem;}',
    '.rr-body .rr-t{color:var(--text-muted,#94a3b8);white-space:nowrap;}',
    '.rr-body .rr-d{color:var(--text-secondary,#475569);}',
    '.rr-mod+.rr-mod{margin-top:0.6rem;}',
  ].join('');
  document.head.appendChild(s);
}
