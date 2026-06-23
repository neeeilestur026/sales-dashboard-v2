/* flow-accounting.js — read-only consolidated view of each Sales Order across the whole flow.
   Pure client-side join over existing FlowAPI read actions. No inputs, no mutations. */
let accData = { sos: [], quotes: [], pos: [], aps: [], recs: [], invs: [], journal: [] };
let accModels = [];   // assembled per-SO models
let accSession = null;

document.addEventListener('DOMContentLoaded', async () => {
  accSession = requireAccountingOrAdmin();
  if (!accSession) return;
  renderNavbar('flow-accounting');
  renderFlowNav('flow-accounting.html');
  await loadAll();
});

async function loadAll() {
  const c = document.getElementById('container');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const [sos, quotes, pos, aps, recs, invs, journal] = await Promise.all([
      fetchFlow('getSalesOrders'), fetchFlow('getQuotations'), fetchFlow('getPurchaseOrders'),
      fetchFlow('getAPAging'), fetchFlow('getReceiving'), fetchFlow('getInvoices'), fetchFlow('getJournal'),
    ]);
    accData = {
      sos: (sos && sos.data) || [], quotes: (quotes && quotes.data) || [], pos: (pos && pos.data) || [],
      aps: (aps && aps.data) || [], recs: (recs && recs.data) || [], invs: (invs && invs.data) || [],
      journal: (journal && journal.data) || [],
    };
    buildModels();
    render();
  } catch (e) {
    c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`;
  }
}

/** Assemble a full model per Sales Order by joining on the flow's link keys. */
function buildModels() {
  accModels = accData.sos.map(so => {
    const quote = accData.quotes.find(q => String(q.quotationNo) === String(so.quotationNo)) || null;
    const pos = accData.pos.filter(p => String(p.soNo) === String(so.soNo));
    const poNos = new Set(pos.map(p => String(p.poNo)));
    const procurement = pos.map(p => ({
      po: p,
      aps: accData.aps.filter(a => String(a.poNo) === String(p.poNo)),
      recs: accData.recs.filter(r => String(r.poNo) === String(p.poNo)),
    }));
    const invs = accData.invs.filter(v => String(v.soNo) === String(so.soNo));

    // Related document numbers for the journal slice
    const apNos = new Set(procurement.flatMap(x => x.aps.map(a => String(a.apNo))));
    const invNos = new Set(invs.map(v => String(v.invNo)));
    const journal = accData.journal.filter(l => {
      const sn = String(l.sourceNo);
      if (l.source === 'PO' && poNos.has(sn)) return true;
      if (l.source === 'APPAY' && apNos.has(sn)) return true;
      if (l.source === 'INV' && invNos.has(sn)) return true;
      if (l.source === 'MR') return procurement.some(x => x.recs.some(r => String(r.mrNo) === sn));
      return false;
    });

    const totalSales = invs.reduce((s, v) => s + flowNum(v.totalSales), 0);
    const totalCOGS = invs.reduce((s, v) => s + flowNum(v.totalCOGS), 0);
    const apOutstanding = procurement.flatMap(x => x.aps)
      .filter(a => (a.status || '').toLowerCase() !== 'paid')
      .reduce((s, a) => s + (flowNum(a.amountPHP) - flowNum(a.paidPHP)), 0);

    return { so, quote, procurement, invs, journal,
             totalSales, totalCOGS, grossProfit: totalSales - totalCOGS, apOutstanding };
  });
}

function render() {
  const q = (document.getElementById('search').value || '').toLowerCase();
  const models = accModels.filter(m => {
    if (!q) return true;
    const hay = [m.so.soNo, m.so.customer, m.so.quotationNo,
                 ...m.procurement.map(x => x.po.poNo)].join(' ').toLowerCase();
    return hay.includes(q);
  });

  // KPI strip (over all SOs, not the filtered view)
  document.getElementById('kpiCount').textContent = accModels.length;
  document.getElementById('kpiSales').textContent = flowMoney(accModels.reduce((s, m) => s + m.totalSales, 0), 'PHP');
  document.getElementById('kpiCogs').textContent = flowMoney(accModels.reduce((s, m) => s + m.totalCOGS, 0), 'PHP');
  document.getElementById('kpiGp').textContent = flowMoney(accModels.reduce((s, m) => s + m.grossProfit, 0), 'PHP');
  document.getElementById('kpiAp').textContent = flowMoney(accModels.reduce((s, m) => s + m.apOutstanding, 0), 'PHP');

  const c = document.getElementById('container');
  if (!models.length) { c.innerHTML = '<p class="acc-muted">No sales orders.</p>'; return; }
  c.innerHTML = models.map(soCard).join('');
}

function soCard(m) {
  const s = m.so;
  return `<div class="acc-so" id="so-${flowEsc(s.soNo)}">
    <div class="acc-so-head" onclick="toggleSO('${flowEsc(s.soNo)}')">
      <div><span class="lbl">Sales Order</span><span class="so-no">${flowEsc(s.soNo)}</span></div>
      <div><span class="lbl">Customer</span>${flowEsc(s.customer)}</div>
      <div><span class="lbl">Status</span><span class="flow-badge b-open">${flowEsc(s.status)}</span></div>
      <div class="num"><span class="lbl">Sales</span>${flowMoney(m.totalSales, 'PHP')}</div>
      <div class="num"><span class="lbl">COGS</span>${flowMoney(m.totalCOGS, 'PHP')}</div>
      <div class="num"><span class="lbl">Gross Profit</span>${flowMoney(m.grossProfit, 'PHP')}</div>
      <div class="acc-chevron acc-muted">▶</div>
    </div>
    <div class="acc-so-body">${soBody(m)}</div>
  </div>`;
}

function itemsTable(headers, rows) {
  return `<table class="flow-table"><thead><tr>${headers.map(h => `<th class="${h.num ? 'num' : ''}">${h.t}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody></table>`;
}

function soBody(m) {
  const s = m.so;
  let html = '';

  // Quotation
  html += `<div class="acc-sec"><h4>Quotation</h4>`;
  if (m.quote) {
    html += `<div class="acc-muted" style="font-size:0.8rem;margin-bottom:0.3rem;">${flowEsc(m.quote.quotationNo)} · ${flowDate(m.quote.date)} · ${flowEsc(m.quote.status)} · Total ${flowMoney(m.quote.total, 'PHP')}${m.quote.pdfLink ? ` · <a href="${flowEsc(m.quote.pdfLink)}" target="_blank" class="link-btn">PDF</a>` : ''}</div>`;
    html += itemsTable(
      [{ t: 'Item' }, { t: 'Name' }, { t: 'Qty', num: 1 }, { t: 'Quoted Price', num: 1 }, { t: 'Line Total', num: 1 }],
      (m.quote.items || []).map(it => `<tr><td>${flowEsc(it.itemNo)}</td><td>${flowEsc(it.itemName)}</td><td class="num">${flowNum(it.qty)}</td><td class="num">${flowMoney(it.price, 'PHP')}</td><td class="num">${flowMoney(it.lineTotal, 'PHP')}</td></tr>`));
  } else {
    html += `<div class="acc-muted">No source quotation linked.</div>`;
  }
  html += `</div>`;

  // Sales Order items
  html += `<div class="acc-sec"><h4>Sales Order Items</h4>` + itemsTable(
    [{ t: 'Item' }, { t: 'Name' }, { t: 'Qty', num: 1 }, { t: 'Price/Unit', num: 1 }, { t: 'Total', num: 1 }],
    (s.items || []).map(it => `<tr><td>${flowEsc(it.itemNo)}</td><td>${flowEsc(it.itemName)}</td><td class="num">${flowNum(it.qty)}</td><td class="num">${flowMoney(it.price, 'PHP')}</td><td class="num">${flowMoney(it.total, 'PHP')}</td></tr>`))
    + `<div class="acc-summary"><span><small>SO Total</small>${flowMoney(s.total, 'PHP')}</span><span><small>Date</small>${flowDate(s.date)}</span></div></div>`;

  // Procurement (PO + AP + Receiving)
  html += `<div class="acc-sec"><h4>Procurement</h4>`;
  if (!m.procurement.length) {
    html += `<div class="acc-muted">No purchase orders raised for this sales order.</div>`;
  } else {
    m.procurement.forEach(x => {
      const p = x.po;
      html += `<div class="acc-muted" style="font-size:0.82rem;margin:0.4rem 0 0.2rem;"><strong style="color:var(--text-primary,#f1f5f9);">${flowEsc(p.poNo)}</strong> · ${flowEsc(p.supplier)} · ${flowEsc(p.currency)} · Total ${flowMoney(p.total, p.currency)} · ${flowEsc(p.status)}${p.pdfLink ? ` · <a href="${flowEsc(p.pdfLink)}" target="_blank" class="link-btn">PDF</a>` : ''}</div>`;
      html += itemsTable(
        [{ t: 'Item' }, { t: 'Name' }, { t: 'Qty', num: 1 }, { t: 'Purchase/Unit (FC)', num: 1 }, { t: 'Total (FC)', num: 1 }],
        (p.items || []).map(it => `<tr><td>${flowEsc(it.itemNo)}</td><td>${flowEsc(it.itemName)}</td><td class="num">${flowNum(it.qty)}</td><td class="num">${flowMoney(it.price, p.currency)}</td><td class="num">${flowMoney(it.total, p.currency)}</td></tr>`));
      // AP
      if (x.aps.length) {
        html += `<div class="acc-sub"><div class="acc-muted" style="font-size:0.72rem;text-transform:uppercase;">Accounts Payable</div>` + itemsTable(
          [{ t: 'AP No' }, { t: 'Cur' }, { t: 'Amount FC', num: 1 }, { t: 'Amount PHP', num: 1 }, { t: 'Paid PHP', num: 1 }, { t: 'Status' }, { t: 'Due' }],
          x.aps.map(a => `<tr><td>${flowEsc(a.apNo)}</td><td>${flowEsc(a.currency)}</td><td class="num">${flowMoney(a.amountFC, a.currency)}</td><td class="num">${a.amountPHP ? flowMoney(a.amountPHP, 'PHP') : '<span class="acc-muted">—</span>'}</td><td class="num">${flowMoney(a.paidPHP, 'PHP')}</td><td><span class="flow-badge ${apBadge(a.status)}">${flowEsc(a.status)}</span></td><td>${flowDate(a.dueDate)}</td></tr>`))
          + `</div>`;
      }
      // Receiving
      if (x.recs.length) {
        x.recs.forEach(r => {
          html += `<div class="acc-sub"><div class="acc-muted" style="font-size:0.72rem;text-transform:uppercase;">Receiving ${flowEsc(r.mrNo)} · Shipping ${flowMoney(r.totalShipping, 'PHP')} (VAT ${flowMoney(r.vat, 'PHP')})</div>` + itemsTable(
            [{ t: 'Item' }, { t: 'Qty Recd', num: 1 }, { t: 'Purchase/Unit (FC)', num: 1 }, { t: 'Purchase/Unit (PHP)', num: 1 }, { t: 'Shipping/Unit', num: 1 }, { t: 'Landed/Unit', num: 1 }, { t: 'Total Landed', num: 1 }],
            (r.items || []).map(it => `<tr><td>${flowEsc(it.itemNo)} ${flowEsc(it.itemName)}</td><td class="num">${flowNum(it.qty)}</td><td class="num">${flowMoney(it.purchasePrice, r.currency)}</td><td class="num">${flowMoney(it.purchasePHP, 'PHP')}</td><td class="num">${flowMoney(it.shippingPerUnit, 'PHP')}</td><td class="num">${flowMoney(it.landedCost, 'PHP')}</td><td class="num">${flowMoney(it.totalLanded, 'PHP')}</td></tr>`))
            + `</div>`;
        });
      }
    });
  }
  html += `</div>`;

  // Invoice
  html += `<div class="acc-sec"><h4>Invoice / Issuance</h4>`;
  if (!m.invs.length) {
    html += `<div class="acc-muted">Not yet invoiced.</div>`;
  } else {
    m.invs.forEach(v => {
      html += `<div class="acc-muted" style="font-size:0.82rem;margin:0.3rem 0;"><strong style="color:var(--text-primary,#f1f5f9);">${flowEsc(v.invNo)}</strong> · ${flowDate(v.date)}</div>`;
      html += itemsTable(
        [{ t: 'Item' }, { t: 'Qty', num: 1 }, { t: 'Selling Price', num: 1 }, { t: 'Line Sales', num: 1 }, { t: 'Landed (COGS)', num: 1 }, { t: 'Line COGS', num: 1 }],
        (v.items || []).map(it => `<tr><td>${flowEsc(it.itemNo)} ${flowEsc(it.itemName)}</td><td class="num">${flowNum(it.qty)}</td><td class="num">${flowMoney(it.sellingPrice, 'PHP')}</td><td class="num">${flowMoney(it.lineSales, 'PHP')}</td><td class="num">${flowMoney(it.landedCost, 'PHP')}</td><td class="num">${flowMoney(it.lineCOGS, 'PHP')}</td></tr>`));
    });
  }
  html += `</div>`;

  // Journal entries
  if (m.journal.length) {
    html += `<div class="acc-sec"><h4>Journal Entries</h4>` + itemsTable(
      [{ t: 'Entry' }, { t: 'Date' }, { t: 'Source' }, { t: 'Account' }, { t: 'Debit', num: 1 }, { t: 'Credit', num: 1 }, { t: 'Memo' }],
      m.journal.map(l => `<tr><td>${flowEsc(l.entryNo)}</td><td>${flowDate(l.date)}</td><td>${flowEsc(l.source)} ${flowEsc(l.sourceNo)}</td><td>${flowEsc(l.accountCode)} ${flowEsc(l.accountName)}</td><td class="num">${l.debit ? flowMoney(l.debit, l.currency) : ''}</td><td class="num">${l.credit ? flowMoney(l.credit, l.currency) : ''}</td><td class="acc-muted">${flowEsc(l.memo)}</td></tr>`))
      + `</div>`;
  }

  // Per-SO summary
  html += `<div class="acc-sec"><h4>Summary</h4><div class="acc-summary">
    <span><small>Sales</small>${flowMoney(m.totalSales, 'PHP')}</span>
    <span><small>COGS</small>${flowMoney(m.totalCOGS, 'PHP')}</span>
    <span><small>Gross Profit</small>${flowMoney(m.grossProfit, 'PHP')}</span>
    <span><small>AP Outstanding</small>${flowMoney(m.apOutstanding, 'PHP')}</span></div></div>`;

  return html;
}

function apBadge(status) {
  const s = (status || '').toLowerCase();
  if (s === 'paid') return 'b-paid';
  if (s === 'partial') return 'b-partial';
  return 'b-unpaid';
}

function toggleSO(soNo) {
  const el = document.getElementById('so-' + soNo);
  if (el) el.classList.toggle('open');
}
