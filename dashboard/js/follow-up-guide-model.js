/* follow-up-guide-model.js — A393 · the follow-up guide, drawn (pure: strings in, strings out; no DOM, no reads).
 *
 * Neil, 4 Nov 2026: each rep's top-50 clients through the week. FlowAPI 196's getFollowUpGuide works the week out
 * (quoted clients first: day 3, 5, 7, 14 after sending, then every 7; then ranks 1–10 Monday … 41–50 Friday, carried
 * over until touched); this file only turns its reply into the card on the rep's home (js/follow-up-guide-card.js)
 * and the week page (js/follow-up-guide.js). A guide, never a form: every button leads to where the rep already works. */
const FUG_DOW_LONG = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
const FUG_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fugEsc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function _fugDow(ymd) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(ymd + 'T00:00:00Z').getUTCDay()]; }
/** 'Wed 4 Nov' */
function fugDayLabel(ymd) { const s = String(ymd || ''); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? _fugDow(s) + ' ' + (+s.slice(8, 10)) + ' ' + FUG_MON[+s.slice(5, 7) - 1] : ''; }
/** '4 Nov' */
function fugShort(ymd) { const s = String(ymd || ''); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? (+s.slice(8, 10)) + ' ' + FUG_MON[+s.slice(5, 7) - 1] : ''; }
/** '₱245,000' */
function fugMoney(v) { const n = Number(v) || 0; return '₱' + Math.round(n).toLocaleString('en-US'); }
/** How a done item was done: 'Call 9:30 AM', 'Visit done · Mon', 'Follow-up · call'. */
function fugHow(by, day) {
  if (!by) return '';
  const t = String(by.time || ''), m = /^(\d{2}):(\d{2})$/.exec(t);
  const clock = m ? ((+m[1] % 12) || 12) + ':' + m[2] + (+m[1] < 12 ? ' AM' : ' PM') : '';
  return [by.kind, by.day && by.day !== day ? _fugDow(by.day) : '', clock].filter(Boolean).join(' · ');
}

/** The ranks a weekday holds: 'ranks 21–30'. */
function fugRanks(g, i) {
  const per = g.perDay || 10, from = i * per + 1, to = i === 4 ? Math.max(g.planSize || 0, from) : Math.min((i + 1) * per, g.planSize || 0);
  if (!g.planSize || from > g.planSize) return '';
  return from === to ? 'rank ' + from : 'ranks ' + from + '–' + to;
}
/** The weekday shown first: today; on a weekend none ('' — the card shows the week instead). */
function fugDefaultDay(g) { const t = (g.days || []).filter(d => d.today)[0]; return t ? t.date : ''; }

/** One weekday's groups, open first and done last within each: [{key, title, items}]. */
function fugGroups(g, date) {
  const d = (g.days || []).filter(x => x.date === date)[0];
  if (!d) return [];
  const sink = (list) => list.slice().sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.rank || 0) - (b.rank || 0));
  const out = [
    { key: 'quotes', title: 'Quotations to follow up', items: sink(d.quotes.concat(d.carryQuotes || [])) },
    { key: 'carry', title: 'Still open from earlier this week', items: sink(d.carryClients || []) },
    { key: 'clients', title: d.today ? 'Today\'s clients' : FUG_DOW_LONG[d.dow] + '\'s clients', items: sink(d.clients) }
  ];
  return out.filter(x => x.items.length);
}
/** What is left of the week (a weekend): the open quotation checkpoints and the clients still untouched. */
function fugLeft(g) {
  const days = g.days || [], q = [], c = [], seen = {};
  days.forEach(d => d.quotes.forEach(x => { if (x.status === 'open' && !seen[x.quotationNo]) { seen[x.quotationNo] = 1; q.push(x); } }));
  days.forEach(d => d.clients.forEach(x => { if (x.status !== 'done') c.push(Object.assign({}, x, { since: d.date })); }));
  return { quotes: q, clients: c };
}

/** The status line under a row's name. */
function fugLine(x, day) {
  if (x.quotationNo) {
    const bits = ['Day ' + x.step, fugMoney(x.value), 'sent ' + fugShort(x.sent)];
    if (x.status === 'done') return 'Done · ' + fugHow(x.by, day);
    if (x.status === 'missed') return 'Missed on ' + fugDayLabel(x.date);
    if (x.status === 'open' && x.date < day) bits.unshift('Due since ' + _fugDow(x.date));
    if (x.lastFollowUp) bits.push('last follow-up ' + fugShort(x.lastFollowUp));
    return bits.join(' · ');
  }
  if (x.status === 'done') return 'Done · ' + fugHow(x.done, day);
  const since = x.since && x.since < day ? 'Open since ' + _fugDow(x.since) + ' · ' : '';
  return since + (x.nextStep || 'No next step yet');
}
function _fugMark(st) {
  if (st === 'done') return '<span class="fg-mark done" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M4 8.5l2.6 2.5L12 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  return '<span class="fg-mark ' + (st === 'missed' ? 'missed' : st === 'planned' ? 'planned' : 'open') + '" aria-hidden="true"></span>';
}
/** One row. o.readOnly hides the buttons (the director or management reading a rep's week). */
function fugRowHtml(x, day, o) {
  o = o || {};
  const st = x.status || 'open', q = !!x.quotationNo;
  const label = q ? x.company + ', quotation ' + x.quotationNo : '#' + x.rank + ' ' + x.company;
  const acts = o.readOnly || st === 'done' || st === 'missed' || st === 'planned' ? '' :
    '<div class="fg-acts">' + (q
      ? '<a class="fg-btn" href="my-daily-report.html?call=' + encodeURIComponent(x.quotationNo) + '">Log call</a><a class="fg-btn quiet" href="quotation-status.html?q=' + encodeURIComponent(x.quotationNo) + '">Update</a>'
      : '<a class="fg-btn" href="my-daily-report.html?client=' + encodeURIComponent(x.clientNo) + '">Log call</a><a class="fg-btn quiet" href="director-client-book.html?client=' + encodeURIComponent(x.clientNo) + '">Open</a>') + '</div>';
  return '<li class="fg-row ' + st + '" aria-label="' + fugEsc(label + ' — ' + (st === 'done' ? 'done' : st)) + '">' + _fugMark(st) +
    '<div class="fg-main"><div class="fg-l1">' + (q ? '' : '<span class="fg-rank">' + x.rank + '</span>') + '<b>' + fugEsc(x.company) + '</b>' +
    (q ? '<span class="fg-ref">' + fugEsc(x.quotationNo) + '</span>' : '') + '</div>' +
    '<div class="fg-l2">' + fugEsc(fugLine(x, day)) + '</div></div>' + acts + '</li>';
}
/** A list of groups. o.foldDone (the home card) folds a group's done rows into one quiet line, so the card stays short;
 *  the week page shows every row. */
function fugGroupsHtml(groups, day, o) {
  o = o || {};
  if (!groups.length) return '<p class="fg-empty">Nothing planned for this day.</p>';
  return groups.map(gr => {
    const done = gr.items.filter(x => x.status === 'done'), shown = o.foldDone ? gr.items.filter(x => x.status !== 'done') : gr.items;
    const fold = o.foldDone && done.length ? '<li class="fg-row done fg-fold">' + _fugMark('done') + '<div class="fg-main"><div class="fg-l2">' + done.length + ' done · ' +
      fugEsc(done.map(x => x.company).join(', ')) + '</div></div></li>' : '';
    return '<section class="fg-sec" data-k="' + gr.key + '"><h4>' + fugEsc(gr.title) + ' <span>' + done.length + ' of ' + gr.items.length + '</span></h4>' +
      '<ul class="fg-list">' + shown.map(x => fugRowHtml(x, day, o)).join('') + fold + '</ul></section>';
  }).join('');
}
/** The week strip: five days as a segmented control, each with done of total. */
function fugStripHtml(g, sel) {
  return (g.days || []).map((d, i) => '<button type="button" role="tab" class="fg-day' + (d.today ? ' now' : '') + (d.total && d.done === d.total ? ' all' : '') +
    '" data-day="' + d.date + '" aria-selected="' + (d.date === sel) + '" tabindex="' + (d.date === sel || (!sel && i === 0) ? 0 : -1) + '" aria-label="' + fugEsc(FUG_DOW_LONG[d.dow] + ' ' + fugShort(d.date) + ', ' + d.done + ' of ' + d.total + ' done') + '">' +
    '<b>' + d.dow + '</b><span>' + (d.total ? d.done + '/' + d.total : '–') + '</span></button>').join('');
}
/** The head line for a day: 'Wednesday · ranks 21–30 of your top 50'. */
function fugSubtitle(g, date, own) {
  const i = (g.days || []).findIndex(d => d.date === date), d = g.days[i];
  if (!d) return '';
  const r = fugRanks(g, i);
  return (d.today ? FUG_DOW_LONG[d.dow] : fugDayLabel(d.date)) + (r ? ' · ' + r + ' of ' + (own ? 'your' : 'the') + ' top ' + (g.planSize || 0) : '');
}
/** done / total of a day, and its share 0..1 */
function fugProgress(g, date) {
  const d = (g.days || []).filter(x => x.date === date)[0] || { done: 0, total: 0 };
  return { done: d.done, total: d.total, share: d.total ? d.done / d.total : 0 };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fugEsc, fugDayLabel, fugShort, fugMoney, fugHow, fugRanks, fugDefaultDay, fugGroups, fugLeft, fugLine, fugRowHtml, fugGroupsHtml, fugStripHtml, fugSubtitle, fugProgress };
}
