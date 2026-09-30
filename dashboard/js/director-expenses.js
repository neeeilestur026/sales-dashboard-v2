/* director-expenses.js — A288 · the director's expense ledger (moved out of director-expenses.html).
 *
 * Read-only: the field expenses (toll, fuel, meals, load, other) with month / year / category
 * filters, the top categories and the split by type. Loaded by director-expenses.html only.
 * Templates carry classes, never inline styles; the ranking bars are sized by a post-render pass
 * that sets --dh-w. Globals kept for anything that still calls them: loadExpenses, applyFilters,
 * clearAllFilters. */
(function () {
  var session = (typeof requireDirector === 'function') ? requireDirector() : null;
  if (typeof requireDirector === 'function' && !session) return;
  if (typeof renderNavbar === 'function') renderNavbar('director-expenses');

  var allExpenses = [];
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) { return hxEsc(s); }
  function php(n) { return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function dateVal(o) { return new Date(o.date || 0); }
  function fmtDate(d) {
    var dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return String(d || '');
    return dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit' });
  }
  /* the bars: width lives in a custom property set here, never in the template */
  function dxBars(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return;
    container.querySelectorAll('.dx-bar[data-w]').forEach(function (b) { if (b.style && b.style.setProperty) b.style.setProperty('--dh-w', b.getAttribute('data-w')); });
  }

  function populateYearsAndCategories(rows) {
    var ySel = $('dexYear'), cSel = $('dexCategory');
    var years = {}, cats = {};
    rows.forEach(function (r) {
      var d = dateVal(r);
      if (!isNaN(d.getTime())) years[d.getFullYear()] = true;
      var c = String(r.category || '').trim();
      if (c) cats[c] = true;
    });
    var yCur = ySel.value, cCur = cSel.value;
    ySel.innerHTML = '<option value="">All years</option>' + Object.keys(years).sort(function (a, b) { return b - a; }).map(function (y) {
      return '<option value="' + y + '"' + (y === yCur ? ' selected' : '') + '>' + y + '</option>';
    }).join('');
    cSel.innerHTML = '<option value="">All categories</option>' + Object.keys(cats).sort().map(function (c) {
      return '<option value="' + esc(c) + '"' + (c === cCur ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
  }

  window.clearAllFilters = function () {
    $('dexSearch').value = ''; $('dexMonth').value = ''; $('dexYear').value = ''; $('dexCategory').value = '';
    applyFilters();
  };

  window.applyFilters = function () {
    var search = ($('dexSearch').value || '').toLowerCase().trim();
    var month = $('dexMonth').value || '', year = $('dexYear').value || '', cat = $('dexCategory').value || '';
    var filtered = allExpenses.filter(function (r) {
      if (cat && String(r.category || '') !== cat) return false;
      var d = dateVal(r);
      if (!isNaN(d.getTime())) {
        if (month) { var ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); if (ym !== month) return false; }
        if (year && String(d.getFullYear()) !== String(year)) return false;
      } else if (month || year) return false;
      if (search) {
        var hay = ((r.description || '') + ' ' + (r.client || '') + ' ' + (r.category || '') + ' ' + (r.orderRef || '') + ' ' + (r.notes || '')).toLowerCase();
        if (hay.indexOf(search) < 0) return false;
      }
      return true;
    });
    renderKpis(filtered);
    renderAnalytics(filtered);
    renderTable(filtered);
  };

  function renderKpis(rows) {
    var total = 0, byCat = {};
    rows.forEach(function (r) { var amt = Number(r.total || 0); total += amt; var c = String(r.category || '—'); byCat[c] = (byCat[c] || 0) + amt; });
    var avg = rows.length ? total / rows.length : 0;
    var topCat = '—', topVal = 0;
    Object.keys(byCat).forEach(function (k) { if (byCat[k] > topVal) { topVal = byCat[k]; topCat = k; } });
    $('kpiCount').textContent = rows.length;
    $('kpiTotal').textContent = php(total);
    $('kpiAvg').textContent = php(avg);
    $('kpiTopCat').textContent = topCat;
    var amt = $('kpiTopCatAmt'); if (amt) amt.textContent = topVal > 0 ? php(topVal) : '';
  }

  function renderAnalytics(rows) {
    var byCat = {};
    rows.forEach(function (r) {
      var c = String(r.category || '—').trim() || '—';
      if (!byCat[c]) byCat[c] = { name: c, count: 0, total: 0 };
      byCat[c].count += 1; byCat[c].total += Number(r.total || 0);
    });
    var catList = Object.keys(byCat).map(function (k) { return byCat[k]; }).sort(function (a, b) { return b.total - a.total; });
    var maxCat = (catList[0] && catList[0].total) || 1;
    var topBody = $('topCatBody');
    topBody.innerHTML = catList.length
      ? catList.map(function (c) {
          var avg = c.count ? c.total / c.count : 0;
          return '<tr><td>' + esc(c.name) + '<i class="dx-bar" data-w="' + (c.total / maxCat).toFixed(3) + '"></i></td>' +
            '<td class="num">' + c.count + '</td><td class="num dim">' + php(avg) + '</td><td class="num tot">' + php(c.total) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="4" class="dh-empty">No expenses in this view.</td></tr>';
    dxBars(topBody);

    var types = { Toll: 0, Fuel: 0, Meals: 0, 'Load balance': 0, Other: 0 }, grand = 0;
    rows.forEach(function (r) {
      types.Toll += Number(r.toll || 0); types.Fuel += Number(r.fuel || 0); types.Meals += Number(r.meals || 0);
      types['Load balance'] += Number(r.loadBalance || 0); types.Other += Number(r.otherAmount || 0); grand += Number(r.total || 0);
    });
    var typeRows = Object.keys(types).map(function (k) { return { name: k, val: types[k] }; }).sort(function (a, b) { return b.val - a.val; });
    var maxType = (typeRows[0] && typeRows[0].val) || 1;
    var typeBody = $('typeBreakdownBody');
    typeBody.innerHTML = grand > 0
      ? typeRows.map(function (t) {
          var pct = grand ? (t.val / grand * 100) : 0;
          return '<tr><td>' + esc(t.name) + '<i class="dx-bar cyan" data-w="' + (t.val / maxType).toFixed(3) + '"></i></td>' +
            '<td class="num tot">' + php(t.val) + '</td><td class="num dim">' + pct.toFixed(1) + '%</td></tr>';
        }).join('')
      : '<tr><td colspan="3" class="dh-empty">No expenses in this view.</td></tr>';
    dxBars(typeBody);
  }

  function renderTable(rows) {
    var body = $('dexBody'), count = $('dexCount');
    count.textContent = rows.length + ' expense' + (rows.length === 1 ? '' : 's') + ' in this view';
    if (!rows.length) { body.innerHTML = '<tr><td colspan="10" class="dh-empty">No expenses match these filters.</td></tr>'; return; }
    rows.sort(function (a, b) { return dateVal(b) - dateVal(a); });
    var cell = function (v) { return '<td class="num">' + (v ? php(v) : '<span class="dim">—</span>') + '</td>'; };
    body.innerHTML = rows.map(function (r) {
      var clientRef = (r.client ? esc(r.client) : '') + (r.orderRef ? '<span class="dx-pill">' + esc(r.orderRef) + '</span>' : '');
      return '<tr>' +
        '<td class="dim nowrap">' + esc(fmtDate(r.date)) + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + (clientRef || '<span class="dim">—</span>') + '</td>' +
        '<td class="desc">' + esc(r.description || '') + '</td>' +
        cell(r.toll) + cell(r.fuel) + cell(r.meals) + cell(r.loadBalance) + cell(r.otherAmount) +
        '<td class="num tot">' + php(r.total) + '</td></tr>';
    }).join('');
  }

  window.loadExpenses = function () {
    var body = $('dexBody');
    body.innerHTML = '<tr><td colspan="10" class="dh-empty">Loading…</td></tr>';
    return fetchFromAPI({ action: 'getExpenses' }, { noCache: true })
      .then(function (res) {
        if (!res || !res.success) throw new Error((res && res.message) || 'Failed to load');
        allExpenses = res.data || [];
        populateYearsAndCategories(allExpenses);
        applyFilters();
      })
      .catch(function (err) {
        console.error('loadExpenses failed', err);
        body.innerHTML = '<tr><td colspan="10" class="dh-empty dh-error">The expenses did not load. Refresh to try again.</td></tr>';
      });
  };

  document.addEventListener('DOMContentLoaded', function () {
    ['dexSearch'].forEach(function (id) { var el = $(id); if (el) el.addEventListener('input', applyFilters); });
    ['dexMonth', 'dexYear', 'dexCategory'].forEach(function (id) { var el = $(id); if (el) el.addEventListener('change', applyFilters); });
    var clear = $('dexClear'); if (clear) clear.addEventListener('click', clearAllFilters);
    var refresh = $('dexRefresh'); if (refresh) refresh.addEventListener('click', loadExpenses);
    loadExpenses();
  });
})();
