/* management-sales-orders-inline.js — A305 · the page's own script, moved verbatim out of management-sales-orders.html so it is
   cached like every other script. It runs at the same point in the page it always did. */
(function () {
  // Oversight roles (admin | accounting | management | director) may view this read-only overview.
  var session = (typeof requireOversight === 'function') ? requireOversight() : null;
  if (typeof requireOversight === 'function' && !session) return;
  if (typeof renderNavbar === 'function') renderNavbar('management-sales-orders');

  var allOrders = [];
  var activeStatus = 'all';
  var expanded = {};

  function esc(s) { return hxEsc(s); }
  function php(n) {
    return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function dateVal(o) { return new Date(o.date || o.soDate || 0); }
  function fmtDate(d) {
    var dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return String(d || '');
    return dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit' });
  }

  function populateYears(orders) {
    var sel = document.getElementById('msoYear');
    var years = {};
    orders.forEach(function (o) {
      var d = dateVal(o);
      if (!isNaN(d.getTime())) years[d.getFullYear()] = true;
    });
    var cur = sel.value;
    var list = Object.keys(years).sort(function (a, b) { return b - a; });
    sel.innerHTML = '<option value="">All</option>' + list.map(function (y) {
      return '<option value="' + y + '"' + (y === cur ? ' selected' : '') + '>' + y + '</option>';
    }).join('');
  }

  function setActiveTab() {
    ['All', 'Pending', 'Delivered'].forEach(function (s) {
      var el = document.getElementById('tab' + s);
      if (el) el.classList.toggle('active', activeStatus === (s === 'All' ? 'all' : s));
    });
  }

  window.setStatus = function (s) {
    activeStatus = s;
    setActiveTab();
    applyFilters();
  };

  window.clearAllFilters = function () {
    document.getElementById('msoSearch').value = '';
    document.getElementById('msoMonth').value = '';
    document.getElementById('msoYear').value = '';
    activeStatus = 'all';
    setActiveTab();
    applyFilters();
  };

  window.applyFilters = function () {
    var search = (document.getElementById('msoSearch').value || '').toLowerCase().trim();
    var month = document.getElementById('msoMonth').value || '';
    var year = document.getElementById('msoYear').value || '';

    var filtered = allOrders.filter(function (o) {
      if (activeStatus !== 'all') {
        var st = String(o.status || 'Pending');
        if (st !== activeStatus) return false;
      }
      var d = dateVal(o);
      if (!isNaN(d.getTime())) {
        if (month) {
          var ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
          if (ym !== month) return false;
        }
        if (year && String(d.getFullYear()) !== String(year)) return false;
      } else if (month || year) {
        return false;
      }
      if (search) {
        var hay = ((o.soNo || o.soNumber || '') + ' ' + (o.customerName || o.customer || '') + ' ' + (o.invoiceNo || '')).toLowerCase();
        if (hay.indexOf(search) < 0) return false;
      }
      return true;
    });

    renderKpis(filtered);
    renderTable(filtered);
  };

  function renderKpis(orders) {
    var pending = 0, delivered = 0, amount = 0;
    orders.forEach(function (o) {
      var st = String(o.status || 'Pending');
      if (st === 'Pending') pending++;
      else if (st === 'Delivered') delivered++;
      amount += Number(o.grandTotal || o.totalAmount || o.amount || 0);
    });
    document.getElementById('kpiTotal').textContent = orders.length;
    document.getElementById('kpiPending').textContent = pending;
    document.getElementById('kpiDelivered').textContent = delivered;
    document.getElementById('kpiAmount').textContent = php(amount);
  }

  function renderTable(orders) {
    var body = document.getElementById('msoBody');
    var count = document.getElementById('msoCount');
    count.textContent = 'Showing ' + orders.length + ' order' + (orders.length === 1 ? '' : 's');

    if (!orders.length) {
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;color: var(--hx-ink-3);padding:1.5rem;">No sales orders match these filters.</td></tr>';
      return;
    }
    orders.sort(function (a, b) { return dateVal(b) - dateVal(a); });

    body.innerHTML = orders.map(function (o) {
      var soNo = o.soNo || o.soNumber || '';
      var st = String(o.status || 'Pending');
      var stClass = st.toLowerCase() === 'delivered' ? 'badge-delivered'
                  : st.toLowerCase() === 'cancelled' ? 'badge-cancelled'
                  : 'badge-pending';
      var amount = o.grandTotal || o.totalAmount || o.amount || 0;
      var isOpen = !!expanded[soNo];
      var items = Array.isArray(o.items) ? o.items : [];
      var itemsHtml = '';
      if (items.length) {
        itemsHtml = '<table class="mso-items">' +
          '<thead><tr><th>Product Code</th><th>Description</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Unit Price</th><th style="text-align:right;">Amount</th></tr></thead><tbody>' +
          items.map(function (it) {
            return '<tr>' +
              '<td>' + esc(it.productCode || '') + '</td>' +
              '<td>' + esc(it.productDescription || '') + '</td>' +
              '<td style="text-align:right;">' + Number(it.qty || 0) + '</td>' +
              '<td style="text-align:right;">' + php(it.unitPrice) + '</td>' +
              '<td style="text-align:right;">' + php(it.amount) + '</td>' +
              '</tr>';
          }).join('') +
          '</tbody></table>';
      } else {
        itemsHtml = '<div style="color: var(--hx-ink-3);font-size:0.8rem;">No line items.</div>';
      }

      return '<tr class="main-row" onclick="toggleRow(\'' + esc(soNo).replace(/'/g, "\\'") + '\')">' +
          '<td class="nowrap"><span class="mso-chevron ' + (isOpen ? 'open' : '') + '" id="chev-' + esc(soNo) + '">▶</span></td>' +
          '<td class="nowrap"><strong>' + esc(soNo) + '</strong></td>' +
          '<td class="nowrap" style="color: var(--hx-ink-3);">' + esc(fmtDate(o.date || o.soDate)) + '</td>' +
          '<td class="wrap">' + esc(o.customerName || o.customer || '') + '</td>' +
          '<td class="nowrap"><span class="badge ' + stClass + '">' + esc(st) + '</span></td>' +
          '<td class="wrap" style="color: var(--hx-ink-3);font-size:0.82rem;">' + esc(o.invoiceNo || '—') + '</td>' +
          '<td class="nowrap" style="font-weight:600;text-align:right;">' + php(amount) + '</td>' +
        '</tr>' +
        '<tr class="items-row ' + (isOpen ? '' : 'hidden') + '" id="items-' + esc(soNo) + '">' +
          '<td colspan="7"><div class="mso-inner">' + itemsHtml + '</div></td>' +
        '</tr>';
    }).join('');
  }

  window.toggleRow = function (soNo) {
    expanded[soNo] = !expanded[soNo];
    var row = document.getElementById('items-' + soNo);
    var chev = document.getElementById('chev-' + soNo);
    if (row) row.classList.toggle('hidden', !expanded[soNo]);
    if (chev) chev.classList.toggle('open', !!expanded[soNo]);
  };

  // Map a flow SalesOrder (FlowAPI) to the shape this page renders.
  function mapFlowOrder(o) {
    var items = Array.isArray(o.items) ? o.items.map(function (it) {
      var qty = Number(it.qty || 0), price = Number(it.price != null ? it.price : it.unitPrice || 0);
      return { productCode: it.itemNo || '', productDescription: it.itemName || '', qty: qty,
               unitPrice: price, amount: qty * price };
    }) : [];
    return {
      soNo: o.soNo, date: o.date, customer: o.customer, status: o.status || 'Pending',
      amount: Number(o.total || o.grandTotal || 0), invoiceNo: '', source: 'flow', items: items
    };
  }

  window.loadSalesOrders = function () {
    var body = document.getElementById('msoBody');
    body.innerHTML = '<tr><td colspan="7" style="text-align:center;color: var(--hx-ink-3);padding:1.5rem;">Loading…</td></tr>';
    var pProd = fetchFromAPI({ action: 'getSalesOrders' }, { noCache: true }).catch(function () { return { success: false, data: [] }; });
    var pFlow = (typeof fetchFlow === 'function')
      ? fetchFlow('getSalesOrders').catch(function () { return { data: [] }; })
      : Promise.resolve({ data: [] });
    return Promise.all([pProd, pFlow])
      .then(function (results) {
        var prod = (results[0] && results[0].data) || [];
        var flow = ((results[1] && results[1].data) || []).map(mapFlowOrder);
        // Merge, de-duped by SO number — a flow SO wins if the same number exists in both.
        var byNo = {};
        prod.forEach(function (o) { var k = String(o.soNo || o.soNumber || ''); if (k) byNo[k] = o; else (byNo['_' + Math.random()] = o); });
        flow.forEach(function (o) { var k = String(o.soNo || ''); byNo[k || ('_' + Math.random())] = o; });
        allOrders = Object.keys(byNo).map(function (k) { return byNo[k]; });
        populateYears(allOrders);
        setActiveTab();
        applyFilters();
      })
      .catch(function (err) {
        console.error('loadSalesOrders failed', err);
        body.innerHTML = '<tr><td colspan="7" style="text-align:center;color: var(--hx-red);padding:1.5rem;">Failed to load sales orders.</td></tr>';
      });
  };

  document.addEventListener('DOMContentLoaded', function () {
    setActiveTab();
    loadSalesOrders();
  });
})();
