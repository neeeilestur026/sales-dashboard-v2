/* director-sales-orders.js — A288 · the director's order history (moved out of director-sales-orders.html).
 *
 * Read-only: every sales order with status, month and year filters, the top buyers, and the buyers
 * who have gone quiet. Loaded by director-sales-orders.html only.
 *
 * Two things fixed on the way out of the HTML:
 *  - the row click used to be an onclick attribute built from an ESCAPED order number and then
 *    quote-escaped again, so an apostrophe in an SO number produced a broken handler. Rows now
 *    carry data-i (the index into the rendered list) and one delegated listener on the tbody opens
 *    them; the expanded state is still keyed by the order number so it survives a re-render.
 *  - the old quiet-buyers panel listed the ten smallest buyers of the window, so the smallest
 *    first-time buyer read as dormant. It is now "Lapsed buyers": customers who have ordered before
 *    but not in the selected month / year; on the all-time view it becomes "Single-order buyers". */
(function () {
  var session = (typeof requireDirector === 'function') ? requireDirector() : null;
  if (typeof requireDirector === 'function' && !session) return;
  if (typeof renderNavbar === 'function') renderNavbar('director-sales-orders');

  var allOrders = [];
  var activeStatus = 'all';
  var expanded = {};
  var shown = [];   // the rendered list, in row order — data-i indexes into it
  var $ = function (id) { return document.getElementById(id); };
  var CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';

  function esc(s) { return hxEsc(s); }
  function php(n) { return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function dateVal(o) { return new Date(o.date || o.soDate || 0); }
  function fmtDate(d) {
    var dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return String(d || '');
    return dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit' });
  }
  function amountOf(o) { return Number(o.grandTotal || o.totalAmount || o.amount || 0); }
  function customerOf(o) { return String(o.customerName || o.customer || '—').trim() || '—'; }
  function soNoOf(o) { return String(o.soNo || o.soNumber || ''); }
  function dxBars(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return;
    container.querySelectorAll('.dx-bar[data-w]').forEach(function (b) { if (b.style && b.style.setProperty) b.style.setProperty('--dh-w', b.getAttribute('data-w')); });
  }

  function populateYears(orders) {
    var sel = $('dsoYear'), years = {};
    orders.forEach(function (o) { var d = dateVal(o); if (!isNaN(d.getTime())) years[d.getFullYear()] = true; });
    var cur = sel.value;
    sel.innerHTML = '<option value="">All years</option>' + Object.keys(years).sort(function (a, b) { return b - a; }).map(function (y) {
      return '<option value="' + y + '"' + (y === cur ? ' selected' : '') + '>' + y + '</option>';
    }).join('');
  }

  function setActiveTab() {
    ['All', 'Pending', 'Delivered'].forEach(function (s) {
      var el = $('tab' + s);
      if (el) el.classList.toggle('active', activeStatus === (s === 'All' ? 'all' : s));
    });
  }

  window.setStatus = function (s) { activeStatus = s; setActiveTab(); applyFilters(); };
  window.clearAllFilters = function () {
    $('dsoSearch').value = ''; $('dsoMonth').value = ''; $('dsoYear').value = '';
    activeStatus = 'all'; setActiveTab(); applyFilters();
  };

  /* the date window alone (month / year) — status and search do not make a buyer "lapsed" */
  function inWindow(o, month, year) {
    var d = dateVal(o);
    if (isNaN(d.getTime())) return !(month || year);
    if (month) { var ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); if (ym !== month) return false; }
    if (year && String(d.getFullYear()) !== String(year)) return false;
    return true;
  }

  window.applyFilters = function () {
    var search = ($('dsoSearch').value || '').toLowerCase().trim();
    var month = $('dsoMonth').value || '', year = $('dsoYear').value || '';
    var filtered = allOrders.filter(function (o) {
      if (activeStatus !== 'all' && String(o.status || 'Pending') !== activeStatus) return false;
      if (!inWindow(o, month, year)) return false;
      if (search) {
        var hay = (soNoOf(o) + ' ' + customerOf(o) + ' ' + (o.invoiceNo || '')).toLowerCase();
        if (hay.indexOf(search) < 0) return false;
      }
      return true;
    });
    renderKpis(filtered);
    renderRankings(filtered, month, year);
    renderTable(filtered);
  };

  function renderKpis(orders) {
    var pending = 0, delivered = 0, amount = 0;
    orders.forEach(function (o) {
      var st = String(o.status || 'Pending');
      if (st === 'Pending') pending++; else if (st === 'Delivered') delivered++;
      amount += amountOf(o);
    });
    $('kpiTotal').textContent = orders.length;
    $('kpiPending').textContent = pending;
    $('kpiDelivered').textContent = delivered;
    $('kpiAmount').textContent = php(amount);
  }

  function aggregate(orders) {
    var agg = {};
    orders.forEach(function (o) {
      var name = customerOf(o);
      if (!agg[name]) agg[name] = { name: name, count: 0, total: 0, last: null };
      agg[name].count += 1; agg[name].total += amountOf(o);
      var d = dateVal(o); if (!isNaN(d.getTime()) && (!agg[name].last || d > agg[name].last)) agg[name].last = d;
    });
    return Object.keys(agg).map(function (k) { return agg[k]; });
  }

  function renderRankings(orders, month, year) {
    var top = aggregate(orders).sort(function (a, b) { return b.total - a.total; }).slice(0, 10);
    var max = (top[0] && top[0].total) || 1;
    var topBody = $('topBuyersBody');
    topBody.innerHTML = top.length
      ? top.map(function (r) {
          return '<tr><td>' + esc(r.name) + '<i class="dx-bar" data-w="' + (r.total / max).toFixed(3) + '"></i></td>' +
            '<td class="num">' + r.count + '</td><td class="num tot">' + php(r.total) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="3" class="dh-empty">No orders in this view.</td></tr>';
    dxBars(topBody);

    // Lapsed buyers (a date window is set) or single-order buyers (all-time view)
    var all = aggregate(allOrders);
    var windowed = !!(month || year);
    var title = $('leastTitle'), note = $('leastNote');
    var rows;
    if (windowed) {
      var active = {}; allOrders.forEach(function (o) { if (inWindow(o, month, year)) active[customerOf(o)] = true; });
      rows = all.filter(function (r) { return !active[r.name] && r.name !== '—'; });
      if (title) title.textContent = 'Lapsed buyers';
      if (note) note.textContent = 'Customers who have ordered before but not in the selected period.';
    } else {
      rows = all.filter(function (r) { return r.count === 1 && r.name !== '—'; });
      if (title) title.textContent = 'Single-order buyers';
      if (note) note.textContent = 'Customers with exactly one order on record, newest first.';
    }
    rows.sort(function (a, b) { return (b.last ? b.last.getTime() : 0) - (a.last ? a.last.getTime() : 0); });
    rows = rows.slice(0, 10);
    var leastBody = $('leastBuyersBody');
    leastBody.innerHTML = rows.length
      ? rows.map(function (r) {
          return '<tr><td>' + esc(r.name) + '</td><td class="num dim">' + esc(r.last ? fmtDate(r.last) : '—') + '</td><td class="num tot">' + php(r.total) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="3" class="dh-empty">' + (windowed ? 'Every past buyer ordered in this period.' : 'No single-order buyers.') + '</td></tr>';
  }

  function badgeClass(st) {
    var s = String(st || '').toLowerCase();
    return s === 'delivered' ? 's-delivered' : s === 'cancelled' ? 's-cancelled' : 's-pending';
  }

  function renderTable(orders) {
    var body = $('dsoBody'), count = $('dsoCount');
    count.textContent = orders.length + ' order' + (orders.length === 1 ? '' : 's') + ' in this view';
    if (!orders.length) { shown = []; body.innerHTML = '<tr><td colspan="7" class="dh-empty">No sales orders match these filters.</td></tr>'; return; }
    orders.sort(function (a, b) { return dateVal(b) - dateVal(a); });
    shown = orders;
    body.innerHTML = orders.map(function (o, i) {
      var soNo = soNoOf(o), st = String(o.status || 'Pending');
      var isOpen = !!expanded[soNo];
      var items = Array.isArray(o.items) ? o.items : [];
      var itemsHtml = items.length
        ? '<table class="dx-items"><thead><tr><th>Product code</th><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead><tbody>' +
          items.map(function (it) {
            return '<tr><td>' + esc(it.productCode || '') + '</td><td>' + esc(it.productDescription || '') + '</td><td class="num">' + Number(it.qty || 0) + '</td>' +
              '<td class="num">' + php(it.unitPrice) + '</td><td class="num">' + php(it.amount) + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="dx-note">No line items.</div>';
      return '<tr class="main-row" data-i="' + i + '">' +
          '<td><span class="dx-chevron' + (isOpen ? ' open' : '') + '" id="chev-' + i + '">' + CHEV + '</span></td>' +
          '<td><strong>' + esc(soNo) + '</strong></td>' +
          '<td class="dim nowrap">' + esc(fmtDate(o.date || o.soDate)) + '</td>' +
          '<td>' + esc(customerOf(o)) + '</td>' +
          '<td><span class="dh-badge ' + badgeClass(st) + '">' + esc(st) + '</span></td>' +
          '<td class="dim">' + esc(o.invoiceNo || '—') + '</td>' +
          '<td class="num tot">' + php(amountOf(o)) + '</td>' +
        '</tr>' +
        '<tr class="items-row' + (isOpen ? '' : ' hidden') + '" id="items-' + i + '"><td colspan="7"><div class="dx-inner">' + itemsHtml + '</div></td></tr>';
    }).join('');
  }

  window.toggleRow = function (i) {
    var o = shown[i]; if (!o) return;
    var soNo = soNoOf(o);
    expanded[soNo] = !expanded[soNo];
    var row = $('items-' + i), chev = $('chev-' + i);
    if (row) row.classList.toggle('hidden', !expanded[soNo]);
    if (chev) chev.classList.toggle('open', !!expanded[soNo]);
  };

  window.loadSalesOrders = function () {
    var body = $('dsoBody');
    body.innerHTML = '<tr><td colspan="7" class="dh-empty">Loading…</td></tr>';
    return fetchFromAPI({ action: 'getSalesOrders' }, { noCache: true })
      .then(function (res) {
        if (!res || !res.success) throw new Error((res && res.message) || 'Failed to load');
        allOrders = res.data || [];
        populateYears(allOrders);
        setActiveTab();
        applyFilters();
      })
      .catch(function (err) {
        console.error('loadSalesOrders failed', err);
        body.innerHTML = '<tr><td colspan="7" class="dh-empty dh-error">The sales orders did not load. Refresh to try again.</td></tr>';
      });
  };

  document.addEventListener('DOMContentLoaded', function () {
    var s = $('dsoSearch'); if (s) s.addEventListener('input', applyFilters);
    ['dsoMonth', 'dsoYear'].forEach(function (id) { var el = $(id); if (el) el.addEventListener('change', applyFilters); });
    [['tabAll', 'all'], ['tabPending', 'Pending'], ['tabDelivered', 'Delivered']].forEach(function (t) { var el = $(t[0]); if (el) el.addEventListener('click', function () { setStatus(t[1]); }); });
    var clear = $('dsoClear'); if (clear) clear.addEventListener('click', clearAllFilters);
    var refresh = $('dsoRefresh'); if (refresh) refresh.addEventListener('click', loadSalesOrders);
    var body = $('dsoBody');
    if (body) body.addEventListener('click', function (ev) {
      var tr = ev.target && typeof ev.target.closest === 'function' ? ev.target.closest('tr.main-row') : null;
      if (tr && tr.getAttribute('data-i') !== null) toggleRow(parseInt(tr.getAttribute('data-i'), 10));
    });
    setActiveTab();
    loadSalesOrders();
  });
})();
