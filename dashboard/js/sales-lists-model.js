/* sales-lists-model.js — A385 · how the sales lists are organized (My Requests on flow-pricing-request.html, the list on
 * flow-quotations.html). Neil, 30 Oct 2026: "the organizations of purchase request created, pending or no price yet, and
 * created quotations and pending or already sent quotations ... clean, and organize by month created, last follow up, by
 * client, and other more organization".
 *
 * Each page turns its records into plain rows — { key, date, client, clientKey, stage, value, followAt, updatedAt, rep,
 * hay, archived, raw } — and these functions group, sort, search and count them. Nothing here touches the page.
 *
 * PURE. tests/flow/sales-lists.js runs it in node. A client is grouped by crCanonKey (js/client-rollup.js) when the page
 * has it, so "PHILCEMENT CORP." and "Philcement Corporation" are one group under the spelling used most.
 */

const SLM_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/* Age buckets, newest first; 'never' is for a quotation that went out and was never followed up. */
const SLM_AGES = [['week', 'This week'], ['two', '1–2 weeks ago'], ['month', '2–4 weeks ago'], ['older', 'Over a month ago'], ['never', 'Never followed up']];

function _slmS(v) { return String(v == null ? '' : v).trim(); }
function _slmDay(v) {
  const s = _slmS(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s) && s.length <= 10) return s.slice(0, 10);
  if (typeof flowDate === 'function') { const d = flowDate(v); if (d) return d; }
  const t = new Date(s);
  return isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
}

/** 'yyyy-MM' of a date ('' for none). */
function slmMonthKey(v) { return _slmDay(v).slice(0, 7); }
/** "October 2026". */
function slmMonthLabel(key) { const m = /^(\d{4})-(\d{2})$/.exec(_slmS(key)); return m ? SLM_MONTHS[+m[2] - 1] + ' ' + m[1] : 'No date'; }
/** Whole days from `v` to `today` (both dates), or null. */
function slmDaysSince(v, today) {
  const a = _slmDay(v), b = _slmDay(today);
  if (!a || !b) return null;
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
/** Which age bucket a date falls in, as of today; 'never' when there is no date. */
function slmAge(v, today) {
  const d = slmDaysSince(v, today);
  if (d === null) return 'never';
  return d <= 7 ? 'week' : d <= 14 ? 'two' : d <= 30 ? 'month' : 'older';
}
function slmAgeLabel(key) { const a = SLM_AGES.find(x => x[0] === key); return a ? a[1] : key; }
/** "today", "yesterday", "5 days ago", "3 weeks ago", "2 months ago". */
function slmAgo(v, today) {
  const d = slmDaysSince(v, today);
  if (d === null) return '';
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return d + ' days ago';
  if (d < 60) return Math.round(d / 7) + ' weeks ago';
  return Math.round(d / 30) + ' months ago';
}
/** The key a client is grouped under. */
function slmClientKey(name) {
  const n = _slmS(name);
  if (!n) return '';
  return typeof crCanonKey === 'function' ? (crCanonKey(n) || n.toLowerCase()) : n.toLowerCase().replace(/\s+/g, ' ');
}

/** Rows whose words (or, for 4 digits or more, whose numbers) contain the search. */
function slmSearch(rows, q) {
  const t = _slmS(q).toLowerCase(), d = t.replace(/\D/g, '');
  if (!t) return (rows || []).slice();
  return (rows || []).filter(r => {
    const hay = _slmS(r.hay).toLowerCase();
    /* a number typed as one run of digits matches one stored with spaces or dashes ("0917 123 4567") */
    return hay.indexOf(t) >= 0 || (d.length >= 4 && hay.replace(/(\d)[\s().-]+(?=\d)/g, '$1').indexOf(d) >= 0);
  });
}

/** sort: 'newest' (default) | 'oldest' | 'biggest' | 'client'. Ties go to the newest, then the key. */
function slmSort(rows, sort) {
  const s = sort || 'newest', byDate = (a, b) => _slmDay(b.date).localeCompare(_slmDay(a.date)) || _slmS(b.key).localeCompare(_slmS(a.key));
  return (rows || []).slice().sort((a, b) =>
    s === 'oldest' ? (_slmDay(a.date).localeCompare(_slmDay(b.date)) || _slmS(a.key).localeCompare(_slmS(b.key)))
    : s === 'biggest' ? ((Number(b.value) || 0) - (Number(a.value) || 0) || byDate(a, b))
    : s === 'client' ? (_slmS(a.client).localeCompare(_slmS(b.client)) || byDate(a, b))
    : byDate(a, b));
}

/** How many rows each chip holds. `chipOf(row)` names the one chip a row belongs to; 'all' counts every row except the
 *  archived, so the stage chips always add up to All. */
function slmChipCounts(rows, chipOf) {
  const out = { all: 0 };
  (rows || []).forEach(r => {
    const c = chipOf(r);
    out[c] = (out[c] || 0) + 1;
    if (c !== 'archived') out.all++;
  });
  return out;
}

/** The spelling a client's group is shown under: the one used most, then the longest. */
function _slmTidy(names) {
  const n = {};
  names.forEach(x => { const k = _slmS(x); if (k) n[k] = (n[k] || 0) + 1; });
  const caps = (x) => (/[A-Z]/.test(x) ? 1 : 0);   // a tie goes to a spelling with capitals: "X Corp" over "x corp"
  return Object.keys(n).sort((a, b) => n[b] - n[a] || caps(b) - caps(a) || b.length - a.length || a.localeCompare(b))[0] || 'No client';
}

/** Rows in groups, already sorted inside each: by 'month' (newest month first), 'client' (A to Z), 'stage' (o.stages
 *  order), 'follow' (last follow-up, newest first, or oldest first with o.oldestFirst; o.followGroup(row) may name a
 *  group of its own, such as 'Not sent yet', placed after the age groups in o.followOrder order), 'update' (last update,
 *  newest first) or 'rep'. Each group: { key, label, rows, count, value }. */
function slmGroup(rows, by, o) {
  const opt = o || {}, today = opt.today || '', sort = opt.sort || 'newest', groups = {}, order = [];
  const put = (key, label, r) => { if (!groups[key]) { groups[key] = { key, label, rows: [], names: [] }; order.push(key); } groups[key].rows.push(r); if (r.client) groups[key].names.push(r.client); };
  (rows || []).forEach(r => {
    if (by === 'client') put('c:' + (r.clientKey || slmClientKey(r.client) || '-'), '', r);
    else if (by === 'stage') { const st = (opt.stages || []).find(x => x[0] === r.stage); put('s:' + r.stage, st ? st[1] : r.stage, r); }
    else if (by === 'follow') {
      const own = opt.followGroup ? opt.followGroup(r) : null;
      if (own) put('f:' + own[0], own[1], r); else { const a = slmAge(r.followAt, today); put('a:' + a, slmAgeLabel(a), r); }
    }
    else if (by === 'update') { const a = slmAge(r.updatedAt, today); put('a:' + a, a === 'never' ? 'No date' : 'Updated ' + slmAgeLabel(a).toLowerCase(), r); }
    else if (by === 'rep') put('r:' + (_slmS(r.rep) || 'Unassigned'), _slmS(r.rep) || 'Unassigned', r);
    else { const m = slmMonthKey(r.date); put('m:' + (m || '-'), slmMonthLabel(m), r); }
  });
  const list = order.map(k => {
    const g = groups[k];
    if (by === 'client') g.label = _slmTidy(g.names);
    g.rows = slmSort(g.rows, sort);
    g.count = g.rows.length;
    g.value = Math.round(g.rows.reduce((t, r) => t + (Number(r.value) || 0), 0) * 100) / 100;
    delete g.names;
    return g;
  });
  /* opt.oldestFirst (the quotation list's follow-up grouping): never followed up, then over a month, ... then this week,
     because the deal nobody has chased in weeks is the one to look at first. */
  const ageRank = k => { const i = SLM_AGES.findIndex(a => 'a:' + a[0] === k); return i < 0 ? 99 : (opt.oldestFirst ? (i === 4 ? -1 : 4 - i) : i); };
  const ownRank = k => { const i = (opt.followOrder || []).indexOf(k.slice(2)); return i < 0 ? 50 : i; };
  list.sort((a, b) => {
    if (by === 'client' || by === 'rep') return a.label.localeCompare(b.label);
    if (by === 'stage') { const s = (opt.stages || []).map(x => 's:' + x[0]); return s.indexOf(a.key) - s.indexOf(b.key); }
    if (by === 'follow') {
      const ra = a.key.indexOf('f:') === 0 ? 100 + ownRank(a.key) : ageRank(a.key), rb = b.key.indexOf('f:') === 0 ? 100 + ownRank(b.key) : ageRank(b.key);
      return ra - rb;
    }
    if (by === 'update') return ageRank(a.key) - ageRank(b.key);
    return b.key.localeCompare(a.key);   // months, newest first ('m:-' last)
  });
  return list;
}

/* A386 — an item's NAME, not its whole description. Item names on requests often carry the full spec sheet pasted in
   ("Portable AcetyleneandOxygen tank Kit Product Name: Portable Welding Kit Brand: Greenfield Type: ..."), which turned one
   row of My Requests into a column of forty lines. The list shows what the item is; Open shows all of it. */
const _SLM_SPEC = /\s(?:Product Name|Brand|Model(?: No\.?)?|Type|Specs?|Specifications?|Application|Description|Features?|Size|Capacity|Material|Components?|Warranty|Dimensions?|Rating|Power|Voltage)\s*:/i;
/** A short name for a list row: the text before the first spec label ("Brand:", "Type:" …), at most `max` characters,
 *  cut at a word with an ellipsis. */
function slmShortItem(name, max) {
  const n = max || 60;
  let s = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
  const cut = s.search(_SLM_SPEC);
  if (cut >= 8) s = s.slice(0, cut).replace(/[\s,;:–—-]+$/, '');
  else { const t = slmItemSpecs(s); if (t.specs.length && t.title && s.indexOf(t.title) === 0 && t.title.length >= 8) s = t.title; }
  if (s.length > n) s = s.slice(0, n).replace(/\s+\S*$/, '').replace(/[\s,;:–—-]+$/, '') + '…';
  return s;
}

const _SLM_TAIL = /(Product Name|Model No\.?|Model|Brand|Type|Applications?|Material|Warranty|Use|Origin|Voltage|Rating|Description|Specifications?)$/;
/** An item name with a spec sheet pasted in, read apart: { title, specs: [[label, value]] }. A label is one to four
 *  capitalised words before a colon ("Brand:", "Kit Components:", "Cylinder Capacity:"); the title is what comes before
 *  the first one (or the Product Name, when the text starts with a label). A name with no labels is all title. */
function slmItemSpecs(name) {
  const s = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
  const re = /(?:^|\s)((?:[A-Z][\w&/().'-]*)(?: [A-Z][\w&/().'-]*){0,3}):\s/g, marks = [];
  let m;
  while ((m = re.exec(s))) {
    /* Title-case values ("Portable Welding Kit Brand:") run into the label: a common label at the end of the run is the
       label, and the words before it belong to the value. Otherwise a run of three or more keeps its last two words. */
    let label = m[1];
    const known = _SLM_TAIL.exec(label), words = label.split(' ');
    if (known && known[1] !== label) label = known[1];
    else if (!known && words.length > 2) label = words.slice(-2).join(' ');
    const start = m.index + (m[0].charAt(0) === ' ' ? 1 : 0) + (m[1].length - label.length);
    marks.push({ at: start, label, body: re.lastIndex });
  }
  if (!marks.length) return { title: s, specs: [] };
  const specs = marks.map((k, i) => [k.label, s.slice(k.body, i + 1 < marks.length ? marks[i + 1].at : s.length).trim().replace(/[\s,;]+$/, '')]).filter(x => x[1]);
  const title = s.slice(0, marks[0].at).trim().replace(/[\s,;:–—-]+$/, '');
  /* nothing before the first label: every pair stays, and the title is the Product Name when there is one */
  const named = specs.find(x => /^Product Name$/i.test(x[0]));
  return { title: title || (named ? named[1] : ''), specs };
}

/** The count line under the toolbar: "12 of 48 · ₱1,234,567.00". */
function slmCountLine(shown, total, value, noun) {
  const n = noun || 'record';
  const money = '₱' + (Number(value) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (shown === total ? shown + ' ' + n + (shown === 1 ? '' : 's') : shown + ' of ' + total + ' ' + n + 's') + (value ? ' · ' + money : '');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SLM_AGES, slmMonthKey, slmMonthLabel, slmDaysSince, slmAge, slmAgeLabel, slmAgo, slmClientKey, slmSearch, slmSort,
                     slmChipCounts, slmGroup, slmCountLine, slmShortItem, slmItemSpecs };
}
