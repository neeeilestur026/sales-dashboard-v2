// Flow Process Guide — a read-only, in-app SOP documenting the whole procure-to-cash chain:
// each step, who owns it, what the statuses mean, the required documents/guards, and how the
// Supplier/Client masters feed the prefills. Single source of truth for onboarding + fewer mistakes.

const FG_STEPS = [
  { n: 1, who: 'Sales / Admin', title: 'Inventory', page: 'flow-inventory.html',
    body: 'Products live here as <b>Stock</b> (real, on-hand or purchased) or <b>Catalog</b> (quoting-only, balance 0). Sales can free-type a new item on a Purchase Request and it is auto-added here as Catalog.',
    notes: ['Stock cost is set by Receiving (weighted-average). Catalog items carry no cost until purchased & received.'] },

  { n: 2, who: 'Sales / Admin', title: 'Purchase Request (PR)', page: 'flow-pricing-request.html',
    body: 'A sales rep (or admin) starts a request: customer, client contact block, and the items needed. On submit the branded PR PDF is auto-saved to Drive and the client contact details self-populate the Client master.',
    status: '<code>Requested</code> → the request is created and waiting for admin sourcing.',
    notes: ['Client contact details prefill from the Client master when the customer already exists.'] },

  { n: 3, who: 'Admin', title: 'Sourcing', page: 'flow-pricing-request.html',
    body: 'Admin fills the supplier, principal, currency, supplier price and CBM per item, the Plant Site, and marks each item Included. Admin may replace the item code/description with the supplier’s own (both are carried onto the quotation).',
    status: '<code>Sourcing</code> → in progress. Forward to Management moves it to <code>For Mgmt Pricing</code>.',
    gate: 'Forward to Management is blocked until: the supplier’s quotation is attached (Docs), a Plant Site is set, the price-verification box is ticked, and every included item has a supplier price / principal / currency.' },

  { n: 4, who: 'Management', title: 'Pricing', page: 'flow-pricing-request.html',
    body: 'Management runs the pricing engine (principal forex/duties, buy price, discount, commission %, margin %) to compute each item’s final selling price, then returns it to admin.',
    status: '<code>For Mgmt Pricing</code> → awaiting management. After pricing it becomes <code>Mgmt Priced</code>.',
    notes: ['The full engine breakdown is stored so pricing history shows exactly how each price was built.'] },

  { n: 5, who: 'Admin', title: 'Verify', page: 'flow-pricing-request.html',
    body: 'Admin reviews the management-priced request and returns it to the sales rep for quotation.',
    status: '<code>Mgmt Priced</code> → verify, then <code>Returned to Sales</code> (shown as "For Quotation").' },

  { n: 6, who: 'Sales', title: 'Quotation', page: 'flow-quotations.html',
    body: 'The rep creates the quotation from the returned PR — the management final prices, plant site, client RFQ and per-item VAT flag all carry over. The Subject defaults from the customer + first item (still editable). A branded quotation PDF is generated and saved.',
    status: '<code>Draft</code> → created; the number is the company’s own quotation code.',
    notes: ['Editing a quotation keeps its stored PDF in sync (auto-refresh or an out-of-date banner).'] },

  { n: 7, who: 'Admin → Management', title: 'Approval', page: 'flow-quotations.html',
    body: 'A sales-created quotation goes Admin first, then Management; an admin-created one goes straight to Management. Each approver reviews the items + PDF, then Approves or Rejects (a reject returns it to the creator to edit and resubmit).',
    status: '<code>Pending Admin</code> → <code>Pending Management</code> → <code>Approved</code> → <code>Sent</code>. A reject → <code>Rejected</code>.',
    gate: 'Approve is blocked when the saved PDF does not match the current record — regenerate first.' },

  { n: 8, who: 'Sales / creator', title: 'Send + Sales Order', page: 'flow-sales-orders.html',
    body: 'The creator sends the approved quotation to the client, then loads it into a Sales Order (only Approved/Sent quotations are loadable). Items, supplier type and totals carry over.',
    status: 'SO number is manual (the client’s PO number). A duplicate SO number is rejected.' },

  { n: 9, who: 'Admin / Accounting', title: 'Purchase Order', page: 'flow-purchase-orders.html',
    body: 'Raise a PO from the SO — supplier, currency, exchange rate and per-item FC prices prefill from the originating sourcing. A restock PO can be raised with no SO. Saving auto-creates the AP Aging payable.',
    status: '<code>Draft</code> → <code>Pending Management</code> → <code>Approved</code>.',
    gate: 'A non-PHP PO cannot be saved with a blank FX rate. Submit-for-approval requires a supporting document.' },

  { n: 10, who: 'Accounting', title: 'AP Aging + Payment Request', page: 'flow-ap-aging.html',
    body: 'Each PO gets an AP payable. A Payment Request (PO-type: Director → Management) draws the supplier’s bank details from the Supplier master. Marking an AP row Paid sets the payable to the actual pesos paid.',
    status: 'Payment: <code>Draft</code> → <code>Pending Director</code> → <code>Pending Management</code> → <code>Approved</code>.',
    gate: 'A payment request is hard-stopped when its PO has more than one amount-bearing AP row (prevents doubled amounts). Submit requires a document.' },

  { n: 11, who: 'Admin / Accounting', title: 'Receiving', page: 'flow-receiving.html',
    body: 'Receive the PO: enter duties, VAT (to Input VAT, recoverable), delivery and other charges. The system computes the PHP landed cost per unit and updates inventory as a weighted-average.',
    gate: 'Receiving before the AP is paid would stamp a ₱0 cost basis — you must confirm to proceed. A "no cost" line is flagged before it invoices at ₱0 COGS.' },

  { n: 12, who: 'Accounting', title: 'Invoice', page: 'flow-invoices.html',
    body: 'Issue the invoice from the SO — selling price from the quotation, COGS from the current landed cost. Inventory is deducted and an AR receivable is created with a due date derived from the Client master’s payment terms.' },

  { n: 13, who: 'Accounting', title: 'AR Aging + Collections', page: 'flow-ar-aging.html',
    body: 'The receivable ages until the client pays. Record each collection (amount, EWT, method); the AR outstanding and status update, and the collection ledger tracks everything by SO / client / month.',
    status: 'AR: <code>Unpaid</code> → <code>Partial</code> → <code>Paid</code>.' },
];

const FG_MASTERS = 'Suppliers & Clients are master records. The Supplier master fills bank/account/method on payment requests; the Client master fills the contact block on Purchase Requests and the payment terms that set each invoice’s AR due date. They self-populate as new details are typed, so re-entry keeps shrinking over time.';

const FG_ACTION = 'The ⚙ "What needs you" strip on your home dashboard and the notification bell list exactly the items waiting on your role at any moment — approvals, pricing, sourcing, quotes to send, payables/receivables due — so you never have to hunt across pages.';

function fgRender() {
  const el = document.getElementById('fgBody');
  if (!el) return;
  const stepHtml = FG_STEPS.map(s => `
    <div class="fg-step">
      <h3><span class="fg-num">${s.n}</span> ${flowEsc(s.title)} <span class="fg-who">${flowEsc(s.who)}</span></h3>
      <p>${s.body}</p>
      ${s.status ? `<div class="fg-status">${s.status}</div>` : ''}
      ${(s.notes || []).length ? `<ul>${s.notes.map(n => `<li>${n}</li>`).join('')}</ul>` : ''}
      ${s.gate ? `<div class="fg-gate">⛑ ${s.gate}</div>` : ''}
      <p style="margin-top:0.5rem;"><a href="${s.page}" class="btn btn-sm btn-secondary">Open ${flowEsc(s.title)} →</a></p>
    </div>`).join('');

  el.innerHTML = `
    <div class="fg-sec">The end-to-end flow</div>
    ${stepHtml}
    <div class="fg-sec">Master data</div>
    <div class="fg-step"><h3>Suppliers &amp; Clients</h3><p>${FG_MASTERS}</p></div>
    <div class="fg-sec">Finding what needs you</div>
    <div class="fg-step"><h3>Action Center</h3><p>${FG_ACTION}</p></div>`;
}

document.addEventListener('DOMContentLoaded', function () {
  requireAuth();
  renderNavbar('flow-guide');
  if (typeof renderFlowNav === 'function') renderFlowNav('flow-guide.html');
  fgRender();
});
