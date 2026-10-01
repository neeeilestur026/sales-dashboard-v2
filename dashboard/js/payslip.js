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
