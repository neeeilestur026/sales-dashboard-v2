/* ═══════════════════════════════════════════════
   stage-meta.js — Shared shipment lifecycle
   constants: stage list, phases, owner roles,
   badges, and per-stage metadata.
   Loaded before admin.js AND management-home.js
   ═══════════════════════════════════════════════ */

// ── 24-stage lifecycle definition (A151: + downstream Billing & Collection) ─────
// The authoritative auto/manual flag comes from the SERVER (_shipAutoDerive → t.autoderived);
// the `autoDerive` flags below are display metadata, aligned to what the server actually derives:
// AUTO = so_received, po_created/approved/sent, prf_created, tt_sent, delivered, invoiced, ar_open,
// collected. ('booked' is MANUAL — the old "auto from AWB" note was never implemented.)
const _SM_LIFECYCLE_STAGES = [
  { key: 'so_received',             label: 'Sales Order Received',              owner: 'Sales',      autoDerive: true,  docLabel: 'Sales Order document' },
  { key: 'po_created',              label: 'Purchase Order Created',            owner: 'Admin',      autoDerive: true,  docLabel: null },
  { key: 'po_approved',             label: 'PO Approved (Management)',          owner: 'Sir Larry',  autoDerive: true,  docLabel: null },
  { key: 'po_sent',                 label: 'PO Sent to Supplier',               owner: 'Admin',      autoDerive: true,  docLabel: null },
  { key: 'proforma_received',       label: 'Proforma / Order Confirmation',     owner: 'Supplier',   autoDerive: false, docLabel: 'Proforma Invoice or Order Confirmation' },
  { key: 'prf_created',             label: 'Payment Request (PRF) Created',     owner: 'Accounting', autoDerive: true,  docLabel: null },
  { key: 'prf_approved',            label: 'PRF Approved (Management)',         owner: 'Sir Larry',  autoDerive: true,  docLabel: null },
  { key: 'tt_sent',                 label: 'Telegraphic Transfer (TT) Sent',    owner: 'Accounting', autoDerive: true,  docLabel: 'TT Form / Bank remittance slip' },
  { key: 'tt_forwarded',            label: 'TT Forwarded to Supplier',          owner: 'Admin',      autoDerive: false, docLabel: null },
  { key: 'shipping_docs_received',  label: 'Packing List & Commercial Invoice', owner: 'Supplier',   autoDerive: false, docLabel: 'Packing List and Commercial Invoice' },
  { key: 'forwarder_quotes',        label: 'Forwarder Quotations',              owner: 'Admin',      autoDerive: false, docLabel: 'Forwarder quotation docs (up to 5)' },
  { key: 'forwarder_approved',      label: 'Forwarder Approved (Management)',   owner: 'Sir Larry',  autoDerive: false, docLabel: null },
  { key: 'booked',                  label: 'Booked — Waybill / AWB',            owner: 'Admin',      autoDerive: false, docLabel: 'Waybill or Airway Bill' },
  { key: 'pickup',                  label: 'Picked Up by Forwarder',            owner: 'Forwarder',  autoDerive: false, docLabel: null },
  { key: 'in_transit',              label: 'In Transit',                        owner: 'Admin',      autoDerive: false, docLabel: null },
  { key: 'customs_clearance',       label: 'Customs Clearance',                 owner: 'Broker',     autoDerive: false, docLabel: 'Estimated duties & taxes document' },
  { key: 'fan_sad_tan',             label: 'FAN / SAD / TAN (Customs Docs)',    owner: 'Broker',     autoDerive: false, docLabel: 'FAN, SAD, or TAN documents' },
  { key: 'debit_memo',              label: 'Bank Debit Memo',                   owner: 'Bank',       autoDerive: false, docLabel: 'Bank debit memo' },
  { key: 'forwarder_final_invoice', label: 'Forwarder Final Invoice',           owner: 'Forwarder',  autoDerive: false, docLabel: 'Final forwarder invoice' },
  { key: 'local_charges',           label: 'Local Charges',                     owner: 'Forwarder',  autoDerive: false, docLabel: 'Local charges document' },
  { key: 'delivered',               label: 'Delivered to Office',               owner: 'Admin',      autoDerive: true,  docLabel: 'Delivery photo or receipt' },
  // A195: the handover to the CUSTOMER, which had no stage — 'delivered' above is only as far as our
  // own office. Manual: nothing downstream can prove a customer signed for the goods.
  { key: 'delivered_client',        label: 'Delivered to Customer',             owner: 'Admin',      autoDerive: false, docLabel: 'Signed delivery receipt (customer copy)' },
  // A151: downstream sales/receivables close (auto-derived from Invoices / ARAging).
  { key: 'invoiced',                label: 'Customer Invoiced',                 owner: 'Accounting', autoDerive: true,  docLabel: 'Customer Sales Invoice' },
  { key: 'ar_open',                 label: 'Receivable Booked (AR)',            owner: 'Accounting', autoDerive: true,  docLabel: null },
  { key: 'collected',               label: 'Collected — Paid in Full',          owner: 'Accounting', autoDerive: true,  docLabel: 'Official Receipt / proof of collection' },
];

// ── 5-phase grouping ──────────────────────────────
const _SM_PHASES = [
  { name: 'Order',              stages: ['so_received','po_created','po_approved','po_sent'] },
  { name: 'Payment',            stages: ['proforma_received','prf_created','prf_approved','tt_sent','tt_forwarded'] },
  { name: 'Documents',          stages: ['shipping_docs_received','forwarder_quotes','forwarder_approved'] },
  { name: 'Logistics',          stages: ['booked','pickup','in_transit','customs_clearance','fan_sad_tan'] },
  { name: 'Delivery & Closing', stages: ['debit_memo','forwarder_final_invoice','local_charges','delivered','delivered_client'] },
  { name: 'Billing & Collection', stages: ['invoiced','ar_open','collected'] },
];

// ── Owner → roles that act without a warning ──────
const _SM_OWNER_ROLES = {
  'Sales':      ['Sales'],
  'Admin':      ['Admin'],
  'Sir Larry':  ['Management', 'Director'],
  'Accounting': ['Accounting'],
  'Supplier':   [],
  'Broker':     [],
  'Bank':       [],
  'Forwarder':  [],
  '—':          [],
};

// ── Owner badge CSS classes ───────────────────────
const _SM_OWNER_BADGE_CLASS = {
  'Sales':      'sm-owner-sales',
  'Admin':      'sm-owner-admin',
  'Sir Larry':  'sm-owner-sir-larry',
  'Accounting': 'sm-owner-accounting',
  'Supplier':   'sm-owner-supplier',
  'Broker':     'sm-owner-broker',
  'Bank':       'sm-owner-bank',
  'Forwarder':  'sm-owner-forwarder',
  '—':          'sm-owner-admin',
};

// ── Phase ribbon icons ────────────────────────────
const _SM_PHASE_ICONS = ['📋','💳','📄','🚚','📦','💰'];

// ─────────────────────────────────────────────────

/* One entry per stage key.
   fields[].field must match a property on the shipment record
   returned by getShipmentTimeline (snake_case as sent by the API
   OR the camelCase key used in _smAllRows — whichever the API
   sends; the renderer falls back gracefully if missing).
   format: 'currency' | 'date' | undefined (plain string)       */

const _SM_STAGE_META = {

  so_received: {
    description: 'A Sales Order from the client has been received and linked to this shipment, confirming the purchase intent.',
    fields: [
      { label: 'Linked SOs',      field: 'linkedSOs' },
      { label: 'Client',          field: 'client'    },
    ],
    requires: [],
    unlocks:  ['po_created'],
  },

  po_created: {
    description: 'A Purchase Order has been raised and linked to this shipment, authorising the procurement.',
    fields: [
      { label: 'PO No.',          field: 'poNo'   },
      { label: 'HI-ESCORP PO #',  field: 'hiPO'   },
      { label: 'Principal',       field: 'principal' },
    ],
    requires: ['so_received'],
    unlocks:  ['po_approved'],
  },

  po_approved: {
    description: 'Management has reviewed and given approval on the Purchase Order.',
    fields: [],
    requires: ['po_created'],
    unlocks:  ['po_sent'],
  },

  po_sent: {
    description: 'The approved Purchase Order has been transmitted to the supplier.',
    fields: [
      { label: 'Principal',       field: 'principal' },
      { label: 'Item',            field: 'item'      },
    ],
    requires: ['po_approved'],
    unlocks:  ['proforma_received'],
  },

  proforma_received: {
    description: 'The supplier has issued a Proforma Invoice or Order Confirmation, confirming pricing and availability.',
    fields: [
      { label: 'Principal',       field: 'principal' },
      { label: 'Item',            field: 'item'      },
      { label: 'Total Amount',    field: 'totalAmount',  format: 'currency' },
    ],
    requires: ['po_sent'],
    unlocks:  ['prf_created'],
  },

  prf_created: {
    description: 'A Payment Request (PRF) has been created and submitted to accounting for processing.',
    fields: [
      { label: 'Total Amount',    field: 'totalAmount',  format: 'currency' },
      { label: 'Payment Method',  field: 'paymentMethod' },
    ],
    requires: ['proforma_received'],
    unlocks:  ['prf_approved'],
  },

  prf_approved: {
    description: 'The Payment Request has received full approval from both the administrator and management.',
    fields: [],
    requires: ['prf_created'],
    unlocks:  ['tt_sent'],
  },

  tt_sent: {
    description: 'The Telegraphic Transfer has been initiated by accounting and sent to the bank.',
    fields: [
      { label: 'Amount Paid',     field: 'amountPaid',    format: 'currency' },
      { label: 'Payment Method',  field: 'paymentMethod'  },
      { label: 'Date of Payment', field: 'dateOfPayment', format: 'date'     },
    ],
    requires: ['prf_approved'],
    unlocks:  ['tt_forwarded'],
  },

  tt_forwarded: {
    description: 'The TT confirmation or receipt has been forwarded to the supplier as proof of payment.',
    fields: [
      { label: 'Payment Status',  field: 'paymentStatus' },
    ],
    requires: ['tt_sent'],
    unlocks:  ['shipping_docs_received'],
  },

  shipping_docs_received: {
    description: 'Packing List and Commercial Invoice have been received from the supplier, needed for customs and logistics.',
    fields: [
      { label: 'Principal',       field: 'principal' },
      { label: 'Item',            field: 'item'      },
    ],
    requires: ['tt_forwarded'],
    unlocks:  ['forwarder_quotes'],
  },

  forwarder_quotes: {
    description: 'Quotations from freight forwarders have been obtained and are ready for management review.',
    fields: [
      { label: 'Mode',            field: 'mode'      },
      { label: 'ETD',             field: 'etd',      format: 'date' },
    ],
    requires: ['shipping_docs_received'],
    unlocks:  ['forwarder_approved'],
  },

  forwarder_approved: {
    description: 'Management has selected and approved a forwarder for this shipment.',
    fields: [
      { label: 'Logistics Co.',   field: 'logistics' },
    ],
    requires: ['forwarder_quotes'],
    unlocks:  ['booked'],
  },

  booked: {
    description: 'The shipment has been booked with the chosen forwarder and an AWB or Waybill has been issued.',
    fields: [
      { label: 'AWB / Tracking #', field: 'awb'      },
      { label: 'Logistics Co.',    field: 'logistics' },
      { label: 'ETD',              field: 'etd',  format: 'date' },
      { label: 'ETA',              field: 'eta',  format: 'date' },
    ],
    requires: ['forwarder_approved'],
    unlocks:  ['pickup'],
  },

  pickup: {
    description: 'The forwarder has collected the goods from the supplier\'s premises and the shipment is in their custody.',
    fields: [
      { label: 'Logistics Co.',   field: 'logistics' },
      { label: 'ETD',             field: 'etd',  format: 'date' },
    ],
    requires: ['booked'],
    unlocks:  ['in_transit'],
  },

  in_transit: {
    description: 'The shipment is actively moving toward the destination. ETA indicates expected arrival.',
    fields: [
      { label: 'Mode',  field: 'mode' },
      { label: 'ETA',   field: 'eta',  format: 'date' },
      { label: 'AWB',   field: 'awb'  },
    ],
    requires: ['pickup'],
    unlocks:  ['customs_clearance'],
  },

  customs_clearance: {
    description: 'The shipment has arrived and is being processed through customs. Duties and fees may apply.',
    fields: [
      { label: 'Import Duties',       field: 'importDuties',     format: 'currency' },
      { label: 'Customs/Brokerage',   field: 'customsBrokerage', format: 'currency' },
    ],
    requires: ['in_transit'],
    unlocks:  ['fan_sad_tan'],
  },

  fan_sad_tan: {
    description: 'Official customs release documents (FAN, SAD, or TAN) have been obtained from the broker.',
    fields: [],
    requires: ['customs_clearance'],
    unlocks:  ['debit_memo'],
  },

  debit_memo: {
    description: 'The bank has issued a Debit Memo reflecting the charges for this shipment.',
    fields: [],
    requires: ['fan_sad_tan'],
    unlocks:  ['forwarder_final_invoice'],
  },

  forwarder_final_invoice: {
    description: 'The freight forwarder has issued their final invoice covering all logistics services rendered.',
    fields: [
      { label: 'Freight-In',  field: 'freightIn',  format: 'currency' },
      { label: 'Handling',    field: 'handling',   format: 'currency' },
    ],
    requires: ['debit_memo'],
    unlocks:  ['local_charges'],
  },

  local_charges: {
    description: 'Local delivery fees for transporting the goods from the port or warehouse to the office have been settled.',
    fields: [
      { label: 'Delivery Expense', field: 'deliveryExpense', format: 'currency' },
    ],
    requires: ['forwarder_final_invoice'],
    unlocks:  ['delivered'],
  },

  delivered: {
    description: 'The goods have been delivered to the office / received into inventory. The downstream sales side (invoice → receivable → collection) follows.',
    fields: [
      { label: 'Date Arrived',      field: 'dateArrived',    format: 'date' },
      { label: 'Delivery Receipt #', field: 'deliveryReceipt' },
    ],
    requires: ['local_charges'],
    unlocks:  ['delivered_client'],
  },

  // A195: the customer handover. Its signed delivery receipt is what permits invoicing.
  delivered_client: {
    description: 'The goods have been delivered to the customer and their signed delivery receipt is on file. This is the proof that permits invoicing.',
    fields: [
      { label: 'Date Delivered',     field: 'dateDeliveredClient', format: 'date' },
      { label: 'Delivery Receipt #', field: 'deliveryReceiptClient' },
    ],
    requires: ['delivered'],
    unlocks:  ['invoiced'],
  },

  invoiced: {
    description: 'A customer Sales Invoice has been issued for this order. Auto-derived when an Invoice exists for the SO.',
    fields: [
      { label: 'Customer', field: 'client' },
    ],
    requires: ['delivered_client'],
    unlocks:  ['ar_open'],
  },

  ar_open: {
    description: 'The receivable has been booked in AR Aging — the client owes the invoiced amount. Auto-derived when an AR row exists for the SO.',
    fields: [],
    requires: ['invoiced'],
    unlocks:  ['collected'],
  },

  collected: {
    description: 'Payment has been collected in full — every receivable for this order is marked Paid. This closes the lifecycle.',
    fields: [],
    requires: ['ar_open'],
    unlocks:  [],
  },

};
