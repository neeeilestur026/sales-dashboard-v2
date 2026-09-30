/* director-duties-inline.js — A305 · the page's own script, moved verbatim out of director-duties.html so it is
   cached like every other script. It runs at the same point in the page it always did. */
(function () {
  var session = (typeof requireDirector === 'function') ? requireDirector() : null;
  if (typeof requireDirector === 'function' && !session) return;
  if (typeof renderNavbar === 'function') renderNavbar('director-duties');

  var allEntries = [];
  var scope = 'all';

  function esc(s) { return hxEsc(s); }
  function php(n) { return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(n) { return (isFinite(n) ? n.toFixed(1) : '0.0') + '%'; }
  function fmtDate(d) {
    if (!d) return '';
    var dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return String(d || '');
    return dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit' });
  }
  function dateOf(e) { return new Date(e.soDate || 0); }

  // Match key: SO No + Customer Name + Sales amount (rounded to cents)
  function _matchKey(soNo, customer, sales) {
    var s = String(soNo || '').trim().toUpperCase();
    var c = String(customer || '').trim().toUpperCase();
    var amt = Math.round(Number(sales || 0) * 100);
    return s + '|' + c + '|' + amt;
  }

  function populateYears(rows) {
    var sel = document.getElementById('ddYear');
    var years = {};
    rows.forEach(function (r) {
      var d = dateOf(r);
      if (!isNaN(d.getTime())) years[d.getFullYear()] = true;
    });
    var cur = sel.value;
    var list = Object.keys(years).sort(function (a, b) { return b - a; });
    sel.innerHTML = '<option value="">All</option>' + list.map(function (y) {
      return '<option value="' + y + '"' + (y === cur ? ' selected' : '') + '>' + y + '</option>';
    }).join('');
  }

  function setActiveTab() {
    ['All', 'Vat', 'Duties'].forEach(function (s) {
      var el = document.getElementById('tab' + s);
      if (el) el.classList.toggle('active', scope === s.toLowerCase());
    });
  }

  window.setScope = function (s) { scope = s; setActiveTab(); applyFilters(); };
  window.clearAllFilters = function () {
    document.getElementById('ddSearch').value = '';
    document.getElementById('ddMonth').value = '';
    document.getElementById('ddYear').value = '';
    scope = 'all'; setActiveTab(); applyFilters();
  };

  window.applyFilters = function () {
    var search = (document.getElementById('ddSearch').value || '').toLowerCase().trim();
    var month = document.getElementById('ddMonth').value || '';
    var year = document.getElementById('ddYear').value || '';

    var filtered = allEntries.filter(function (e) {
      if (scope === 'vat' && Number(e.vat || 0) <= 0) return false;
      if (scope === 'duties' && Number(e.dutiesAndTaxes || 0) <= 0) return false;
      var d = dateOf(e);
      if (!isNaN(d.getTime())) {
        if (month) {
          var ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
          if (ym !== month) return false;
        }
        if (year && String(d.getFullYear()) !== String(year)) return false;
      } else if (month || year) { return false; }
      if (search) {
        var hay = ((e.soNo || '') + ' ' + (e.customerName || '')).toLowerCase();
        if (hay.indexOf(search) < 0) return false;
      }
      return true;
    });

    renderKpis(filtered);
    renderRanking('topVatBody', filtered, 'vat', '#38bdf8');
    renderRanking('topDutiesBody', filtered, 'dutiesAndTaxes', '#f59e0b');
    renderTable(filtered);
  };

  function renderKpis(rows) {
    var totalVat = 0, totalDuties = 0, sales = 0;
    rows.forEach(function (e) {
      totalVat += Number(e.vat || 0);
      totalDuties += Number(e.dutiesAndTaxes || 0);
      sales += Number(e.sales || 0);
    });
    var burden = sales > 0 ? ((totalVat + totalDuties) / sales * 100) : 0;
    document.getElementById('kpiVat').textContent = php(totalVat);
    document.getElementById('kpiDuties').textContent = php(totalDuties);
    document.getElementById('kpiCount').textContent = rows.length;
    document.getElementById('kpiPct').textContent = pct(burden);
  }

  function renderRanking(bodyId, rows, field, color) {
    var withAmt = rows.filter(function (e) { return Number(e[field] || 0) > 0; });
    withAmt.sort(function (a, b) { return Number(b[field] || 0) - Number(a[field] || 0); });
    var top = withAmt.slice(0, 10);
    var body = document.getElementById(bodyId);
    if (!top.length) {
      body.innerHTML = '<tr><td colspan="4" class="dd-sub">No SOs in this filter.</td></tr>';
      return;
    }
    body.innerHTML = top.map(function (e, i) {
      var amt = Number(e[field] || 0);
      var topCls = i < 3 ? 'is-top' : '';
      return '<tr class="' + topCls + '">' +
        '<td class="nowrap" style="color: var(--hx-ink-3);">' + (i + 1) + '</td>' +
        '<td class="nowrap"><strong>' + esc(e.soNo || '—') + '</strong></td>' +
        '<td class="wrap">' + esc(e.customerName || '—') + '</td>' +
        '<td class="nowrap" style="text-align:right;font-weight:700;color: ' + color + ';">' + php(amt) + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderTable(rows) {
    var body = document.getElementById('ddBody');
    var count = document.getElementById('ddCount');
    count.textContent = 'Showing ' + rows.length + ' SO' + (rows.length === 1 ? '' : 's');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;color: var(--hx-ink-3);padding:1.5rem;">No entries match these filters.</td></tr>';
      return;
    }
    var sorted = rows.slice().sort(function (a, b) {
      return (Number(b.vat || 0) + Number(b.dutiesAndTaxes || 0)) -
             (Number(a.vat || 0) + Number(a.dutiesAndTaxes || 0));
    });
    body.innerHTML = sorted.map(function (e) {
      var sales = Number(e.sales || 0);
      var vat = Number(e.vat || 0);
      var duties = Number(e.dutiesAndTaxes || 0);
      var burden = sales > 0 ? ((vat + duties) / sales * 100) : 0;
      return '<tr>' +
        '<td class="nowrap" style="color: var(--hx-ink-3);font-size:0.8rem;">' + esc(fmtDate(dateOf(e))) + '</td>' +
        '<td class="nowrap"><strong>' + esc(e.soNo || '—') + '</strong></td>' +
        '<td class="wrap">' + esc(e.customerName || '—') + '</td>' +
        '<td class="nowrap" style="text-align:right;">' + php(sales) + '</td>' +
        '<td class="nowrap" style="text-align:right;font-weight:700;color: ' + (vat > 0 ? 'var(--hx-cyan)' : 'var(--hx-ink-3)') + ';">' + (vat > 0 ? php(vat) : '—') + '</td>' +
        '<td class="nowrap" style="text-align:right;font-weight:700;color: ' + (duties > 0 ? 'var(--hx-warn)' : 'var(--hx-ink-3)') + ';">' + (duties > 0 ? php(duties) : '—') + '</td>' +
        '<td class="nowrap" style="text-align:right;color: var(--hx-ink-3);">' + pct(burden) + '</td>' +
        '</tr>';
    }).join('');
  }

  window.loadDuties = function () {
    var body = document.getElementById('ddBody');
    body.innerHTML = '<tr><td colspan="7" style="text-align:center;color: var(--hx-ink-3);padding:1.5rem;">Loading…</td></tr>';
    return Promise.all([
      (typeof apiGetSalesOrders === 'function' ? apiGetSalesOrders() : Promise.resolve({ success: true, data: [] }))
        .catch(function (e) { console.warn('sales orders failed', e); return { success: true, data: [] }; }),
      apiGetProfitReports().catch(function (e) { console.warn('profit reports failed', e); return { success: true, data: [] }; })
    ]).then(function (results) {
      var soRes = results[0];
      var prRes = results[1];

      // 1) Build duties lookup from profit reports, keyed by (SO No | Customer | Sales).
      //    Multiple reports may contain the same SO — keep the entry from the newest
      //    report that has duties > 0.
      var dutiesByKey = {};
      (prRes && prRes.data || []).forEach(function (report) {
        var rDate = new Date(report.reportDate || 0);
        (report.entries || []).forEach(function (e) {
          var d = Number(e.dutiesAndTaxes || 0);
          if (d <= 0) return;
          var key = _matchKey(e.soNo, e.customerName, e.sales);
          var existing = dutiesByKey[key];
          if (!existing || rDate > existing.date) {
            dutiesByKey[key] = { duties: d, date: rDate };
          }
        });
      });

      // 2) Build the row list from Sales Orders. Each SO contributes its VAT;
      //    duties are looked up by (SO No | Customer | Sales).
      var rows = [];
      (soRes && soRes.data || []).forEach(function (so) {
        var sales = Number(so.sales || 0);
        var key = _matchKey(so.soNo, so.customerName, sales);
        var dutiesEntry = dutiesByKey[key];
        rows.push({
          soNo: so.soNo || '',
          soDate: so.date || '',
          customerName: so.customerName || '',
          sales: sales,
          vat: Number(so.vat || 0),
          dutiesAndTaxes: dutiesEntry ? dutiesEntry.duties : 0
        });
        if (dutiesEntry) delete dutiesByKey[key]; // mark as consumed
      });

      // 3) Profit-report entries that didn't match any SO (likely older entries
      //    from before the Sales Orders sheet existed) — add them as standalone
      //    rows so their duties still show in the totals.
      Object.keys(dutiesByKey).forEach(function (key) {
        var parts = key.split('|');
        var soNo = parts[0];
        var customer = parts[1];
        var sales = (parseInt(parts[2], 10) || 0) / 100;
        // Find the matching entry in any report to recover display fields
        var match = null;
        (prRes && prRes.data || []).some(function (report) {
          return (report.entries || []).some(function (e) {
            if (_matchKey(e.soNo, e.customerName, e.sales) === key) {
              match = { e: e, reportDate: report.reportDate };
              return true;
            }
            return false;
          });
        });
        rows.push({
          soNo: soNo,
          soDate: (match && match.e.soDate) || (match && match.reportDate) || '',
          customerName: (match && match.e.customerName) || customer,
          sales: (match && Number(match.e.sales)) || sales,
          vat: 0,
          dutiesAndTaxes: dutiesByKey[key].duties
        });
      });

      allEntries = rows;
      populateYears(allEntries);
      setActiveTab();
      applyFilters();
    }).catch(function (err) {
      console.error('loadDuties failed', err);
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;color: var(--hx-red);padding:1.5rem;">Failed to load data.</td></tr>';
    });
  };

  document.addEventListener('DOMContentLoaded', function () {
    setActiveTab();
    loadDuties();
  });
})();
