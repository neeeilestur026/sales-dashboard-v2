#!/usr/bin/env python3
"""A265 — apply the filled-in COmpleted.xlsx back into the live book.

Dry-run by default: it prints every call it intends to make, with the values, and writes nothing.
Pass --apply to actually send them.

    ./venv/bin/python tools_apply_completed.py                  # show what would happen
    ./venv/bin/python tools_apply_completed.py --apply          # do it

Three passes, each idempotent:

  1  cost details   saveSOCostDetails   — 7 orders (not secured, posts no journal)
  2  collections    importCollections   — creates the AR row AND the payment; skips by INV No
  3  orphans        attachOrphanToSO    — sets 'SO No' on an existing AR / Collection row (A265)

Deliberately held back, per the user's decisions:
  · cost row 10 — no SO No on it at all
  · PO7652 / 2320002992 / 3120001511 | T21 — flagged "Incorrect SO Total", Invoice Sales is 0, so a
    cost record now would report real COGS against zero revenue
  · DEMO-AR-001 / DEMO-COL-001 — demo records pointed at a real order
  · AR-202606-030 / COL-202606-014 — the unresolved T6/T16 mismatch
"""
import argparse
import datetime as dt
import json
import sys
import time
import urllib.parse
import urllib.request

import openpyxl

FLOW = ("https://script.google.com/macros/s/"
        "AKfycbyOnYzt0M7HePi4VTEHINDaMxNi_ppvjGUyT4cSaExG-oPtjUYWZ6mcjxx9uVNgyyXY/exec")
BOOK = "COmpleted.xlsx"

# Held back — see the module docstring. Named, not inferred.
SKIP_COST = {"PO7652", "2320002992", "3120001511 | T21"}
SKIP_ORPHAN = {"DEMO-AR-001", "DEMO-COL-001", "AR-202606-030", "COL-202606-014"}

K = lambda v: str(v or "").strip()


def num(v):
    """Sheet money cells arrive as floats OR as '  ₱210,224.05 \\n'. Both must parse."""
    if isinstance(v, (int, float)):
        return float(v)
    s = K(v).replace("₱", "").replace(",", "").replace(" ", "").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def date_str(v):
    """-> YYYY-MM-DD, or '' if there is nothing usable. Text dates are US-style MM/DD/YYYY."""
    if v in (None, ""):
        return ""
    if isinstance(v, dt.datetime):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, dt.date):
        return v.strftime("%Y-%m-%d")
    s = K(v)
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d"):
        try:
            return dt.datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return s


def call(action, params, apply, tries=3):
    """Apps Script is slow and the TLS handshake to it does time out. Retry, because every action
    used here is idempotent — importCollections skips by INV No, saveSOCostDetails upserts by SO No,
    attachOrphanToSO is a single cell set — so a retry after an ambiguous failure cannot double-post."""
    if not apply:
        return {"success": True, "dryRun": True}
    data = urllib.parse.urlencode(dict(params, action=action)).encode()
    last = None
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(FLOW, data=data)
            with urllib.request.urlopen(req, timeout=600) as r:
                return json.load(r)
        except Exception as e:                      # noqa: BLE001 - network, any of them
            last = e
            print(f"       (attempt {attempt}/{tries} failed: {type(e).__name__}: {e})")
            if attempt < tries:
                time.sleep(5 * attempt)
    return {"success": False, "message": f"network failed after {tries} tries: {last}"}


def fetch(action):
    with urllib.request.urlopen(f"{FLOW}?action={action}", timeout=300) as r:
        return json.load(r).get("data") or []


# ─────────────────────────────────────────────────────────────── pass 1: cost details
def cost_rows(wb, live_cd):
    ws = wb["FILL - Cost Details"]
    out, held = [], []
    for r in range(5, ws.max_row + 1):
        so = K(ws.cell(r, 1).value)
        if not so:
            if any(ws.cell(r, c).value not in (None, "") for c in range(6, 14)):
                held.append((r, "(no SO No on the row)", "unidentified"))
            continue
        if so in SKIP_COST:
            held.append((r, so, "Incorrect SO Total flagged; Invoice Sales is 0"))
            continue
        if so in live_cd:
            held.append((r, so, "already has a cost record live"))
            continue
        intl = K(ws.cell(r, 6).value).lower().startswith("int")
        out.append(dict(
            row=r, soNo=so, customer=K(ws.cell(r, 2).value), date=date_str(ws.cell(r, 3).value),
            sales=num(ws.cell(r, 5).value) or 0.0,
            cogsType="international" if intl else "local",
            purchaseOfGoods=num(ws.cell(r, 7).value) or 0.0,
            dutiesAndTaxes=num(ws.cell(r, 8).value) or 0.0,
            shippingCost=num(ws.cell(r, 9).value) or 0.0,
            localCharges=num(ws.cell(r, 10).value) or 0.0,
            deliveryToOffice=num(ws.cell(r, 11).value) or 0.0,
            deliveryToClient=num(ws.cell(r, 12).value) or 0.0,
            bankChargeCOGS=num(ws.cell(r, 13).value) or 0.0,
            bankChargeShipping=0.0, shippingCompany="",
        ))
    return out, held


def expected_cogs(c):
    t = c["purchaseOfGoods"] + c["deliveryToOffice"] + c["deliveryToClient"]
    if c["cogsType"] == "international":
        t += c["bankChargeCOGS"] + c["dutiesAndTaxes"] + c["bankChargeShipping"] \
             + c["shippingCost"] + c["localCharges"]
    return round(t, 2)


# ─────────────────────────────────────────────────────────── pass 2: collections
def collection_rows(wb, ar_inv, ar_so):
    ws = wb["FILL - Collections"]
    out, held = [], []
    for r in range(5, ws.max_row + 1):
        so = K(ws.cell(r, 1).value)
        if not so:
            continue
        invNo = K(ws.cell(r, 3).value)
        ans = K(ws.cell(r, 8).value).lower()
        amt = num(ws.cell(r, 10).value)
        # 9 rows carry amount + EWT + method but no Yes/No. The data says paid.
        paid = ans == "yes" or (not ans and amt is not None)
        if not paid:
            held.append((r, so, "answered No — still outstanding, nothing to record"))
            continue
        if invNo in ar_inv or so in ar_so:
            held.append((r, so, "AR row already exists — importCollections would skip it"))
            continue
        # Blank is not an option: importCollections turns an empty date into TODAY, which would
        # drop historic payments into the current month. Fall back to the invoice date.
        when = date_str(ws.cell(r, 9).value) or date_str(ws.cell(r, 4).value)
        sales = num(ws.cell(r, 5).value) or 0.0
        ewt = num(ws.cell(r, 11).value) or 0.0
        recv = amt or 0.0
        # The receivable is booked NET of the customer's withholding — that is the live convention
        # (AR-202606-001: Amount = Net + VAT - EWT = Collected). The sheet's 'Invoice Sales' is the
        # system's invoice figure, which under the VAT-exclusive convention is 12% BELOW what was
        # actually receivable; importing it verbatim booked 37 of these as over-collected.
        # A payment is a FULL settlement when it matches one of the two live conventions:
        #   VAT-exclusive invoice -> received = sales x 1.12 - EWT
        #   VAT-inclusive invoice -> received = sales - EWT
        tol = max(1.0, sales * 0.0005)
        full = abs(recv - (sales * 1.12 - ewt)) < tol or abs(recv - (sales - ewt)) < tol
        if not full:
            held.append((r, so, f"received {recv:,.2f} against an invoice of {sales:,.2f} "
                                f"({recv/sales*100:.1f}%) — full settlement or part payment?"))
            continue
        out.append(dict(
            row=r, soNo=so, customer=K(ws.cell(r, 2).value), invoiceNo=invNo,
            totalAmountDue=round(recv, 2),
            amountReceived=recv, ewt=ewt,
            dateCollected=when, dueDate=date_str(ws.cell(r, 4).value),
            method=K(ws.cell(r, 12).value), ref=K(ws.cell(r, 13).value),
            notes=K(ws.cell(r, 14).value) or "Migrated (legacy)",
            _dateFromInvoice=not date_str(ws.cell(r, 9).value),
        ))
    return out, held


# ─────────────────────────────────────────────────────────── pass 3: orphans
def orphan_rows(wb, live_so):
    ws = wb["FILL - Attach Orphans"]
    out, held = [], []
    for r in range(5, ws.max_row + 1):
        rec = K(ws.cell(r, 2).value)
        if not rec:
            continue
        if rec in SKIP_ORPHAN:
            held.append((r, rec, "held back deliberately — see the docstring"))
            continue
        guess = K(ws.cell(r, 9).value)
        given = ws.cell(r, 11).value
        if isinstance(given, float) and given == int(given):
            given = str(int(given))          # 4500025873.0 -> '4500025873'
        given = K(given)
        soNo = given or ("" if guess.startswith("—") else guess)
        if not soNo:
            held.append((r, rec, "no SO No given and I could not match it"))
            continue
        if soNo not in live_so:
            held.append((r, rec, f"'{soNo}' is not a live sales order"))
            continue
        out.append(dict(row=r, type="ar" if K(ws.cell(r, 1).value).lower() == "ar" else "collection",
                        recordNo=rec, soNo=soNo))
    return out, held


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="actually send the writes")
    ap.add_argument("--only", choices=["cost", "collections", "orphans", "meta"], help="run one pass")
    args = ap.parse_args()
    mode = "APPLYING" if args.apply else "DRY RUN — nothing will be written"
    print(f"=== {mode} ===\n")

    print("reading the live ledgers…")
    cd = {K(c.get("soNo")) for c in fetch("getSOCostDetails")}
    ar = fetch("getARAging")
    ar_inv = {K(a.get("invNo")) for a in ar}
    ar_so = {K(a.get("soNo")) for a in ar if K(a.get("soNo"))}
    live_so = {K(s.get("soNo")) for s in fetch("getSalesOrders")}
    ver = json.load(urllib.request.urlopen(f"{FLOW}?action=getVersion", timeout=120)).get("version")
    print(f"  FlowAPI v{ver} · {len(cd)} cost records · {len(ar)} AR rows · {len(live_so)} sales orders\n")

    wb = openpyxl.load_workbook(BOOK)
    costs, cost_held = cost_rows(wb, cd)
    cols, col_held = collection_rows(wb, ar_inv, ar_so)
    orphs, orph_held = orphan_rows(wb, live_so)

    run = args.only

    # ---- 1 cost details -------------------------------------------------------
    if run in (None, "cost"):
        print(f"── PASS 1 · cost details — {len(costs)} to write ──")
        for c in costs:
            print(f"  row {c['row']:>3} {c['soNo'][:22]:22} {c['cogsType']:13} "
                  f"sales {c['sales']:>13,.2f}  COGS {expected_cogs(c):>12,.2f}")
        for r, so, why in cost_held:
            print(f"       skip {so[:26]:26} — {why}")
        if costs:
            print()
            for c in costs:
                rec = {k: v for k, v in c.items() if k != "row"}
                res = call("saveSOCostDetails", {"record": json.dumps(rec)}, args.apply)
                ok = res.get("success")
                print(f"  {'ok ' if ok else 'FAIL'} {c['soNo'][:24]:24} {res.get('message','(dry run)')}")
                if not ok:
                    print(f"       -> {json.dumps(res)[:300]}")
        print()

    # ---- 2 collections --------------------------------------------------------
    if run in (None, "collections"):
        print(f"── PASS 2 · collections — {len(cols)} to import ──")
        fb = sum(1 for c in cols if c["_dateFromInvoice"])
        print(f"  {fb} of them take the invoice date because Date Paid was blank")
        for c in cols[:8]:
            print(f"  row {c['row']:>3} {c['soNo'][:20]:20} {c['invoiceNo'][:18]:18} "
                  f"due {c['totalAmountDue']:>12,.2f} recd {c['amountReceived']:>12,.2f} "
                  f"{c['dateCollected']} {c['method'][:12]}")
        if len(cols) > 8:
            print(f"  …and {len(cols)-8} more")
        for r, so, why in col_held:
            if not why.startswith("answered No"):
                print(f"       HOLD row {r:>3} {so[:22]:22} — {why}")
        print(f"       skip {sum(1 for _,_,w in col_held if w.startswith('answered No'))} answered No")
        if cols:
            items = [{k: v for k, v in c.items() if not k.startswith("_") and k != "row"} for c in cols]
            BATCH = 8          # 46 in one payload timed out the handshake; small batches recover
            madeAR = madePay = skipped = 0
            print()
            for i in range(0, len(items), BATCH):
                chunk = items[i:i + BATCH]
                res = call("importCollections", {"items": json.dumps(chunk)}, args.apply)
                if res.get("success"):
                    madeAR += res.get("createdAR", 0) or 0
                    madePay += res.get("createdPayments", 0) or 0
                    skipped += res.get("skipped", 0) or 0
                    print(f"  ok  batch {i//BATCH + 1}: {res.get('message','(dry run)')}")
                else:
                    print(f"  FAIL batch {i//BATCH + 1}: {res.get('message')}")
                for e in (res.get("errors") or [])[:5]:
                    print(f"       error {e}")
            if args.apply:
                print(f"\n  totals: {madeAR} receivable(s), {madePay} payment(s), {skipped} skipped")
        print()

    # ---- 3 orphans ------------------------------------------------------------
    if run in (None, "orphans"):
        print(f"── PASS 3 · orphan attachment — {len(orphs)} to attach ──")
        if int(str(ver)) < 145:
            print(f"  SKIPPED — needs FlowAPI v145 (attachOrphanToSO); live is v{ver}.")
            print("  Paste and deploy apps-script/FlowAPI.gs, then re-run with --only orphans.")
        else:
            for o in orphs[:8]:
                print(f"  row {o['row']:>3} {o['type']:10} {o['recordNo'][:18]:18} -> {o['soNo']}")
            if len(orphs) > 8:
                print(f"  …and {len(orphs)-8} more")
            for r, rec, why in orph_held:
                print(f"       skip {rec[:24]:24} — {why}")
            ok = fail = 0
            for o in orphs:
                res = call("attachOrphanToSO", {"type": o["type"], "recordNo": o["recordNo"],
                                                "soNo": o["soNo"], "confirmReattach": "1"}, args.apply)
                if res.get("success"):
                    ok += 1
                else:
                    fail += 1
                    print(f"  FAIL {o['recordNo'][:20]:20} {res.get('message')}")
            print(f"\n  attached {ok}, failed {fail}")
        print()

    # ---- 4 backfill Method / Reference / Notes onto collections imported under v144 -----
    if run in (None, "meta"):
        live_cols = fetch("getCollections")
        by_inv = {}
        for c in live_cols:
            by_inv.setdefault(K(c.get("invNo")), []).append(c)
        ws = wb["FILL - Collections"]
        todo = []
        for r in range(5, ws.max_row + 1):
            invNo = K(ws.cell(r, 3).value)
            method = K(ws.cell(r, 12).value)
            ref = K(ws.cell(r, 13).value)
            if not invNo or not (method or ref):
                continue
            for c in by_inv.get(invNo, []):
                if K(c.get("method")) == method:
                    continue                                  # already carries it
                todo.append(dict(collectionNo=K(c.get("collectionNo")), method=method, ref=ref))
        print(f"── PASS 4 · collection Method/Reference backfill — {len(todo)} to set ──")
        if int(str(ver)) < 145:
            print(f"  SKIPPED — needs FlowAPI v145 (setCollectionMeta); live is v{ver}.")
            print("  Paste and deploy apps-script/FlowAPI.gs, then re-run with --only meta.")
        else:
            ok = fail = 0
            for t in todo:
                res = call("setCollectionMeta", t, args.apply)
                if res.get("success"):
                    ok += 1
                else:
                    fail += 1
                    print(f"  FAIL {t['collectionNo']}: {res.get('message')}")
            print(f"  set {ok}, failed {fail}")
        print()

    if not args.apply:
        print("Nothing was written. Re-run with --apply to send it.")


if __name__ == "__main__":
    main()
