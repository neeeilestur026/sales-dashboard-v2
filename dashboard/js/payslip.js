/* A312 — the payslip, rendered in ONE place.
 *
 * Until A312 the receipt stylesheet and the HTML builder lived inside director-home.js, which could
 * only draw a payslip from the director page's own in-memory hours and register. The employee's
 * "My payslip" ticket (js/my-payslip-card.js) draws the SAME receipt from the figures the director
 * released, so the builder takes the computed figures as data: `s` is the _computePaySlip object,
 * `pr` is { label, range }, and opts.footer replaces the "Generated <now>" line (the ticket prints
 * "Released <when>" instead). Everything else is byte-identical to the director's PDF.
 *
 * Loaded before director-home.js (which keeps _payslipHtml as a one-line delegation and the pinned
 * _PAYSLIP_CSS name as an alias) and on every home page that carries the ticket. */
const HX_PAYSLIP_CSS = `
.payslip { font-family:'Courier New', Courier, monospace; color:#000; width:100%; box-sizing:border-box; padding:8px 12px; font-size:11px; line-height:1.4; }
.payslip .ps-head { text-align:center; margin-bottom:4px; }
.payslip .ps-co { font-size:13px; font-weight:800; letter-spacing:0.3px; }
.payslip .ps-logo { display:block; margin:5px auto 2px; height:48px; max-width:70%; object-fit:contain; }
.payslip .ps-doc { font-size:11px; font-weight:700; letter-spacing:3px; margin-top:2px; }
.payslip .ps-sep { border-top:1px dashed #000; margin:6px 0; }
.payslip .ps-kv { font-size:10px; margin:1px 0; word-break:break-word; }
.payslip .ps-kv b { font-weight:700; }
.payslip .ps-sec { font-weight:700; text-transform:uppercase; font-size:10px; letter-spacing:0.05em; margin:2px 0; }
.payslip .ps-t { width:100%; border-collapse:collapse; table-layout:fixed; }
.payslip .ps-t td { padding:1px 0; font-size:11px; vertical-align:top; }
.payslip .ps-t td.l { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding-right:8px; }
/* A275 — the deduction's sub-line. It CANNOT be a .l cell: that is nowrap + overflow:hidden inside a
   table-layout:fixed table, so on a 400px receipt it silently cut the sentence at about 37 characters
   — "ASUS VIVOBOOK 15 · P47,911.87 left of" and then nothing. This spans both columns and wraps. */
.payslip .ps-t td.ps-note { white-space:normal; word-break:break-word; padding:0 0 2px 10px; font-size:9px; line-height:1.35; color:#333; }
.payslip .ps-t td.r { width:42%; text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
.payslip .ps-t tr.sub td { font-weight:800; }
.payslip .ps-net-t td { font-weight:800; font-size:14px; padding:3px 0; }
.payslip .ps-net-t td.r { width:50%; }
.payslip .ps-sign { margin-top:22px; font-size:9px; text-align:center; }
.payslip .ps-sign .ln { border-top:1px solid #000; margin:0 6px; padding-top:2px; }
.payslip .ps-foot { text-align:center; font-size:8px; color:#333; margin-top:8px; }
`;

/* The director page's peso(), copied exactly (locale undefined) so both renders format alike. */
function hxPeso(value) {
  return '₱' + (Number(value) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

function hxPayslipHtml(s, pr, opts) {
  const footer = (opts && opts.footer) || ('Generated ' + new Date().toLocaleString('en-PH'));
  const hn = n => (Math.round((n || 0) * 10) / 10).toFixed(1) + ' hrs';
  const totalHrs = s.regHrs + s.otHrs + s.holidayHrs;
  // Fixed 2-column table rows: the amount column has a set width so it can never run off the page edge.
  const row = (label, val, cls) => `<tr${cls ? ` class="${cls}"` : ''}><td class="l">${hxEscBlank(label)}</td><td class="r">${val}</td></tr>`;
  const money = (label, val, cls) => row(label, hxPeso(val), cls);
  /* A259 — the rate is no longer hard-coded into the label. This said "Holiday (Nh x2)" whatever
     had actually been applied, which is wrong on every special non-working day. Only the lines that
     carry money are printed; a period with no holidays shows a single zero Holiday line exactly as
     it always did, so nothing changes on an ordinary payslip. */
  /* The label column is nowrap with an ellipsis at 58% of the receipt — on the real 400px width that
     is 210px, about 31 characters at 11px Courier. "Regular Holiday (8.0 hrs x2)" overflows it and
     renders as "Regular Holiday (8.0 hr…", which hides the very rate the line exists to state. A
     compact hour form keeps every label inside the column instead of widening a rule that ~100 filed
     payslips lay out against.
     (A275 — this said "296px". _PS_BODY_PX has been 400 since it was introduced; the same wrong
     figure in the render comment below is what made A262 believe payslips were unaffected by it.) */
  const hc = n => (Math.round((n || 0) * 10) / 10).toFixed(1) + 'h';
  /* A275 — one line per agreement, NAMED, with what is still owed underneath.
     A bare "Salary Deduction 2,916.25" is exactly the figure an employee cannot check, and the whole
     reason the paper form exists is that they agreed to a specific total. Two concurrent deductions
     therefore print as two lines rather than one sum — `money()` renders one label and one figure, so
     the balance rides along as a sub-row of its own. */
  const sdRows = (s.salaryDeductionLines && s.salaryDeductionLines.length)
    ? s.salaryDeductionLines.map(l => {
        const left = (l.remainingBefore || 0) - (l.amount || 0);
        const sub = (l.totalAmount)
          ? `<tr><td class="ps-note" colspan="2">${hxEscBlank(l.item || 'Salary deduction')} &middot; ${
               hxPeso(left)} left of ${hxPeso(l.totalAmount)}</td></tr>`
          : '';
        return money('Salary Deduction', l.amount) + sub;
      }).join('')
    : money('Salary Deduction', s.salaryDeduction || 0);
  const holidayRows = (s.regHolPay || s.speHolPay || s.unworkedHolPay)
    ? [
        s.regHolPay      ? money('Reg Holiday (' + hc(s.regHolHrs) + ' x2)', s.regHolPay) : '',
        s.speHolPay      ? money('Spcl Holiday (' + hc(s.speHolHrs) + ' x1.3)', s.speHolPay) : '',
        s.unworkedHolPay ? money('Unworked Holiday (' + s.unworkedHolDays + ' day'
                                 + (s.unworkedHolDays === 1 ? '' : 's') + ')', s.unworkedHolPay) : ''
      ].filter(Boolean).join('')
    : money('Holiday', s.holidayPay);
  return `<div class="payslip">
    <div class="ps-head"><div class="ps-co">H.O ESTUR CORPORATION</div>
      <img class="ps-logo" src="${location.origin}/images/logo-login-2x.png" alt="" onerror="this.style.display='none'">
      <div class="ps-doc">PAYSLIP</div></div>
    <div class="ps-sep"></div>
    <div class="ps-kv"><b>Employee:</b> ${hxEscBlank(s.empName)}</div>
    <div class="ps-kv"><b>Period:</b> ${hxEscBlank(pr.label)}</div>
    <div class="ps-kv"><b>Coverage:</b> ${hxEscBlank(pr.range)}</div>
    ${s.isFixed
      ? `<div class="ps-kv"><b>Rate:</b> ${hxPeso(s.fixedAmount)} fixed / cutoff</div>
         <div class="ps-kv" style="font-weight:700;">FIXED SALARY &mdash; hours not applied</div>`
      : `<div class="ps-kv"><b>Rate:</b> ${hxPeso(s.dailyRate)}/day &middot; ${hxPeso(s.hourlyRate)}/hr</div>`}
    <div class="ps-sep"></div>
    <div class="ps-sec">Hours Worked</div>
    <table class="ps-t"><tbody>
      ${s.isFixed
        ? row('Hours Recorded', hn(s.recordedHrs), 'sub')
        : `${row('Regular', hn(s.regHrs))}
           ${row('Overtime', hn(s.otHrs))}
           ${row('Holiday', hn(s.holidayHrs))}
           ${row('Total Hours', hn(totalHrs), 'sub')}`}
    </tbody></table>
    <div class="ps-sep"></div>
    <div class="ps-sec">Earnings</div>
    <table class="ps-t"><tbody>
      ${s.isFixed ? money('Fixed Salary', s.basicPay) : money('Basic Pay (' + hn(s.regHrs) + ')', s.basicPay)}
      ${money('Overtime (' + hn(s.otHrs) + ' x1.25)', s.otPay)}
      ${holidayRows}
      ${money('Other Income', s.otherIncome)}
      ${money('Incentive', s.incentive)}
      ${money('GROSS PAY', s.grossPay, 'sub')}
    </tbody></table>
    <div class="ps-sep"></div>
    <div class="ps-sec">Deductions</div>
    <table class="ps-t"><tbody>
      ${money('Pag-IBIG', s.pagibig)}
      ${money('SSS', s.sss)}
      ${money('PhilHealth', s.philhealth)}
      ${money('Advances', s.advances)}
      ${sdRows}
      ${money('Withholding Tax', s.wtax)}
      ${money('TOTAL DEDUCTIONS', s.totalDed, 'sub')}
    </tbody></table>
    <div class="ps-sep"></div>
    <table class="ps-t ps-net-t"><tbody><tr><td class="l">NET PAY</td><td class="r">${hxPeso(s.netPay)}</td></tr></tbody></table>
    <div class="ps-sep"></div>
    <div class="ps-sign"><div class="ln">Received by &mdash; ${hxEscBlank(s.empName)}</div></div>
    <div class="ps-foot">${hxEscBlank(footer)}<br>System-generated payslip</div>
  </div>`;
}

/* ── A313 — the PDF, rendered in ONE place too ────────────────────────────────────────────────
 * Moved verbatim from director-home.js so the employee's "Download PDF" (home card, My payslips
 * page) produces exactly the file the director prints. Loaded on demand from cdnjs, inside a
 * same-origin iframe; the CSP allows that on every page. */
// Load html2pdf on demand (same CDN as the payroll-approval PDF), then run cb.
// Render the payslip HTML in a hidden same-origin iframe, then run html2pdf INSIDE that iframe
// (waiting two animation frames so it's laid out/painted) and download. Mirrors the working
// _renderPayrollSnapshotPdfBase64 pattern in management-home.js — the off-screen <div> approach
// produced blank pages because html2canvas captured before layout/paint.
const HX_HTML2PDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';

// Receipt size: 80mm wide. singleMeasure=true fits the page height to one receipt (no trailing
// whitespace); false uses a fixed page with page-breaks (one receipt per page for "all").
const HX_PS_BODY_PX = 400;   // receipt render width in px (~106mm at 96dpi — "a little wider" than 80mm)

/* A261 — `opts` lets a caller supply its own stylesheet and body width so the payroll cutoff can
   reuse this instead of owning a second, worse PDF path. Everything that makes this function worth
   reusing stays: the page is sized from the RENDERED content so nothing is cropped, images are
   waited for before capture, and the iframe is cleaned up on every exit including failure.
   Omitting opts reproduces the payslip behaviour byte for byte. */
function hxRenderPayslipPdf(innerHtml, filename, singleMeasure, opts) {
  opts = opts || {};
  const css    = (opts.css !== undefined) ? opts.css : HX_PAYSLIP_CSS;
  const bodyPx = opts.bodyPx || HX_PS_BODY_PX;
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:' + (bodyPx + 40) + 'px;height:1600px;opacity:0;border:0;z-index:-1;';
  document.body.appendChild(iframe);
  let done = false;
  const cleanup = () => { if (!done) { done = true; try { document.body.removeChild(iframe); } catch (e) {} } };

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  /* A261 — `fitContent` treats bodyPx as a MINIMUM and lets the body grow to whatever the content
     actually needs, so the page derived from scrollWidth below can never be narrower than the
     document. A payslip is a fixed-width receipt and keeps the exact width it asks for. */
  const widthCss = opts.fitContent
    ? 'width:max-content;min-width:' + bodyPx + 'px;'
    : 'width:' + bodyPx + 'px;';
  doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + css +
    ' body{margin:0;background:#fff;' + widthCss + '}</style></head><body>' + innerHtml + '</body></html>');
  doc.close();
  const win = iframe.contentWindow;

  const run = () => win.requestAnimationFrame(() => win.requestAnimationFrame(() => {
    try {
      // Derive the PDF page from the ACTUAL rendered content size (1px = 1/96in) so the page is exactly
      // as wide as the content — html2pdf renders unscaled, so a too-narrow page crops the right column.
      const px2mm = 25.4 / 96, margin = 6;
      const wpx = win.document.body.scrollWidth || bodyPx;
      const hpx = win.document.body.scrollHeight || 1000;
      /* A275 — CEIL, NOT ROUND, PLUS A MILLIMETRE.
         Rounding down made the page fractionally SMALLER than the artwork it was sized for, and this
         page has no other slack — html2pdf then paginates on the overflow. A payslip measured 687px
         tall, the canvas came back 2061px, html2pdf's page held 2060, and every payslip carried a
         second page containing a single row of pixels. The 1mm is for that rasterising rounding: the
         canvas height is not exactly hpx * scale, so matching the page to the CSS height to the
         nearest millimetre is not close enough. */
      const pageW = Math.ceil(wpx * px2mm) + margin * 2;
      const pageH = singleMeasure ? Math.max(120, Math.ceil(hpx * px2mm) + margin * 2 + 1) : (opts.pageH || 245);
      /* A262 — TELL html2canvas HOW BIG THE DOCUMENT IS.
         Left to itself it sizes the capture from html2pdf's own page-derived container, and for a
         document wider than that container it silently captures only part of it: on the live August
         2026 payroll the body is 1400px wide and the canvas came out 874px — 62% — which html2pdf
         then stretched across the full page. That is the cropped export, and it is why every column
         past the 23rd and the third signature block were missing.

         The measurements above already exist to size the page; they size the capture too. Guarded on
         non-zero because html2pdf MUTATES the body while rendering — reading scrollWidth back
         afterwards returns 0 — and passing a zero here would be worse than passing nothing.

         Payslips are unaffected either way: measured 401x619 before and 400x618 after.

         A275 — that "unaffected" was wrong, and the measurement above says so: 401x619 -> 400x618 is
         the clone being re-laid-out, not a no-op. The guard `wpx > 0 && hpx > 0` is always true, so
         the payslip took this change too, and with x/y left to default it lost its entire 12px left
         padding and a slice of every left-aligned glyph. The origin is now pinned below. The original
         note here also called the receipt 296px; HX_PS_BODY_PX has been 400 since it was introduced,
         so the "well inside the container" reasoning was never true of the width it describes. */
      const canvasOpts = { scale: 3, useCORS: true, backgroundColor: '#ffffff', logging: false };
      if (wpx > 0 && hpx > 0) {
        canvasOpts.width = wpx; canvasOpts.height = hpx;
        canvasOpts.windowWidth = wpx; canvasOpts.windowHeight = hpx;
        /* A275 — PIN THE CAPTURE ORIGIN. Giving html2canvas a width/height without an origin leaves
           x/y defaulting to the element's measured bounds, which were taken in the real 440px iframe
           while windowWidth re-lays the clone out at 400px. The two disagree, the capture window
           lands to the right of the artwork, and the left edge is sliced off. */
        canvasOpts.x = 0; canvasOpts.y = 0;
        canvasOpts.scrollX = 0; canvasOpts.scrollY = 0;
      }
      win.html2pdf().set({
        margin: margin, filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: canvasOpts,
        /* A262 — jsPDF NORMALISES the format to the orientation, so a hard-coded 'portrait' swaps a
           wide format: [382, 243] came back as a 243 x 382 page, and the payroll — which is wider
           than it is tall — was squeezed onto a third of a tall sheet. Derive it from the shape we
           actually measured. A payslip is taller than wide and stays portrait, unchanged. */
        jsPDF: { unit: 'mm', format: [pageW, pageH],
                 orientation: pageW > pageH ? 'landscape' : 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      }).from(win.document.body).save()
        .then(() => setTimeout(cleanup, 1500))
        .catch((err) => { cleanup(); alert('Failed to generate the ' + (opts.what || 'payslip') + ' PDF: ' + (err && err.message || err)); });
    } catch (err) { cleanup(); alert('Failed to generate the ' + (opts.what || 'payslip') + ' PDF.'); }
  }));

  // Wait for images (the logo) to finish loading before capturing, else html2canvas paints them blank.
  const gate = () => {
    const imgs = Array.prototype.slice.call(win.document.images || []);
    const pending = imgs.filter(im => !im.complete);
    if (!pending.length) { run(); return; }
    let left = pending.length, fired = false;
    const go = () => { if (!fired) { fired = true; run(); } };
    pending.forEach(im => { im.addEventListener('load', () => { if (--left <= 0) go(); });
      im.addEventListener('error', () => { if (--left <= 0) go(); }); });
    setTimeout(go, 3000);   // fallback so a slow/failed image never blocks the download
  };

  if (win.html2pdf) { gate(); }
  else {
    const sc = doc.createElement('script');
    sc.src = HX_HTML2PDF_CDN;
    sc.onload = gate;
    sc.onerror = () => { cleanup(); alert('Could not load the PDF library — check your connection and try again.'); };
    doc.head.appendChild(sc);
  }
  // Safety net if save() never resolves.
  setTimeout(cleanup, 15000);
}


/* One released payslip → the same PDF the director gets, named the same way. */
function hxPayslipDownload(row) {
  if (!row || !row.slip || !row.slip.s) return;
  const s = row.slip.s, pr = row.slip.pr || { label: row.period, range: '' };
  const safe = String(s.empName || row.employee || 'payslip').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
  const footer = 'Released ' + String(row.releasedAt || '').slice(0, 16) + (row.releasedBy ? ' by ' + row.releasedBy : '');
  hxRenderPayslipPdf(hxPayslipHtml(s, pr, { footer }), 'Payslip_' + safe + '_' + String(row.period || '') + '.pdf', true);
}
