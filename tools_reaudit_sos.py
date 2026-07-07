#!/usr/bin/env python3
"""Re-audit: every Recon.xlsx SO must have a header + cost detail + invoice, and totals must match.
Run AFTER redeploying FlowAPI v65 and re-running Step 2 on the Replace 2026 SOs tool:
  ./venv/bin/python tools_reaudit_sos.py"""
import openpyxl, json, urllib.request, collections
wb = openpyxl.load_workbook("/Users/neilestur/Downloads/Recon.xlsx", data_only=True)
rows = [r for r in wb['Sheet1'].iter_rows(min_row=2, values_only=True) if r[0] and str(r[0]).strip() != 'TOTAL']
file_sos = {str(r[0]).strip(): float(r[6] or 0) for r in rows}
FLOW = "https://script.google.com/macros/s/AKfycbyOnYzt0M7HePi4VTEHINDaMxNi_ppvjGUyT4cSaExG-oPtjUYWZ6mcjxx9uVNgyyXY/exec"
def g(a):
    with urllib.request.urlopen(f"{FLOW}?action={a}", timeout=90) as r: return json.load(r)
ver = g("getVersion"); print("FlowAPI version:", ver.get("version"))
sos = {str(s["soNo"]).strip(): s for s in g("getSalesOrders")["data"]}
cds = {str(c.get("soNo","")).strip(): c for c in g("getSOCostDetails").get("data", [])}
invs = collections.Counter(str(v.get("soNo","")).strip() for v in g("getInvoices").get("data", []))
miss_h = [k for k in file_sos if k not in sos]
miss_c = [k for k in file_sos if k not in cds]
miss_i = [k for k in file_sos if invs.get(k,0)==0]
tot = sum(float(sos[k].get("total") or 0) for k in file_sos if k in sos)
print(f"file SOs: {len(file_sos)}")
print(f"missing headers: {len(miss_h)} {miss_h}")
print(f"missing cost details: {len(miss_c)} {miss_c}")
print(f"missing invoices: {len(miss_i)} {miss_i}")
print(f"sum of header totals for file SOs: {tot:,.2f} (expected 8,535,630.46)")
ok = not miss_h and not miss_c and not miss_i and abs(tot-8535630.46) < 1
print("RESULT:", "✅ ALL CONSISTENT — every dashboard shows the same 37 SOs" if ok else "❌ INCONSISTENT — see above")
