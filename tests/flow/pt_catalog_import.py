"""A333 — the Power Team catalog importer, fed rows copied from the PDF (no PDF needed).

Run:  ./venv/bin/python tests/flow/pt_catalog_import.py

tools_pt_catalog.py turns 284 pages of text into pt_catalog.json. Its parsers locate columns by the
catalog's own identities (closed + stroke = extended, area x stroke = oil) rather than by position,
so the test is that rows copied from the real pages come out with the numbers printed on them:
the C-series rows on PDF 14, the hand pumps on PDF 53 (gallons turned into cubic inches), hoses on
PDF 137, gauges on PDF 141, the master chart on PDF 11, and the wrapped rows of the 2025 Power Team
Crossover Reference. Set PT_CATALOG_PDF to the catalog to also check the committed JSON is current.
"""
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
sys.path.insert(0, ROOT)

import tools_pt_catalog as T                                          # noqa: E402

FAIL = 0


def ok(label, cond, extra=None):
    global FAIL
    if cond:
        print("  ok   " + label)
    else:
        FAIL += 1
        print("  FAIL " + label + ("" if extra is None else "\n         " + repr(extra)[:300]))


# ── PDF 11: the master chart (group label on its own line, then 'Ton') ─────────────────────────
CHART_11 = """powerteam.com
9
10
Ton
0.44 1.8 SA RLS100 18
1.00 3.6 SA C101C 12
6.25 11.7 DA RD106 34
8.13 11.8 SA C108C 12
15
Ton
4.13 7.9 SA C154C 12
6.13 10.7 SA C156C 12
25
Ton
4.00 8.5 SA C254C 12
"""
chart, dups = T.parse_master_chart([CHART_11])
ok("chart: C108C is 10 t SA, 8.13 stroke, page 12", chart.get("C108C") == {"stroke": 8.13, "closed": 11.8, "act": "SA", "cap": 10.0, "pg": 12}, chart.get("C108C"))
ok("chart: RD106 is double-acting", chart["RD106"]["act"] == "DA")
ok("chart: the 15 t group carries to C156C", chart["C156C"]["cap"] == 15.0)
ok("chart: no duplicates in a clean excerpt", dups == [])

# ── PDF 14: C-series spec rows (capacity on its own line before each group) ─────────────────────
PAGE_14 = """powerteam.com
12
Cylinders
10
8.13 C108C 19.90 11.75 19.88 2.25 2 1/4-14 1.13 0.75 1.50 1-8 x 0.75 0.25 1.69 2.236 8,948 11.20 11.00
16.00 C1016C 36.10 20.50 36.50 2.25 2 1/4-14 1.13 0.75 1.50 1-8 x 0.75 0.25 1.69 2.236 8,948 11.20 18.50
15
4.13 C154C 12.90 7.88 12.00 2.75 2 3/4-16 1.13 0.75 1.75 1-8 x 0.75 0.25 2.00 3.142 9,549 15.70 11.50
6.13 C156C 19.20 10.69 16.81 2.75 2 3/4-16 1.13 0.75 1.75 1-8 x 0.75 0.25 2.00 3.142 9,549 15.70 15.30
25
4.00 C254C 20.60 8.50 12.50 3.38 3 5/16-12 1.94 1.00 2.25 1 1/2-16 x 0.88 0.38 2.56 5.15 9,699 25.80 17.60
"""
ok("printed page of PDF 14 is 12", T.detect_printed_page(PAGE_14) == 12)
cyl, warns = T.parse_cylinders([(14, PAGE_14)], chart)
want = {
    "C108C": dict(cap=10.0, stroke=8.13, oil=19.9, closed=11.75, ext=19.88, area=2.236, psiCap=8948.0, t10k=11.2, wt=11.0),
    "C1016C": dict(cap=10.0, stroke=16.0, oil=36.1, closed=20.5, ext=36.5, t10k=11.2, wt=18.5),
    "C154C": dict(cap=15.0, stroke=4.13, oil=12.9, closed=7.88, ext=12.0, area=3.142, t10k=15.7, wt=11.5),
    "C156C": dict(cap=15.0, stroke=6.13, oil=19.2, closed=10.69, ext=16.81, wt=15.3),
    "C254C": dict(cap=25.0, stroke=4.0, oil=20.6, closed=8.5, ext=12.5, area=5.15, psiCap=9699.0, t10k=25.8, wt=17.6),
}
for m, fields in want.items():
    got = {k: cyl.get(m, {}).get(k) for k in fields}
    ok("PDF 14 %s reads as printed" % m, got == fields, got)
ok("PDF 14 rows carry their page", cyl["C108C"]["pdf"] == 14)
# The catalog prints C108C's oil as 19.90 in3, but 2.236 in2 x 8.13 in = 18.18: a real inconsistency on
# p.12 (its neighbours C106C and C1010C agree with area x stroke). It is reported, and the printed figure kept.
ok("the one inconsistent row on PDF 14 (C108C oil) is reported, nothing else",
   [(w["model"], w["issue"]) for w in warns] == [("C108C", "oil 19.90 differs from area x stroke 18.18")], warns)
ok("C108C keeps the printed 19.90", cyl["C108C"]["oil"] == 19.9)
ok("series of C108C is C, of RD106 is RD, of RLS100 is RLS",
   (T.cyl_series("C108C"), T.cyl_series("RD106"), T.cyl_series("RLS100")) == ("C", "RD", "RLS"))

# ── PDF 53: hand pumps (SA / DA labels above the rows, reservoirs in gallons) ───────────────────
PAGE_53 = """powerteam.com
51
(cu. in) (cu. in) (psi) (psi) (lbs.) (cu. in.) (cu. in.) (in.) (lbs.)
Single-Acting
Cylinders
2 P157 0.65 0.160 1,400 10,000 140 152 137 3/8 NPTF 26.70
2 P159 2.60 0.160 325 10,000 140 152 137 3/8 NPTF 26.20
2 P300 2.60 0.160 325 10,000 140 1.5 gal. 310 3/8 NPTF 55.30
Double-Acting
Cylinders*
2 P159D 2.60 0.160 325 10,000 140 152 137 3/8 NPTF 27.90
"""
hand, hw = T.parse_hand_pumps([(53, PAGE_53)])
ok("P159: 2.60 in3 to 325 psi, then 0.160 in3 to 10,000; 137 in3 usable",
   {k: hand["P159"][k] for k in ("lpVol", "lpPsi", "hpVol", "maxPsi", "usable", "speed", "act", "pow")}
   == {"lpVol": 2.6, "lpPsi": 325.0, "hpVol": 0.16, "maxPsi": 10000.0, "usable": 137.0, "speed": 2, "act": "SA", "pow": "manual"},
   hand.get("P159"))
ok("P157: first stage 0.65 in3 to 1,400 psi", (hand["P157"]["lpVol"], hand["P157"]["lpPsi"]) == (0.65, 1400.0))
ok("P300: '1.5 gal.' reservoir is 346.5 in3", hand["P300"]["res"] == 346.5, hand["P300"]["res"])
ok("P159D is double-acting", hand["P159D"]["act"] == "DA")
ok("no hand-pump warnings", hw == [], hw)

# ── PDF 137: wire-braid hoses (9754 comes with coupler and cap) ────────────────────────────────
PAGE_137 = """powerteam.com
135
Rubber, Wire-Braid 1/4" 6 20,000 9756
Rubber, Wire-Braid 1/4" 6 20,000    9754**
Rubber, Wire-Braid* 3/8" 10 20,000 9777
"""
hoses = T.parse_hoses([(137, PAGE_137)])
ok("9756: 1/4 in, 6 ft, rubber, no coupler", (hoses["9756"]["id"], hoses["9756"]["len"], hoses["9756"]["type"], hoses["9756"]["withCoupler"]) == ('1/4"', 6.0, "rubber", False), hoses.get("9756"))
ok("9754 is furnished with the 9798 coupler", hoses["9754"]["withCoupler"] is True)
ok("9777 is a 3/8 in high-flow hose", hoses["9777"]["highFlow"] is True and hoses["9777"]["id"] == '3/8"')

# ── PDF 141: gauges and the cylinder series they read in tons ───────────────────────────────────
PAGE_141 = """powerteam.com
139
9040 2.5 0-10,000 – 2500 psi 500 psi Yes All
9055 4.0 0-10,000 0-10 2000 psi, 1 Ton 200 psi, .1 Ton No* C, RD, RH, RLS & RSS
9063 4.0 0-10,000 0-25 2000 psi, 5 Ton 200 psi, .5 Ton No* C & RD
"""
g = T.parse_gauges([(141, PAGE_141)])
ok("9055 reads 0-10 ton for C, RD, RH, RLS & RSS", g["9055"]["tonScale"] == 10.0 and g["9055"]["series"].startswith("C, RD"), g.get("9055"))
ok("9063 reads 0-25 ton", g["9063"]["tonScale"] == 25.0)
ok("9040 is a plain psi gauge", not g["9040"].get("tonScale"))

# ── the 2025 Power Team Crossover Reference ────────────────────────────────────────────────────
XREF_17 = """17
2025 POWER TEAM CROSSOVER REFERENCE
Enerpac
Part Number
Power Team
Part Number Power Team Description Match
E = Equivalant S = Similar
P80 P159 PUMP, HAND TWO SPEED
P84 P159D PUMP, HAND TWO SPEED
RC108 C108C CYL, 10 TON 8-1/8" STROKE
RC50 RLS50 CYL, 5 TON 9/16" STROKE E
HP60 RPS2514, LESS C2514C, PLUS
RH603 SET, CYLINDER & PUMP S
PES3202B PE55C, 40063OR9, 25017, 9582,
9625, 2/9637 PUMP, ELEC ATO ONLY
IPH10080
SPE10013DS, LESS PQ1204S,
RD10013, PLUS P460D, PLUS
RD1006
PRESS, 100 TON S
HP483 8023, 8028, 8029 2 EACH ADAPTER, THREADED
GA45GC 9040GA 45" GAUGE
SMF41 LM4S Split Flow Manifold Single Acting
"""
rows, xw = T.parse_crossover([(17, XREF_17)])
R = {r[0]: r for r in rows}
ok("crossover: every row understood", xw == [] and len(rows) == 10, (xw, [r[0] for r in rows]))
ok("crossover: P80 -> P159, match type not stated, page 17", R["P80"] == ["P80", [["P159", 1]], [], [], "PUMP, HAND TWO SPEED", "", 17], R.get("P80"))
ok("crossover: RC108 -> C108C", R["RC108"][1] == [["C108C", 1]])
ok("crossover: RC50 -> RLS50 is marked equivalent", R["RC50"][5] == "E")
ok("crossover: a wrapped kit row keeps LESS and PLUS", R["HP60"][1:4] == [[["RPS2514", 1]], ["C2514C"], [["RH603", 1]]] and R["HP60"][5] == "S", R.get("HP60"))
ok("crossover: '2/9637' is two of 9637", ["9637", 2] in R["PES3202B"][1], R.get("PES3202B"))
ok("crossover: a row split over five lines", R["IPH10080"][1:5] == [[["SPE10013DS", 1]], ["PQ1204S", "RD10013"], [["P460D", 1], ["RD1006", 1]], "PRESS, 100 TON"], R.get("IPH10080"))
ok("crossover: '2 EACH' sets the quantity of each part", R["HP483"][1] == [["8023", 2], ["8028", 2], ["8029", 2]], R.get("HP483"))
ok("crossover: a 45\" size is description, not a part", R["GA45GC"][1] == [["9040GA", 1]] and R["GA45GC"][4] == '45" GAUGE', R.get("GA45GC"))
ok("crossover: mixed-case description", R["SMF41"][4] == "Split Flow Manifold Single Acting")

# ── family links (products.json ids are only used when they exist) ─────────────────────────────
fams = {"pt-c-10", "pt-p157", "pt-pe55"}
ok("C108C belongs to pt-c-10", T.family_id({"m": "C108C", "cat": "cylinder", "ser": "C", "cap": 10.0}, fams) == "pt-c-10")
ok("P157 belongs to pt-p157", T.family_id({"m": "P157", "cat": "pump"}, fams) == "pt-p157")
ok("PE552 belongs to pt-pe55", T.family_id({"m": "PE552", "cat": "pump"}, fams) == "pt-pe55")
ok("no family is invented", T.family_id({"m": "C254C", "cat": "cylinder", "ser": "C", "cap": 25.0}, fams) is None)

# ── the committed files ────────────────────────────────────────────────────────────────────────
data = os.path.join(ROOT, "dashboard", "data")
cat = json.load(open(os.path.join(data, "pt_catalog.json")))
xr = json.load(open(os.path.join(data, "pt_crossover.json")))
ok("pt_catalog.json names its PDF by sha256", cat["_source"]["sha256"].startswith("a0ab2c63c4d2") and cat["_source"]["pages"] == 284)
ok("pt_crossover.json names its PDF by sha256", xr["_source"]["sha256"].startswith("9ec190865ad8") and xr["_source"]["url"].startswith("https://hydraulictechnologies.com/"))
ok("crossover has no unread rows", xr["_warnings"] == [] and len(xr["rows"]) >= 800, (len(xr["_warnings"]), len(xr["rows"])))

pdf = os.environ.get("PT_CATALOG_PDF")
if pdf:
    ok("pt_catalog.json matches a fresh import of PT_CATALOG_PDF", T.main([pdf, "--check"]) == 0)
else:
    print("  skip drift check: set PT_CATALOG_PDF to the catalog PDF")

print("\n%s" % ("all passed" if not FAIL else "%d FAILED" % FAIL))
sys.exit(1 if FAIL else 0)
