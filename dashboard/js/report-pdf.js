/* ═══════════════════════════════════════════════
   report-pdf.js — the shared report PDF renderer + document builders.

   ONE implementation of the proven hidden-iframe html2pdf pattern (first worked out for the payslip
   renderer in director-home.js) and ONE set of HTML builders, so every producer — a rep's own daily
   or weekly report, the management team report, HR's per-person performance report — emits the same
   document design.

   The builders take a MODEL, never DOM. That is what keeps the output identical regardless of which
   page asked for it, and it is what makes them testable without a browser.
   ═══════════════════════════════════════════════ */

const FLOW_PDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
const FLOW_PDF_COMPANY = 'H.O ESTUR CORPORATION';

/* ── The renderer ────────────────────────────────────────────────────────────
   Why an iframe at all: html2canvas must run in the SAME window as the document it captures.
   Running the parent page's html2pdf against an iframe's document yields blank pages — so the
   library is injected into the iframe's own head. The iframe is attached to the real DOM (not
   display:none) because layout has to actually run; it is hidden with opacity instead. */
function _flowPdfRun(opts, terminal) {
  const bodyPx = opts.bodyPx || 820;
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    // ~40px wider than the body so nothing wraps or triggers a scrollbar mid-capture.
    frame.style.cssText = `position:fixed;right:0;bottom:0;width:${bodyPx + 40}px;height:1400px;` +
      'opacity:0;border:0;z-index:-1;';
    document.body.appendChild(frame);

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      try { document.body.removeChild(frame); } catch (e) { /* already gone */ }
    };

    try {
      const win = frame.contentWindow, doc = win.document;
      doc.open();
      doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
        `body{margin:0;background:#fff;width:${bodyPx}px;}</style></head><body>` +
        (opts.html || '') + '</body></html>');
      doc.close();

      const run = () => {
        // Two frames: the first lands after layout, the second after paint. Capturing earlier is
        // exactly how the original off-screen-div approach produced blank pages.
        win.requestAnimationFrame(() => win.requestAnimationFrame(() => {
          try {
            const worker = win.html2pdf().set({
              margin: opts.margin != null ? opts.margin : 8,
              filename: opts.filename || 'report.pdf',
              image: { type: 'jpeg', quality: opts.quality || 0.95 },
              html2canvas: { scale: opts.scale || 2, useCORS: true, backgroundColor: '#ffffff',
                logging: false, windowWidth: bodyPx + 40 },
              jsPDF: { unit: 'mm', format: opts.format || 'a4', orientation: opts.orientation || 'portrait' },
              pagebreak: { mode: ['css', 'legacy'] },
            }).from(win.document.body);
            terminal(worker)
              .then(out => { setTimeout(cleanup, 1500); resolve(out); })
              .catch(err => { cleanup(); reject(err); });
          } catch (err) { cleanup(); reject(err); }
        }));
      };

      // Images (charts, logos) must finish loading or html2canvas paints them blank.
      const gate = () => {
        const imgs = Array.prototype.slice.call(win.document.images).filter(im => !im.complete);
        if (!imgs.length) return run();
        let left = imgs.length, fired = false;
        const go = () => { if (!fired) { fired = true; run(); } };
        imgs.forEach(im => {
          const tick = () => { if (--left <= 0) go(); };
          im.addEventListener('load', tick);
          im.addEventListener('error', tick);
        });
        setTimeout(go, 3000);              // a stalled image must never block the render
      };

      if (win.html2pdf) gate();
      else {
        const s = doc.createElement('script');
        s.src = FLOW_PDF_CDN;
        s.onload = gate;
        s.onerror = () => { cleanup(); reject(new Error('Could not load the PDF library.')); };
        doc.head.appendChild(s);
      }
    } catch (err) { cleanup(); reject(err); }

    setTimeout(cleanup, 15000);            // safety net: a save() that never settles can't leak the iframe
  });
}

/** Render a self-contained HTML string to a downloaded PDF. */
function flowReportPdf(opts) {
  return _flowPdfRun(opts, worker => worker.save());
}

/** Same pipeline, but resolves to base64 — for archiving a report to Drive instead of downloading. */
function flowReportPdfBase64(opts) {
  return _flowPdfRun(opts, worker => worker.outputPdf('datauristring')
    .then(uri => String(uri).substring(String(uri).indexOf('base64,') + 7)));
}

/* ── Shared document CSS (inline: an iframe document inherits nothing) ────── */
const FLOW_PDF_CSS = `
  *{box-sizing:border-box;}
  body{font-family:Helvetica,Arial,sans-serif;color:#1f2937;font-size:12px;line-height:1.5;}
  .wrap{padding:22px 26px;}
  .hd{text-align:center;border-bottom:2px solid #0d9488;padding-bottom:10px;margin-bottom:16px;}
  .hd .co{font-size:17px;font-weight:800;letter-spacing:.06em;color:#0f172a;}
  .hd .ti{font-size:13px;font-weight:700;color:#0d9488;margin-top:3px;text-transform:uppercase;letter-spacing:.08em;}
  .hd .sub{font-size:11px;color:#6b7280;margin-top:4px;}
  .who{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:7px;}
  .who .nm{font-size:15px;font-weight:700;color:#0f172a;}
  .role{display:inline-block;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;
        padding:2px 8px;border-radius:999px;color:#fff;}
  .sec{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#0d9488;
       border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin:18px 0 9px;}
  .tiles{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:6px;}
  .tile{flex:1 1 92px;min-width:88px;border:1px solid #e5e7eb;border-radius:7px;padding:7px 9px;background:#f9fafb;}
  .tile .l{font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;}
  .tile .v{font-size:15px;font-weight:800;color:#0f172a;margin-top:2px;}
  .tile.good .v{color:#15803d;} .tile.warn .v{color:#b45309;}
  table{width:100%;border-collapse:collapse;margin-bottom:8px;}
  th{background:#f3f4f6;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;
     color:#374151;text-align:left;padding:5px 7px;border:1px solid #e5e7eb;}
  td{font-size:10.5px;padding:5px 7px;border:1px solid #eef0f3;vertical-align:top;}
  td.n,th.n{text-align:right;}
  tr.tot td{font-weight:800;background:#f9fafb;}
  .two{display:flex;gap:14px;align-items:flex-start;}
  .two .l{flex:1 1 58%;} .two .r{flex:1 1 42%;}
  .chart img{width:100%;max-width:430px;border:1px solid #eef0f3;border-radius:6px;}
  .card{border:1px solid #e5e7eb;border-radius:9px;padding:12px 14px;margin-bottom:11px;page-break-inside:avoid;}
  .card .ch{display:flex;align-items:center;gap:8px;margin-bottom:7px;}
  .card .ch .nm{font-size:13px;font-weight:800;color:#0f172a;}
  .card .ch .mt{margin-left:auto;font-size:10px;color:#6b7280;}
  .sub-block{page-break-inside:avoid;border-left:3px solid #0d9488;background:#f9fafb;padding:9px 12px;
             border-radius:0 7px 7px 0;margin-bottom:9px;}
  .sub-block .dt{font-size:11px;font-weight:800;color:#0f172a;margin-bottom:5px;}
  .sub-block .lb{font-size:8.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#0d9488;margin-top:6px;}
  .sub-block .tx{font-size:10.5px;color:#374151;white-space:pre-wrap;}
  .muted{color:#9ca3af;font-style:italic;font-size:10.5px;}
  .days{display:flex;gap:5px;margin-top:8px;}
  .day{flex:1;border:1px solid #e5e7eb;border-radius:6px;padding:5px 3px;text-align:center;background:#fff;}
  .day .d{font-size:8.5px;font-weight:800;color:#6b7280;text-transform:uppercase;}
  .day .v{font-size:12px;font-weight:800;color:#0f172a;}
  .day .s{font-size:8.5px;margin-top:1px;}
  .day.on{background:#f0fdfa;border-color:#99f6e4;}
  .signoff{display:flex;gap:26px;margin-top:22px;page-break-inside:avoid;}
  .signoff div{flex:1;font-size:10px;color:#6b7280;}
  .signoff .ln{border-bottom:1px solid #9ca3af;height:26px;margin-bottom:4px;}
  .foot{margin-top:16px;padding-top:8px;border-top:1px solid #e5e7eb;text-align:center;
        font-size:9px;color:#9ca3af;}
  .pgbrk{page-break-before:always;}
`;

const _FPD_ROLE_COLOR = { sales: '#0d9488', accounting: '#7c3aed', admin: '#2563eb',
  management: '#b45309', director: '#b45309', marketing: '#db2777', hr: '#0891b2' };

function _fpdEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _fpdNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function _fpdMoney(v) { return '₱' + _fpdNum(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function _fpdRole(role) {
  const r = String(role || '').toLowerCase();
  if (!r) return '';
  return `<span class="role" style="background:${_FPD_ROLE_COLOR[r] || '#64748b'};">${_fpdEsc(r)}</span>`;
}
function _fpdHead(title, sub, name, role) {
  return `<div class="hd">
    <div class="co">${FLOW_PDF_COMPANY}</div>
    <div class="ti">${_fpdEsc(title)}</div>
    ${name ? `<div class="who"><span class="nm">${_fpdEsc(name)}</span>${_fpdRole(role)}</div>` : ''}
    <div class="sub">${_fpdEsc(sub)}</div>
  </div>`;
}
function _fpdFoot(generatedAt) {
  return `<div class="foot">Generated ${_fpdEsc(generatedAt || (typeof flowToday === 'function' ? flowToday() : ''))}
    · HI-ESCORP Portal · system-generated from recorded activity</div>`;
}
function _fpdSignoff(name) {
  return `<div class="signoff">
    <div><div class="ln"></div>Prepared by: ${_fpdEsc(name || '')} (system-generated)</div>
    <div><div class="ln"></div>Reviewed by</div>
    <div><div class="ln"></div>Date</div>
  </div>`;
}
function _fpdTile(label, value, cls) {
  return `<div class="tile${cls ? ' ' + cls : ''}"><div class="l">${_fpdEsc(label)}</div><div class="v">${_fpdEsc(value)}</div></div>`;
}

/** The headline tile strip. Amounts are dropped entirely when the viewer may not see money (HR). */
function _fpdTotalTiles(t, hideAmounts) {
  t = t || {};
  const tiles = [
    _fpdTile('Movements', _fpdNum(t.moves).toLocaleString()),
    _fpdTile('Calls', _fpdNum(t.calls).toLocaleString()),
    _fpdTile('Emails Sent', _fpdNum(t.emails).toLocaleString()),
    _fpdTile('Documents', _fpdNum(t.docs).toLocaleString()),
    _fpdTile('PDFs', _fpdNum(t.pdfs).toLocaleString()),
  ];
  if (t.reportableDays) {
    const full = _fpdNum(t.submitted) >= _fpdNum(t.reportableDays);
    tiles.push(_fpdTile('Reports Submitted', `${_fpdNum(t.submitted)}/${_fpdNum(t.reportableDays)}`, full ? 'good' : 'warn'));
  }
  if (!hideAmounts && _fpdNum(t.amount) > 0) tiles.push(_fpdTile(t.amountLabel || 'Amount', _fpdMoney(t.amount)));
  return `<div class="tiles">${tiles.join('')}</div>`;
}

/** Chart image beside the same numbers as a table — the table is what survives greyscale printing
 *  and a blocked chart CDN, so it is never optional. */
function _fpdTasksBlock(tasks, chartImg) {
  const rows = (tasks || []).map(t => `<tr><td>${_fpdEsc(t[0])}</td><td class="n">${_fpdNum(t[1]).toLocaleString()}</td></tr>`).join('');
  const table = `<table><thead><tr><th>Task</th><th class="n">Count</th></tr></thead><tbody>${rows ||
    '<tr><td colspan="2" class="muted">No activity recorded.</td></tr>'}</tbody></table>`;
  if (!chartImg) return table;
  return `<div class="two"><div class="l chart"><img src="${chartImg}" alt=""></div><div class="r">${table}</div></div>`;
}

function _fpdDayStrip(days) {
  if (!days || !days.length) return '';
  return `<div class="days">${days.map(d => `<div class="day${d.submitted ? ' on' : ''}">
    <div class="d">${_fpdEsc(d.dayName)}</div>
    <div class="v">${d.future ? '—' : _fpdNum(d.moves)}</div>
    <div class="s">${d.future ? '' : (d.submitted ? '✓ report' : '— no report')}</div>
  </div>`).join('')}</div>`;
}

/** One submitted day's narrative. A day with no submission renders an explicit muted line — the
 *  absence is itself the information management and HR need. */
function _fpdSubmissions(subs, days) {
  const byDate = {};
  (subs || []).forEach(s => { byDate[s.date] = s; });
  const list = (days && days.length) ? days.filter(d => !d.future).map(d => ({ date: d.date, rec: byDate[d.date] }))
                                     : (subs || []).map(s => ({ date: s.date, rec: s }));
  if (!list.length) return '<div class="muted">No days in range.</div>';
  return list.map(({ date, rec }) => {
    if (!rec) return `<div class="sub-block"><div class="dt">${_fpdEsc(date)}</div><div class="muted">No report submitted.</div></div>`;
    const part = (label, text) => text ? `<div class="lb">${label}</div><div class="tx">${_fpdEsc(text)}</div>` : '';
    const body = part('Highlights', rec.highlights) + part('Blockers', rec.blockers) +
                 part('Plan', rec.plan) + part('Notes', rec.notes);
    return `<div class="sub-block">
      <div class="dt">${_fpdEsc(date)}${rec.submittedAt ? ` <span class="muted">· submitted ${_fpdEsc(rec.submittedAt)}${_fpdNum(rec.submitCount) > 1 ? ` · updated ${_fpdNum(rec.submitCount)}×` : ''}</span>` : ''}</div>
      ${body || '<div class="muted">Submitted with no written notes.</div>'}
    </div>`;
  }).join('');
}

function _fpdDetail(detail, hideAmounts) {
  if (!detail || !detail.length) return '';
  return detail.filter(d => d.rows && d.rows.length).map(d => `
    <div class="card"><div class="ch"><span class="nm">${_fpdEsc(d.date)}</span><span class="mt">${d.rows.length} movement(s)</span></div>
    <table><thead><tr><th>Time</th><th>Module</th><th>Action</th><th>Reference</th><th>Detail</th>${hideAmounts ? '' : '<th class="n">Amount</th>'}</tr></thead>
    <tbody>${d.rows.map(r => `<tr><td>${_fpdEsc(r.time)}</td><td>${_fpdEsc(r.module)}</td><td>${_fpdEsc(r.action)}</td>
      <td>${_fpdEsc(r.refNo)}</td><td>${_fpdEsc(r.summary)}</td>${hideAmounts ? '' : `<td class="n">${_fpdNum(r.amount) ? _fpdMoney(r.amount) : ''}</td>`}</tr>`).join('')}</tbody></table></div>`).join('');
}

/* ── Document 1: one person, one week ─────────────────────────────────────── */
function flowPersonWeekHtml(m) {
  m = m || {};
  const hide = !!m.hideAmounts;
  return `<style>${FLOW_PDF_CSS}</style><div class="wrap">
    ${_fpdHead('Weekly Performance Report', `${_fpdEsc(m.weekStart)} — ${_fpdEsc(m.weekEnd)}`, m.name, m.role)}
    <div class="sec">Summary</div>
    ${_fpdTotalTiles(m.totals, hide)}
    <div class="sec">Task Breakdown</div>
    ${_fpdTasksBlock(m.tasks, m.chartImg)}
    <div class="sec">Daily Activity</div>
    ${_fpdDayStrip(m.days)}
    <div class="pgbrk"></div>
    <div class="sec">Daily Submissions</div>
    ${_fpdSubmissions(m.submissions, m.days)}
    ${m.detail && m.detail.length ? `<div class="sec">Activity Detail</div>${_fpdDetail(m.detail, hide)}` : ''}
    ${_fpdSignoff(m.name)}
    ${_fpdFoot(m.generatedAt)}
  </div>`;
}

/* ── Document 2: the whole team, one week ─────────────────────────────────── */
function flowTeamWeekHtml(m) {
  m = m || {};
  const hide = !!m.hideAmounts;
  const people = m.people || [];
  const org = m.orgTotals || {};
  const orgTiles = [
    _fpdTile('Team Members', String(people.length)),
    _fpdTile('Movements', _fpdNum(org.moves).toLocaleString()),
    _fpdTile('Calls', _fpdNum(org.calls).toLocaleString()),
    _fpdTile('Emails Sent', _fpdNum(org.emails).toLocaleString()),
    _fpdTile('Documents', _fpdNum(org.docs).toLocaleString()),
  ];
  if (org.reportableDays) {
    const pct = org.reportableDays ? Math.round((_fpdNum(org.submitted) / _fpdNum(org.reportableDays)) * 100) : 0;
    orgTiles.push(_fpdTile('Reports Submitted', `${_fpdNum(org.submitted)}/${_fpdNum(org.reportableDays)}`, pct >= 100 ? 'good' : 'warn'));
    orgTiles.push(_fpdTile('Compliance', pct + '%', pct >= 80 ? 'good' : 'warn'));
  }
  // The comparison table is the point of a TEAM report — without it the reader has to page through
  // N cards to compare two people.
  const summary = `<table>
    <thead><tr><th>Person</th><th>Role</th><th class="n">Movements</th><th class="n">Calls</th>
      <th class="n">Emails</th><th class="n">Docs</th><th class="n">Submitted</th></tr></thead>
    <tbody>${people.map(p => `<tr>
      <td>${_fpdEsc(p.name)}</td><td>${_fpdEsc(p.role || '—')}</td>
      <td class="n">${_fpdNum(p.totals && p.totals.moves).toLocaleString()}</td>
      <td class="n">${_fpdNum(p.totals && p.totals.calls).toLocaleString()}</td>
      <td class="n">${_fpdNum(p.totals && p.totals.emails).toLocaleString()}</td>
      <td class="n">${_fpdNum(p.totals && p.totals.docs).toLocaleString()}</td>
      <td class="n">${_fpdNum(p.totals && p.totals.submitted)}/${_fpdNum((p.totals && p.totals.reportableDays) || 0)}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted">No team activity in this week.</td></tr>'}</tbody></table>`;

  const cards = people.map((p, i) => `
    <div class="${i === 0 ? '' : 'pgbrk'}">
      <div class="sec">${_fpdEsc(p.name)} — ${_fpdEsc(p.role || 'team member')}</div>
      ${_fpdTotalTiles(p.totals, hide)}
      ${_fpdTasksBlock(p.tasks, p.chartImg)}
      ${_fpdDayStrip(p.days)}
      <div class="sec">Submissions This Week</div>
      ${_fpdSubmissions(p.submissions, p.days)}
    </div>`).join('');

  return `<style>${FLOW_PDF_CSS}</style><div class="wrap">
    ${_fpdHead('Team Weekly Performance', `${_fpdEsc(m.weekStart)} — ${_fpdEsc(m.weekEnd)}`)}
    <div class="sec">Organization Summary</div>
    <div class="tiles">${orgTiles.join('')}</div>
    <div class="sec">Team Summary</div>
    ${summary}
    ${cards ? `<div class="pgbrk"></div>${cards}` : ''}
    ${_fpdFoot(m.generatedAt)}
  </div>`;
}

/* ── Document 3: one person, one day ──────────────────────────────────────── */
function flowPersonDayHtml(m) {
  m = m || {};
  const hide = !!m.hideAmounts;
  const sections = (m.modules || []).filter(s => s.rows && s.rows.length).map(s => `
    <div class="card"><div class="ch"><span class="nm">${_fpdEsc(s.module)}</span><span class="mt">${s.rows.length} item(s)</span></div>
      <table><thead><tr><th>Time</th><th>Action</th><th>Reference</th><th>Detail</th>${hide ? '' : '<th class="n">Amount</th>'}</tr></thead>
      <tbody>${s.rows.map(r => `<tr><td>${_fpdEsc(r.time)}</td><td>${_fpdEsc(r.action)}</td><td>${_fpdEsc(r.refNo)}</td>
        <td>${_fpdEsc(r.summary)}</td>${hide ? '' : `<td class="n">${_fpdNum(r.amount) ? _fpdMoney(r.amount) : ''}</td>`}</tr>`).join('')}</tbody></table>
    </div>`).join('');

  const calls = (m.calls && m.calls.length) ? `<div class="sec">Call Log</div>
    <table><thead><tr><th>Time</th><th>Contact</th><th>Company</th><th>Outcome</th><th>Notes</th></tr></thead>
    <tbody>${m.calls.map(c => `<tr><td>${_fpdEsc(c.time)}</td><td>${_fpdEsc(c.contact)}</td><td>${_fpdEsc(c.company)}</td>
      <td>${_fpdEsc(c.outcome)}</td><td>${_fpdEsc(c.notes)}</td></tr>`).join('')}</tbody></table>` : '';

  const emails = (m.emails && m.emails.length) ? `<div class="sec">Sent Emails</div>
    <table><thead><tr><th>Time</th><th>To</th><th>Subject</th></tr></thead>
    <tbody>${m.emails.map(e => `<tr><td>${_fpdEsc(e.time)}</td><td>${_fpdEsc(e.to)}</td><td>${_fpdEsc(e.subject)}</td></tr>`).join('')}</tbody></table>` : '';

  const sub = m.submission;
  const part = (label, text) => text ? `<div class="lb">${label}</div><div class="tx">${_fpdEsc(text)}</div>` : '';
  const narrative = sub
    ? `<div class="sub-block"><div class="dt">Submitted ${_fpdEsc(sub.submittedAt || '')}${_fpdNum(sub.submitCount) > 1 ? ` · updated ${_fpdNum(sub.submitCount)}×` : ''}</div>
        ${part('Highlights', sub.highlights) + part('Blockers', sub.blockers) + part('Plan', sub.plan) + part('Notes', sub.notes)
          || '<div class="muted">Submitted with no written notes.</div>'}</div>`
    : `<div class="sub-block"><div class="muted">This day has not been submitted yet.</div>
        ${m.notes ? `<div class="lb">Working notes</div><div class="tx">${_fpdEsc(m.notes)}</div>` : ''}</div>`;

  return `<style>${FLOW_PDF_CSS}</style><div class="wrap">
    ${_fpdHead('Daily Report', _fpdEsc(m.date), m.name, m.role)}
    <div class="sec">Summary</div>
    ${_fpdTotalTiles(m.totals, hide)}
    ${sections ? `<div class="sec">Activity by Module</div>${sections}` : '<div class="muted">No recorded movements for this day.</div>'}
    ${calls}
    ${emails}
    <div class="sec">Report Notes</div>
    ${narrative}
    ${_fpdSignoff(m.name)}
    ${_fpdFoot(m.generatedAt)}
  </div>`;
}
