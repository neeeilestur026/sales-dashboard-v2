"""A333 — Power Team catalog importer: PDF text -> dashboard/data/pt_catalog.json + pt_index.json.

    ./venv/bin/python -I tools_pt_catalog.py "<catalog.pdf>"            [--out dashboard/data] [--check]
    ./venv/bin/python -I tools_pt_catalog.py --text-json pages.json      (development: page text already extracted)
    ./venv/bin/python -I tools_pt_catalog.py --crossover "<HT_PT_Crossover_Reference_0425.pdf>"   -> pt_crossover.json

The catalog (SPX FLOW "PT_Catalog_0124_US", 284 pages, 61 MB) stays OUT of the repo; its sha256 is
recorded so a regenerated file can be traced to the exact PDF. Everything after extract_pages() is a
pure function over page text, so tests feed copied rows through it without the PDF.

What it produces:
  * pt_catalog.json — one record per orderable model with STRUCTURED specs where the catalog has a
    spec table (cylinders, hand pumps, jacks, hoses, gauges, sets, torque wrenches, presses, pullers)
    and series-level facts elsewhere (powered pumps are marked partial).
  * pt_index.json   — every order number in the book with its page and heading, so the whole
    catalog is searchable even where no table parser exists.
  * pt_crossover.json (--crossover) — the official 2025 Power Team Crossover Reference (Hydraulic
    Technologies), Enerpac number -> Power Team parts, with LESS/PLUS kits and the E/S match letter.

Rules that keep it honest:
  * A row that does not fit its layout goes to _warnings — it is never guessed.
  * The master tonnage chart (PDF 11-12) is cross-checked against the spec tables (closed height
    within 0.06 in); its known typos are listed in ERRATA rather than silently "fixed".
  * Capacities are the catalog's: US short tons (PDF 181: "multiply by 0.907 for metric tons").
  * No prices: /data/*.json is served without login.
"""
import argparse
import hashlib
import json
import os
import re
import sys
from datetime import date

GAL_IN3 = 231.0

# ── page text ───────────────────────────────────────────────────────────────────────────────────

def extract_pages(path):
    """[(pdf_page_no, text)] — pypdf imported here so the tests can import this module without it."""
    import logging
    import pypdf
    logging.disable(logging.CRITICAL)            # pypdf's font warnings are noise for text extraction
    r = pypdf.PdfReader(path)
    return [(i + 1, p.extract_text() or '') for i, p in enumerate(r.pages)], pypdf.__version__


def detect_printed_page(text):
    """The number printed on the page. Most pages print it alone on a line near the top or bottom; the
    puller section prints '225 powerteam.com'; a few print 'powerteam.com 9'. None when absent."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    probe = lines[:5] + lines[-5:]
    for l in probe:
        m = re.fullmatch(r'(\d{1,3})', l) or re.fullmatch(r'(\d{1,3})\s+powerteam\.com', l) \
            or re.fullmatch(r'powerteam\.com\s+(\d{1,3})', l)
        if m:
            return int(m.group(1))
    return None


def num(tok):
    """'10,061' -> 10061.0; '—'/'-'/'–' -> None; '1.5 gal.' handled by the caller."""
    t = str(tok).strip().rstrip('*†‡').replace(',', '')
    if t in ('—', '-', '–', ''):
        return None
    try:
        return float(t)
    except ValueError:
        return None


# ── cylinders ───────────────────────────────────────────────────────────────────────────────────

CYL_MODEL = re.compile(r'^(C\d+C(?:BT)?|RLS\d+S?|RSS\d+D?|RHA?\d+[DT]?|RT\d+|RA\d+L?|RD\d+|RDG\d+|RGG\d+|RGL\d+|'
                       r'R\d+[CDL]|RGP\d+|RP\d+)(\*{0,2})$')

# series -> (title, action default, return, body, flags)
CYL_SERIES = {
    'C':   ('General purpose, single-acting, spring return', 'SA', 'spring', 'steel', []),
    'CBT': ('Threaded rod and base, single-acting, spring return', 'SA', 'spring', 'steel', ['threaded']),
    'RP':  ('Pull cylinder, single-acting, spring return', 'SA', 'spring', 'steel', ['pull']),
    'RA':  ('Aluminium, single-acting, spring return', 'SA', 'spring', 'aluminum', []),
    'RA_L': ('Aluminium with locking collar, single-acting', 'SA', 'spring', 'aluminum', ['locking']),
    'RLS': ('Low height, single-acting, spring return', 'SA', 'spring', 'steel', ['low']),
    'RSS': ('Shorty, single-acting, spring return', 'SA', 'spring', 'steel', ['low']),
    'RH':  ('Hollow (center-hole), single-acting, spring return', 'SA', 'spring', 'steel', ['hollow']),
    'RHA': ('Aluminium hollow (center-hole)', 'SA', 'spring', 'aluminum', ['hollow']),
    'RT':  ('Center-hole pull/push', 'SA', 'spring', 'steel', ['hollow', 'pull']),
    'RGG': ('Heavy lift, single-acting, load return', 'SA', 'load', 'steel', []),
    'RDG': ('Heavy lift, double-acting, hydraulic return', 'DA', 'hydraulic', 'steel', []),
    'RD':  ('High cycle, double-acting, hydraulic return', 'DA', 'hydraulic', 'steel', []),
    'R_C': ('High tonnage, single-acting, gravity return', 'SA', 'load', 'steel', []),
    'R_D': ('High tonnage, double-acting, hydraulic return', 'DA', 'hydraulic', 'steel', []),
    'RGL': ('Locking collar, single-acting, load return', 'SA', 'load', 'steel', ['locking']),
    'R_L': ('Locking collar, single-acting, load return', 'SA', 'load', 'steel', ['locking']),
    'RGP': ('Pancake locking collar, single-acting, load return', 'SA', 'load', 'steel', ['locking', 'low']),
}


def cyl_series(model):
    m = model
    if re.fullmatch(r'C\d+CBT', m): return 'CBT'
    if re.fullmatch(r'C\d+C', m): return 'C'
    if m.startswith('RLS'): return 'RLS'
    if m.startswith('RSS'): return 'RSS'
    if m.startswith('RHA'): return 'RHA'
    if m.startswith('RH'): return 'RH'
    if m.startswith('RT'): return 'RT'
    if re.fullmatch(r'RA\d+L', m): return 'RA_L'
    if m.startswith('RA'): return 'RA'
    if m.startswith('RDG'): return 'RDG'
    if m.startswith('RD'): return 'RD'
    if m.startswith('RGG'): return 'RGG'
    if m.startswith('RGL'): return 'RGL'
    if m.startswith('RGP'): return 'RGP'
    if m.startswith('RP'): return 'RP'
    if re.fullmatch(r'R\d+C', m): return 'R_C'
    if re.fullmatch(r'R\d+D', m): return 'R_D'
    if re.fullmatch(r'R\d+L', m): return 'R_L'
    return None


# The master chart's known typos (PDF 11-12). Each was checked against the series' own spec table.
ERRATA = [
    {'pdf': 12, 'chart': 'RGG3002..RGG30012 listed twice', 'now': 'the copies citing p.38 are RGL models (RGL3002..)',
     'why': 'p.38 is the RGL locking-collar table; the same strokes appear there as RGL'},
    {'pdf': 12, 'chart': 'RD4006 listed twice (p.34 and p.38)', 'now': 'RD4006 is on p.34; the p.38 line is RGL4006',
     'why': 'p.38 is the RGL table'},
    {'pdf': 11, 'chart': 'C1016C missing', 'now': 'taken from the C-series table (PDF 14)', 'why': 'present on p.12'},
]

CHART_ROW = re.compile(r'^(?:(\d+(?:\.\d+)?)\s+Ton(?:\s+Pull)?\s+|Ton(?:\s+Pull)?\s+)?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(SA|DA)\s+([A-Z0-9]+)\s+(\d{1,3})$')


def parse_master_chart(texts):
    """{model: {stroke, closed, act, cap, pg}} from the 'choosing a cylinder by tonnage' chart.
    Group labels arrive as a bare number line followed by 'Ton' (or 'Ton Pull'), or inline."""
    out, dups = {}, []
    for text in texts:
        cap = None
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        for i, l in enumerate(lines):
            if re.fullmatch(r'\d+(?:\.\d+)?', l) and i + 1 < len(lines) and lines[i + 1].startswith('Ton'):
                cap = float(l)
                continue
            m = CHART_ROW.match(l)
            if not m:
                continue
            if m.group(1):
                cap = float(m.group(1))
            model = m.group(5)
            row = {'stroke': float(m.group(2)), 'closed': float(m.group(3)), 'act': m.group(4), 'cap': cap, 'pg': int(m.group(6))}
            if model in out:
                dups.append({'model': model, 'first': out[model], 'again': row})
                # the p.38 duplicates are RGL rows mislabelled (ERRATA)
                if row['pg'] == 38 and model.startswith('RGG'):
                    out['RGL' + model[3:]] = dict(row, act='SA')
                continue
            if row['pg'] == 38 and model == 'RD4006':
                continue
            out[model] = row
    return out, dups


def parse_cylinder_row(tokens, chart):
    """One spec-table row -> (dict, [issues]) or (None, []) when the tokens are not a cylinder row.

    Every table shares: [cap] [pullCap] stroke MODEL ...numbers... and ends with
    [area] [oil] psiAtCap [tons@10k] [pullTons] weight. Closed and extended heights sit side by side and
    differ by the stroke; oil = area x stroke. Those identities locate the columns, so one parser serves
    twenty layouts; where the catalog itself is inconsistent the chart wins and the row is reported."""
    k = next((i for i, t in enumerate(tokens) if CYL_MODEL.match(t)), None)
    if k is None or k == 0:
        return None, []
    model = CYL_MODEL.match(tokens[k]).group(1)
    stroke = num(tokens[k - 1])
    if stroke is None or not (0.2 <= stroke <= 40):
        return None, []
    issues = []
    ch = chart.get(model, {})
    inline = [num(t) for t in tokens[:k - 1]]
    inline = [v for v in inline if v is not None]
    rec = {'m': model, 'stroke': stroke}
    # capacity: the chart's class, else the first inline number (RLS/RSS/RH rows print it), else the group label
    if ch.get('cap'):
        rec['cap'] = ch['cap']
    elif inline:
        rec['cap'] = inline[0]
    if len(inline) >= 2:
        rec['pullCap'] = inline[1]
    vals = []
    for t in tokens[k + 1:]:
        v = num(t)
        if v is None and re.fullmatch(r'\d{1,2}\.\d{3}', t.rstrip('*')):
            v = num(t)
        if v is not None:
            vals.append(v)
    if len(vals) < 4:
        return None, []
    # a pressure printed with a full stop ('10.395' for 10,395 on PDF 26) — only when the row has no
    # proper pressure at all (RLS500S's 9.621 is a real area, its pressure 10,394 follows it)
    if not any(5000 <= v <= 12000 for v in vals):
        for i, v in enumerate(vals):
            if 8 <= v < 12 and re.search(r'\b%s\b' % re.escape('%.3f' % v), ' '.join(tokens[k + 1:])) and i >= len(vals) - 4:
                vals[i] = round(v * 1000)
                issues.append('pressure printed as %.3f, read as %d psi' % (v, vals[i]))
    psi = [i for i, v in enumerate(vals) if 5000 <= v <= 12000]
    pi = psi[-1] if psi else None
    double = pi is not None and pi - 1 in psi           # RD/RH-D rows: push psi, pull psi
    if pi is not None:
        rec['psiCap'] = vals[pi - 1] if double else vals[pi]
        after = vals[pi + 1:]
        if len(after) >= 2:
            rec['t10k'] = after[0]
            if len(after) >= 3:
                rec['pullT10k'] = after[1]
        rec['wt'] = vals[-1]
    # closed / extended: neighbours that differ by the stroke, nearest to the chart's closed height
    want = ch.get('closed')
    best = None
    stop = (pi - 1 if double else pi) if pi is not None else len(vals)
    for i in range(stop - 1):
        x, y = vals[i], vals[i + 1]
        if abs((y - x) - stroke) <= 0.35 and x >= 1.0:
            score = abs(x - want) if want is not None else 0
            if best is None or score < best[0]:
                best = (score, x, y)
    if best and (want is None or best[0] <= 1.0):          # the chart rounds some heights to whole inches
        rec['closed'], rec['ext'] = best[1], best[2]
    elif want is not None:
        rec['closed'], rec['ext'] = want, round(want + stroke, 2)
        issues.append('closed/extended height unreadable in the row; closed %.2f from the chart, extended = closed + stroke' % want)
    # area & oil — area sits in the last few columns before the pressure; oil is either the first value
    # after the model (C/RA/RH/RLS/RSS/R/RD) or just after the area (RGG/RDG/RGL/RGP). oil = area x stroke
    # picks the pair; a 6% fit is preferred, a 12% fit is accepted and reported (C108C prints 19.90).
    if pi is not None:
        p0 = pi - 1 if double else pi
        areas = [j for j in range(p0 - 1, max(-1, p0 - 5), -1)]
        oils = [0] + [j for j in range(p0 - 1, max(-1, p0 - 4), -1)]
        found = None
        for tol in (0.06, 0.12):
            for ai in areas:
                area = vals[ai]
                if not (0.3 <= area <= 150):
                    continue
                for oi in oils:
                    if oi == ai:
                        continue
                    oil = vals[oi]
                    if oil > 0 and abs(oil - area * stroke) <= tol * area * stroke + 0.1:
                        found = (area, oil, tol)
                        break
                if found:
                    break
            if found:
                break
        if found:
            rec['area'], rec['oil'] = found[0], found[1]
            if found[2] > 0.06:
                issues.append('oil %.2f differs from area x stroke %.2f' % (found[1], found[0] * stroke))
    return rec, issues


def merge_tokens(line):
    """Join tokens that belong together so a row splits into stable columns (threads, fractions, gallons)."""
    s = re.sub(r'(\*+)(\d)', r'\1 \2', line)          # 'RH10010*216.60' -> 'RH10010* 216.60'
    s = re.sub(r'(\d+)\s+(\d+/\d+)\s*[-–]\s*(\d+(?:\s+\d+/\d+)?)', lambda m: m.group(0).replace(' ', '_'), s)   # 2 1/4-14
    s = re.sub(r'(\d+(?:/\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?(?:\s+\d+/\d+)?)', lambda m: m.group(0).replace(' ', '_'), s)   # 1-8 x 0.75
    s = re.sub(r'(\d+/\d+)\s+NPTF?', lambda m: m.group(0).replace(' ', '_'), s)
    return s.split()


def parse_cylinders(pages, chart):
    """pages: [(pdf, text)] for the cylinder section. Returns ({model: rec}, warnings)."""
    out, warns = {}, []
    for pdf, text in pages:
        cap = None
        for raw in text.splitlines():
            l = raw.strip()
            if re.fullmatch(r'\d+(?:\.\d+)?', l):
                cap = float(l)
                continue
            toks = merge_tokens(l)
            rec, issues = parse_cylinder_row(toks, chart)
            if not rec:
                continue
            if not rec.get('cap'):
                rec['cap'] = cap
            for msg in issues:
                warns.append({'pdf': pdf, 'model': rec['m'], 'issue': msg})
            rec['pdf'] = pdf
            rec['raw'] = l[:170]
            if rec['m'] in out:
                continue                       # first defining table wins (later pages are mentions)
            out[rec['m']] = rec
            ch = chart.get(rec['m'])
            if ch and rec.get('closed') is not None and abs(ch['closed'] - rec['closed']) > 0.06:
                warns.append({'pdf': pdf, 'model': rec['m'], 'issue': 'closed height %.2f in the table vs %.2f in the chart'
                              % (rec['closed'], ch['closed'])})
            for k in ('closed', 'oil', 'psiCap'):
                if rec.get(k) is None:
                    warns.append({'pdf': pdf, 'model': rec['m'], 'issue': 'no %s found in the row' % k, 'raw': l[:120]})
    return out, warns


# ── pumps ───────────────────────────────────────────────────────────────────────────────────────

def _vol(tok_list, i):
    """A reservoir that may be printed as '1.5 gal.' (two tokens) -> (in3, tokens consumed)."""
    t = tok_list[i]
    if i + 1 < len(tok_list) and tok_list[i + 1].lower().startswith('gal'):
        v = num(t)
        return (round(v * GAL_IN3, 1) if v is not None else None), 2
    return num(t), 1


HAND_ROW = re.compile(r'^([12])\s+(P\d+[A-Z]?(?:-\d+G?)?)\*?\s+(.*)$')


def parse_hand_pumps(pages):
    """PDF 51-53: speed MODEL lpVol hpVol lpPsi hpPsi effort reservoir usable port weight.
    'Single-Acting' / 'Double-Acting' labels above the rows set what the pump drives."""
    out, warns = {}, []
    for pdf, text in pages:
        act = 'SA'
        for raw in text.splitlines():
            l = raw.strip()
            if re.match(r'^Double-\s*Acting', l):
                act = 'DA'
            elif re.match(r'^Single-\s*$|^Single-\s*Acting', l):
                act = 'SA'
            m = HAND_ROW.match(l)
            if not m:
                continue
            toks = m.group(3).split()
            vals, i = [], 0
            while i < len(toks) and len(vals) < 7:
                v, used = _vol(toks, i)
                if v is None and toks[i] not in ('—', '-', '–'):
                    break
                vals.append(v)
                i += used
            if len(vals) < 7:
                warns.append({'pdf': pdf, 'model': m.group(2), 'issue': 'hand-pump row has %d of 7 values' % len(vals), 'raw': l[:120]})
                continue
            lp, hp, lpPsi, hpPsi, effort, res, usable = vals
            wt = num(toks[-1])
            model = m.group(2)
            rec = {'m': model, 'cat': 'pump', 'ser': 'P', 'pow': 'manual', 'speed': int(m.group(1)),
                   'act': 'DA' if (act == 'DA' or re.fullmatch(r'P\d+D', model)) else 'SA',
                   'lpVol': lp, 'hpVol': hp, 'lpPsi': lpPsi, 'maxPsi': hpPsi, 'effort': effort, 'res': res,
                   'usable': usable, 'wt': wt, 'pdf': pdf, 'raw': l[:170]}
            if hpPsi and hpPsi > 10500:
                rec['note'] = 'high-pressure pump (%d psi): not for 10,000 psi tools' % hpPsi
            out[model] = rec
    return out, warns


PUMP_POWER = [('PED', 'electric'), ('PA', 'air'), ('PE', 'electric'), ('PQ', 'electric'), ('PG', 'gas'),
              ('PB', 'battery'), ('PR', 'battery'), ('RWP', 'air')]
PUMP_MODEL = re.compile(r'^(?:PA|PE|PQ|PG|PB|PED|PR|RWP)\d[0-9A-Z]*(?:-[0-9A-Z]+)*\*{0,3}†*$')


def parse_powered_pumps(pages):
    """Air, battery, electric and gasoline pumps. The ordering rows are descriptions spread over several
    lines, so each model gets what its own row states reliably — single/double-acting (a 4-way valve
    drives double-acting cylinders), valve, usable oil when printed — with the power source from the
    series prefix and the flow and speed from the page title. Every record is marked partial."""
    out, best = {}, {}
    for pdf, text in pages:
        up = text.upper()
        speed = 2 if ('TWO-SPEED' in up or 'TWO SPEED' in up) else (1 if 'SINGLE-SPEED' in up else None)
        title_sa = re.search(r'SINGLE-ACTING|SINGLE AND DOUBLE', up) is not None
        title_da = re.search(r'DOUBLE-ACTING', up) is not None
        flow = re.search(r'(\d+(?:\.\d+)?)\s*CU\.\s*IN\.?\s*/\s*MIN', up)
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        occ = []
        for idx, l in enumerate(lines):
            for t in l.split():
                if PUMP_MODEL.match(t):
                    occ.append((idx, t.rstrip('*†')))
        rows = {}
        for n, (idx, model) in enumerate(occ):
            start = idx
            while start > 0 and idx - start < 3 and not any(PUMP_MODEL.match(t) for t in lines[start - 1].split()) \
                    and not re.search(r'\(in\.\)|\(psi\)|\(cu\.|Order|Description', lines[start - 1]):
                start -= 1
            nxt = occ[n + 1][0] if n + 1 < len(occ) else min(len(lines), idx + 5)
            row = ' '.join(lines[start:max(nxt, idx + 1)])[:400]
            score = 2 * bool(re.search(r'Acting', row)) + bool(re.search(r'-Way|Auto', row)) + bool(re.search(r'Phase|NPTF|gal', row))
            if model not in rows or score > rows[model][0]:
                rows[model] = (score, row)
        for model, (score, row) in rows.items():
            if model.endswith('Series'):
                continue
            act = 'DA' if re.search(r'Double-Acting|\bDA\b|4-Way', row) else ('SA' if re.search(r'Single-Acting|\bSA\b|[23]-Way|Auto[- ]?Dump', row) else None)
            if act is None and title_sa != title_da:
                act = 'SA' if title_sa else 'DA'          # the page drives one kind only
            usable = None
            mu = re.search(r'Phase\s+([\d,]+)', row)
            if mu:
                usable = num(mu.group(1))
            else:
                mu = re.search(r'\b' + re.escape(model) + r'\b\s+[\d\-]+\s+(?:[\d.]+\s+gal\.|[\d,]+)\s+([\d,]+)\s+3/8', row)
                if mu:
                    usable = num(mu.group(1))
            valve = re.search(r'(\d)-Way|Auto[- ]?Dump', row)
            pow_ = next((pw for pre, pw in PUMP_POWER if model.startswith(pre)), None)
            rec = {'m': model, 'cat': 'pump', 'ser': re.match(r'[A-Z]+\d+', model).group(0), 'pow': pow_, 'speed': speed,
                   'act': act, 'pdf': pdf, 'partial': True, 'raw': row[:220]}
            if flow:
                rec['flow'] = float(flow.group(1))
            if usable and 20 <= usable <= 5000:
                rec['usable'] = usable
            if valve:
                rec['valve'] = valve.group(0)
            if pdf in (208, 209) or 'TWP' in model or model.startswith('RWP'):
                rec['use'] = 'torque-wrench'
                rec['note'] = 'torque-wrench pump: not for lifting'
            if model not in best or score > best[model]:
                best[model] = score
                out[model] = rec
    return out


# ── jacks ───────────────────────────────────────────────────────────────────────────────────────

def parse_jacks(pages):
    out, warns = {}, []
    for pdf, text in pages:
        up = text.upper()
        sub = ('sidewinder' if 'SIDEWINDER' in up else 'low-profile' if 'LOW PROFILE' in up else
               'telescoping' if 'TELESCOPING' in up else 'toe' if 'TOE JACK' in up else
               'bottle' if 'BOTTLE JACK' in up else None)
        for raw in text.splitlines():
            l = raw.strip()
            m = re.match(r'^(9\d{3}[A-Z])\s+(\d+(?:\.\d+)?)\s+([\d.]+)\s+([\d.]+)\s+(—|[\d.]+)\s+([\d.]+)', l)
            if m and sub in ('bottle', 'low-profile', 'telescoping'):
                out[m.group(1)] = {'m': m.group(1), 'cat': 'jack', 'sub': sub, 'cap': num(m.group(2)), 'stroke': num(m.group(3)),
                                   'closed': num(m.group(4)), 'screw': num(m.group(5)), 'maxH': num(m.group(6)),
                                   'wt': num(l.split()[-1]), 'pdf': pdf, 'raw': l[:170]}
                continue
            m = re.match(r'^(9\d{3}A)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+\d+', l)
            if m and sub == 'sidewinder':
                out[m.group(1)] = {'m': m.group(1), 'cat': 'jack', 'sub': 'sidewinder', 'cap': num(m.group(2)), 'stroke': num(m.group(3)),
                                   'closed': num(m.group(4)), 'maxH': num(m.group(5)), 'wt': num(l.split()[-1]), 'pdf': pdf, 'raw': l[:170]}
                continue
            m = re.match(r'^(J\d+T)\s+(\d+(?:\.\d+)?)\s+([\d.]+)\s+\d+\s+[\d.]+\s+(?:Yes|No)\s+([\d.]+)$', l)
            if m:
                out[m.group(1)] = {'m': m.group(1), 'cat': 'jack', 'sub': 'toe', 'cap': num(m.group(2)), 'stroke': num(m.group(3)),
                                   'wt': num(m.group(4)), 'pdf': pdf, 'raw': l[:170]}
                continue
            m = re.match(r'^(J[EA][MR]\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(Electric|Air)', l)
            if m:
                out[m.group(1)] = {'m': m.group(1), 'cat': 'jack', 'sub': 'high-tonnage', 'cap': num(m.group(2)), 'closed': num(m.group(3)),
                                   'maxH': num(m.group(4)), 'stroke': num(m.group(5)), 'pow': m.group(6).lower(), 'pdf': pdf, 'raw': l[:170]}
                continue
            m = re.match(r'^(RJ100T\d+[EA](?:-[CE])?)\*{0,2}†?\s+Jack, 100 Ton RR .*?\s(\d+)\s+(\d+)$', l)
            if m:
                out[m.group(1)] = {'m': m.group(1), 'cat': 'jack', 'sub': 'railroad', 'cap': 100.0, 'stroke': num(m.group(2)),
                                   'closed': num(m.group(3)), 'act': 'DA', 'pow': 'electric' if 'E' in m.group(1)[8:] else 'air',
                                   'pdf': pdf, 'raw': l[:170]}
    return out, warns


# ── hoses, couplers, gauges, fittings ───────────────────────────────────────────────────────────

HOSE_ROW = re.compile(r'^(Rubber, Wire-Braid|Polyurethane)(\*?)\s+(1/4|3/8)"\s+(\d+)\s+([\d,]+)\s+(\d{4})(\*{0,2})$')


def parse_hoses(pages):
    out = {}
    for pdf, text in pages:
        for raw in text.splitlines():
            l = raw.strip()
            m = HOSE_ROW.match(l)
            if m:
                model = m.group(6)
                out[model] = {'m': model, 'cat': 'hose', 'type': 'rubber' if m.group(1).startswith('Rubber') else 'polyurethane',
                              'id': m.group(3) + '"', 'len': num(m.group(4)), 'burst': num(m.group(5)),
                              'highFlow': bool(m.group(2)), 'withCoupler': m.group(7) == '**', 'pdf': pdf, 'raw': l[:170]}
                continue
            m = re.match(r'^(\d{4,7})\s+3/8" Fitting NPTF\s+(1/4)"\s+(\d+)\s+([\d,]+)$', l)
            if m:
                out[m.group(1)] = {'m': m.group(1), 'cat': 'hose', 'type': 'non-conductive', 'id': '1/4"', 'len': num(m.group(3)),
                                   'burst': num(m.group(4)), 'pdf': pdf, 'raw': l[:170]}
                continue
            m = re.match(r'^(TWH\d+)\s+(\d+)\s+(1/4)"$', l)
            if m:
                out[m.group(1)] = {'m': m.group(1), 'cat': 'hose', 'type': 'twin torque-wrench', 'id': '1/4"', 'len': num(m.group(2)),
                                   'use': 'torque-wrench', 'pdf': pdf, 'raw': l[:170]}
    return out


GAUGE_ROW = re.compile(r'^(9\d{3}[A-Z]{0,2})\s+([\d.]+)\s+0-10,000\s+(.*)$')


def parse_gauges(pages):
    out = {}
    for pdf, text in pages:
        lines = [l.strip() for l in text.splitlines()]
        for i, l in enumerate(lines):
            m = GAUGE_ROW.match(l)
            if not m:
                continue
            rest = m.group(3)
            ton = re.match(r'(0-[\d.]+(?:,\s*0-[\d.]+)*)\s', rest)
            series = re.search(r'(?:Yes|No)\*?\s+(.*)$', rest)
            out[m.group(1)] = {'m': m.group(1), 'cat': 'gauge', 'face': num(m.group(2)), 'range': '0-10,000 psi',
                               'tonScale': num(ton.group(1).split('-')[1].split(',')[0]) if ton else None,
                               'series': series.group(1).strip() if series else '', 'pdf': pdf, 'raw': l[:170]}
    return out


DESC_CODE = re.compile(r'^(\d{4,7}[A-Z]{0,3}(?:-[A-Z0-9]+)?|[A-Z]{1,6}\d[\dA-Z]*(?:-[\dA-Z]+)*)\*{0,2}$')


def parse_description_tables(pages, cat_of_page):
    """'Order No. | Description' tables (couplers, fittings, manifolds, valves, adapters, accessories).
    A line that starts with an order number — or is one on its own, followed by a capitalised line —
    opens an entry; lines after it without an order number continue it. Pages are read in the order
    given, and the first page to describe a code keeps it (callers pass the dedicated pages first)."""
    out = {}
    for pdf, text in pages:
        if 'Description' not in text:
            continue
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        cur = None
        for i, l in enumerate(lines):
            first = l.split()[0]
            code = first.rstrip('*')
            rest = l[len(first):].strip()
            opens = False
            if DESC_CODE.match(first) and not NOT_CODES.match(code):
                if rest and (re.match(r'^[A-Z][a-z]|^“|^"|^\d+/\d+"|^No-spill|^Quick|^Tee|^Manifold', rest)
                             or re.match(r'^\d+(?:-jaw|/\d+-jaw| ton)\b', rest)):
                    opens = True
                elif not rest and i + 1 < len(lines) and re.match(r'^[A-Z][a-z]|^“|^"|^No-spill|^\d+-Port', lines[i + 1]):
                    opens = True
            if opens:
                cur = {'m': code, 'cat': cat_of_page(pdf), 'desc': rest, 'pdf': pdf}
                if code not in out:
                    out[code] = cur
                else:
                    cur = None                       # already described on an earlier (dedicated) page
                continue
            if cur is not None and len(cur['desc']) < 240 and not re.match(r'^(Order|No\.|Description|ACC\.|powerteam|Accessories)', l):
                cur['desc'] = (cur['desc'] + ' ' + l).strip()
    for r in out.values():
        r['desc'] = re.sub(r'\s+', ' ', r['desc'])[:240]
    return out


# ── sets, presses, torque wrenches, pullers, tools ──────────────────────────────────────────────

def parse_rps_sets(pages):
    out = {}
    for pdf, text in pages:
        for raw in text.splitlines():
            l = raw.strip()
            m = re.match(r'^(\d+)\s+([\d.]+)\s+(RPS\d+[A-Z]?)\*{0,2}\s+([\d.]+)\s+(\d+)\*?\s+(\S+)\s+(P\d+[A-Z]?)\s+(\d{4})\s+(\d{4})\s+(Single|Two)\s+([\d.]+)$', l)
            if m:
                out[m.group(3)] = {'m': m.group(3), 'cat': 'set', 'sub': 'cylinder-pump', 'cap': num(m.group(1)), 'stroke': num(m.group(2)),
                                   'closed': num(m.group(4)), 'parts': [m.group(6), m.group(7), m.group(8), m.group(9)],
                                   'speed': 1 if m.group(10) == 'Single' else 2, 'wt': num(m.group(11)), 'pdf': pdf, 'raw': l[:170]}
    return out


def parse_presses(pages):
    out = {}
    for pdf, text in pages:
        for raw in text.splitlines():
            l = raw.strip()
            m = re.match(r'^((?:SP[AEHMX]|RB)\d+[A-Z]*)\s*\*?\s+(?:\d{6}\s+)?(?:Bench|Floor)?\s*(\d+)\s+(Single|Double)-Acting\s+([\d. /]+?)\s+([A-Z]+\d+[A-Z]*)\s+(.*)$', l)
            if m:
                pump = re.search(r'\b(P\d+[A-Z]?|PA\d+[A-Z]*|PE\d+[A-Z]*|PQ\d+[A-Z]*)\b', m.group(6))
                stroke = m.group(4).strip()
                st = num(stroke) if ' ' not in stroke else (lambda a, b: num(a) + eval(b))(*stroke.split(' ', 1)) if re.fullmatch(r'\d+ \d+/\d+', stroke) else num(stroke.split()[0])
                out[m.group(1)] = {'m': m.group(1), 'cat': 'press', 'cap': num(m.group(2)), 'act': 'SA' if m.group(3) == 'Single' else 'DA',
                                   'stroke': st, 'parts': [m.group(5)] + ([pump.group(1)] if pump else []), 'pdf': pdf, 'raw': l[:170]}
    return out


def parse_torque_wrenches(pages):
    out = {}
    for pdf, text in pages:
        for raw in text.splitlines():
            l = raw.strip()
            m = re.match(r'^(TWHC\d+)\s+([\d,]+)\s+([\d,]+)\s+(\d(?:\s+\d/\d)?|\d/\d)\s', l)
            if m:
                out[m.group(1)] = {'m': m.group(1), 'cat': 'torque-wrench', 'sub': 'square-drive', 'minTq': num(m.group(2)),
                                   'maxTq': num(m.group(3)), 'drive': m.group(4).replace(' ', ' ') + '"', 'pdf': pdf, 'raw': l[:170]}
                continue
            m = re.match(r'^(TWLC\d+)\s+([\d.]+)\s*-\s*([\d.]+)\s+([\d,]+)\s+([\d,]+)\s+([\d.]+)$', l)
            if m:
                out.setdefault(m.group(1), {'m': m.group(1), 'cat': 'torque-wrench', 'sub': 'low-clearance', 'hexMin': num(m.group(2)),
                                            'hexMax': num(m.group(3)), 'minTq': num(m.group(4)), 'maxTq': num(m.group(5)),
                                            'wt': num(m.group(6)), 'pdf': pdf, 'raw': l[:170]})
                continue
            m = re.match(r'^(TWSL\d+)-#\s+([\d.]+)\s+([\d.]+)\s+([\d,]+)\s+([\d,]+)\s*-\s*([\d,]+)', l)
            if m:
                out[m.group(1)] = {'m': m.group(1), 'cat': 'torque-wrench', 'sub': 'slimline', 'hexMin': num(m.group(2)),
                                   'hexMax': num(m.group(3)), 'minTq': num(m.group(4)), 'maxTq': num(m.group(6)), 'pdf': pdf, 'raw': l[:170]}
    return out


def parse_puller_kits(pages):
    out = {}
    for pdf, text in pages:
        for raw in text.splitlines():
            l = raw.strip()
            m = re.match(r'^(PTPHC-\d+|---)\s+(PTPHC-\d+)\s+(\d+)\s+(C\d+C)\s+(P\d+[A-Z]?)\s+([\d.]+)', l)
            if m:
                for model, jaws in ((m.group(1), 2), (m.group(2), 3)):
                    if model.startswith('PTPHC'):
                        out[model] = {'m': model, 'cat': 'set', 'sub': 'puller-kit', 'jaws': jaws, 'cap': num(m.group(3)),
                                      'parts': [m.group(4), m.group(5)], 'reach': num(m.group(6)), 'pdf': pdf, 'raw': l[:170]}
    return out


def parse_kit_tables(pages):
    """IM10 maintenance sets (PDF 174) and SK start-up kits (PDF 178, 181): contents grids.
    'Order No. IM10B IM10E' names the columns; a contents line ends with one code per column."""
    out = {}
    for pdf, text in pages:
        cols = []
        for raw in text.splitlines():
            l = raw.strip()
            m = re.match(r'^Order No\.?\s+((?:IM10[A-Z]\s*)+)$', l)
            if m:
                cols = m.group(1).split()
                for c in cols:
                    out.setdefault(c, {'m': c, 'cat': 'set', 'sub': 'maintenance-kit', 'parts': [], 'pdf': pdf})
                continue
            if cols and len(cols) == 2:
                toks = l.split()
                if len(toks) >= 3 and all(DESC_CODE.match(t) for t in toks[-2:]) and not l.startswith('Order'):
                    for c, code in zip(cols, toks[-2:]):
                        out[c]['parts'].append(code)
                    continue
            m = re.match(r'^(SK\d+T)\s+(SK\d+TE)\b', l)
            if m:
                cols = [m.group(1), m.group(2)]
                for c in cols:
                    out.setdefault(c, {'m': c, 'cat': 'set', 'sub': 'start-up-kit', 'parts': [], 'pdf': pdf})
                continue
            m = re.match(r'^(X)\s+(X\s+)?([A-Z0-9][A-Z0-9-]{2,})\b', l)
            if m and len(cols) == 2 and cols[0].startswith('SK'):
                both = bool(m.group(2))
                for c in (cols if both else cols[:1]):
                    out[c]['parts'].append(m.group(3))
    return {k: v for k, v in out.items() if v['parts']}


# ── headings, index, assembly ───────────────────────────────────────────────────────────────────

SECTIONS = [(7, 44, 'cylinders'), (45, 112, 'pumps'), (113, 146, 'accessories'), (147, 164, 'shop'),
            (165, 186, 'jacks'), (187, 224, 'tools'), (225, 266, 'pullers'), (267, 284, 'resources')]


def section_of(pdf):
    return next((n for a, b, n in SECTIONS if a <= pdf <= b), 'front')


def cat_of_page(pdf):
    if 113 <= pdf <= 136: return 'valve'
    if 137 <= pdf <= 139: return 'hose'
    if pdf == 140: return 'coupler'
    if pdf in (141, 143, 144): return 'gauge'
    if pdf in (142, 146): return 'manifold'
    if pdf == 145: return 'fitting'
    return {'cylinders': 'cylinder-accessory', 'pumps': 'pump-accessory', 'shop': 'shop', 'jacks': 'jack-accessory',
            'tools': 'tool', 'pullers': 'puller', 'resources': 'resource'}.get(section_of(pdf), 'other')


def page_heading(text):
    """'C SERIES · SINGLE-ACTING, SPRING RETURN · TONNAGE RANGE: 5 - 100' — what the page is about."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    ser = ''
    for i, l in enumerate(lines):
        if l == 'SERIES' and i > 0 and len(lines[i - 1]) <= 12:
            ser = lines[i - 1]
            break
        m = re.match(r'^([A-Z_]{1,8}(?:/[A-Z]{1,8})?)\s*SERIES$', l)
        if m:
            ser = m.group(1)
            break
    title = next((l for l in lines if l.isupper() and len(l) >= 12 and re.search(
        r'CYLINDER|PUMP|JACK|HOSE|COUPLER|GAUGE|VALVE|PRESS|WRENCH|PULLER|SPREADER|SPLITTER|CLAMP|PUNCH|TESTER|MANIFOLD|FITTING|KIT|SET|CRANE|VISE|TOOL', l)
                  and not l.startswith('MODEL')), '')
    rng = re.search(r'TONNAGE RANGE:\s*([\d.,&\s-]+)', text)
    parts = [p for p in (ser and ser + ' SERIES', title.rstrip(' ,'), rng and 'TONNAGE RANGE: ' + rng.group(1).strip()) if p]
    return ' · '.join(dict.fromkeys(parts))[:140]


INDEX_CODE = re.compile(r'^([A-Z]{1,6}\d[\dA-Z]*(?:-[\dA-Z]+)*)\*{0,3}[†‡]*$')
NOT_CODES = re.compile(r'^(M\d+X?[\d.]*|IP\d+|LR\d+|B\d0|H2O|AA|\d{1,3}[XA]?|NPTF?|UNF?|UNC|SAE\d+|CE|UL\d*|ASME|B30|ISO\d*|NEMA\d*|[A-Z]\d|PT\d{4}A?|A\d{3}|RV\d+|M\d+)$')


def build_index(pages, known):
    """Every order number in the book: [model, pdf, pg, headIdx, section, text]. Alphanumeric codes are
    taken anywhere; purely numeric ones only when a table parser or a description table already knew them."""
    heads, rows, seen = [], [], set()
    for pdf, text, pg in pages:
        head = page_heading(text)
        if head not in heads:
            heads.append(head)
        hi = heads.index(head)
        for raw in text.splitlines():
            l = raw.strip()
            for tok in l.replace(',', ' ').split():
                m = INDEX_CODE.match(tok)
                code = m.group(1) if m else (tok.rstrip('*') if tok.rstrip('*') in known else None)
                if not code or (m and NOT_CODES.match(code)) or len(code) < 3:
                    continue
                key = (code, pdf)
                if key in seen:
                    continue
                seen.add(key)
                rows.append([code, pdf, pg, hi, section_of(pdf), re.sub(r'\s+', ' ', l)[:160]])
    return heads, rows


def family_id(rec, fam_ids):
    """The products.json family a model belongs to (keeps the finder's 'Don't forget' pairs working).
    Only ids that exist are returned — the convention in that file is loose, so nothing is invented."""
    m, cat = rec['m'], rec['cat']
    cands = []
    if cat == 'cylinder' and rec.get('cap'):
        ser = rec['ser'].lower().replace('_', '-')
        cap = rec['cap']
        capk = str(int(cap)) if float(cap).is_integer() else str(cap)
        cands += ['pt-%s-%s' % (ser, capk), 'pt-%s-%s' % (ser.replace('-', ''), capk)]
    elif cat == 'pump':
        base = re.match(r'[A-Z]+\d+', m).group(0)
        cands += ['pt-' + m.lower(), 'pt-' + base.lower(), 'pt-' + base[:4].lower()]
    elif cat == 'jack':
        cands += ['pt-jack-' + m.lower()]
    return next((c for c in cands if c in fam_ids), None)


def build(pages, fam_ids=()):
    """pages: [(pdf, text)] for the whole book -> (catalog, index, report)."""
    by = {pdf: t for pdf, t in pages}
    pg = {pdf: detect_printed_page(t) for pdf, t in pages}
    rng = lambda a, b: [(p, by[p]) for p in range(a, b + 1) if p in by]

    chart, dups = parse_master_chart([by[11], by[12]])
    cyl, w_cyl = parse_cylinders(rng(13, 44), chart)
    hand, w_hand = parse_hand_pumps(rng(51, 53))
    powered = parse_powered_pumps(rng(55, 106) + rng(208, 209))
    jacks, w_jack = parse_jacks(rng(169, 182))
    hoses = parse_hoses(rng(137, 139))
    gauges = parse_gauges(rng(141, 141))
    rps = parse_rps_sets(rng(54, 54))
    presses = parse_presses(rng(151, 160))
    twr = parse_torque_wrenches(rng(188, 204))
    pkits = parse_puller_kits(rng(236, 236))
    kits = parse_kit_tables(rng(174, 174) + rng(178, 178) + rng(181, 181))
    dedicated = rng(140, 140) + rng(145, 146) + rng(142, 142) + rng(113, 136) + rng(175, 175)
    toc = {lo + 1 for lo, _, _ in SECTIONS}      # each section's contents page lists 'Name  page' lines, not products
    desc = parse_description_tables(dedicated + [pp for pp in rng(113, 284) if pp not in dedicated and pp[0] not in toc], cat_of_page)

    models = {}

    def put(rec):
        m = rec['m']
        if m in models:
            return
        models[m] = rec

    for m, r in cyl.items():
        ser = cyl_series(m)
        title, act, ret, body, flags = CYL_SERIES[ser]
        ch = chart.get(m, {})
        rec = {'m': m, 'cat': 'cylinder', 'ser': ser, 'act': ch.get('act') or act, 'ret': ret if (ch.get('act') or act) == act else 'hydraulic',
               'body': body}
        if flags:
            rec['flags'] = flags
        rec.update({k: v for k, v in r.items() if k not in ('m',) and v is not None})
        put(rec)
    for group in (hand, powered, jacks, hoses, gauges, rps, presses, twr, pkits, kits):
        for r in group.values():
            put(r)
    for m, r in desc.items():
        if m not in models and (re.fullmatch(r'\d{4,7}[A-Z]{0,3}(?:-[A-Z0-9]+)?', m) or not NOT_CODES.match(m)):
            put(r)

    known = set(models)
    # a kit's parts: model numbers its own description names that exist in the catalog
    for r in models.values():
        if r.get('cat') in ('puller', 'jack-accessory', 'tool', 'shop') and r.get('desc') and 'parts' not in r:
            parts = [c for c in re.findall(r'\b([A-Z]{1,6}\d[\dA-Z]*(?:-[\dA-Z]+)*|\d{4,6})\b', r['desc']) if c in known and c != r['m']]
            if parts:
                r['parts'] = list(dict.fromkeys(parts))
    for r in models.values():
        r['pg'] = pg.get(r['pdf'])
        if r['cat'] == 'manifold' and 'gauge adapter' in (r.get('desc') or '').lower():
            r['cat'] = 'fitting'
        fam = family_id(r, set(fam_ids))
        if fam:
            r['fam'] = fam
        r.pop('raw', None)            # the row text lives in pt_index.json; keeping it here doubled the file

    heads, index = build_index([(p, by[p], pg.get(p)) for p, _ in pages if p >= 5 and p not in (5, 6)], known)
    warnings = w_cyl + w_hand + w_jack
    report = {
        'counts': {}, 'chartDuplicates': dups, 'warnings': warnings,
        'unparsedChartModels': sorted(set(chart) - set(cyl)),
    }
    for r in models.values():
        report['counts'][r['cat']] = report['counts'].get(r['cat'], 0) + 1
    catalog = {
        '_units': {'len': 'in', 'oil': 'in3', 'tons': 'US short ton (x 0.907 = metric tonne, PDF 181)', 'press': 'psi', 'wt': 'lb', 'torque': 'lb-ft'},
        '_errata': ERRATA, '_warnings': warnings,
        'series': {k: {'title': v[0], 'act': v[1], 'ret': v[2], 'body': v[3], 'flags': v[4]} for k, v in CYL_SERIES.items()},
        'models': [models[k] for k in sorted(models)],
    }
    return catalog, {'heads': heads, 'rows': index}, report


# ── the official Enerpac -> Power Team crossover ──────────────────────────────────────────────────
# "2025 Power Team Crossover Reference" (Hydraulic Technologies, HT_PT_Crossover_Reference_0425.pdf,
# 32 pages). Rows read: ENERPAC_NO  PT_PARTS  DESCRIPTION  [E|S]; long rows wrap over several lines and
# kit rows are written as "RPS2514, LESS C2514C, PLUS 9063, 9670".

XREF_URL = 'https://hydraulictechnologies.com/hubfs/DocumentsFinder/HT_PT_Crossover_Reference_0425.pdf'
XREF_KEYWORDS = {'LESS', 'PLUS', 'PLUSS', 'PLUT', 'EACH'}
XREF_PART = re.compile(r'^(?:\d+/)?[A-Z0-9][A-Z0-9.\-]*\d[A-Z0-9.\-]*$|^(?:\d+/)?\d+[A-Z]*$')
XREF_ENERPAC = re.compile(r'^[A-Z]{1,5}[A-Z0-9.\-]*\d[A-Z0-9.\-]*$')
XREF_SKIP = re.compile(r'^(?:\d+|Enerpac|Part Number|Power Team|Part Number Power Team Description Match|E = .*|.*CROSSOVER REFERENCE.*)$')


def _xref_split(body):
    """'RPS2514, LESS C2514C, PLUS 9063, 9670 SET, CYLINDER & PUMP S' -> (parts tokens, desc, match)."""
    toks = body.replace(',', ', ').split()
    parts, i = [], 0
    while i < len(toks):
        t = toks[i].rstrip(',')
        if t.upper() in XREF_KEYWORDS or ('"' not in t and XREF_PART.match(t)):
            parts.append(t.upper())
            i += 1
            continue
        break
    desc = ' '.join(toks[i:]).replace(' ,', ',')
    match = ''
    m = re.search(r'\s([ES])$', ' ' + desc)
    if m:
        match, desc = m.group(1), desc[:-1].rstrip()
    while parts and parts[-1] in XREF_KEYWORDS:
        parts.pop()
    return parts, desc.strip(' -'), match


def _xref_parts(tokens):
    """Tokens -> {'items': [[model, qty]], 'less': [...], 'plus': [[model, qty]]}."""
    out, mode, qty = {'items': [], 'less': [], 'plus': []}, 'items', 1
    for t in tokens:
        if t in ('LESS',):
            mode = 'less'; continue
        if t in ('PLUS', 'PLUSS', 'PLUT'):
            mode = 'plus'; continue
        if t == 'EACH':
            continue
        if re.fullmatch(r'\d', t):                # '8023, 8028, 8029 2 EACH' -> two of each
            for it in out[mode]:
                if isinstance(it, list):
                    it[1] = int(t)
            continue
        m = re.fullmatch(r'(\d+)/(.+)', t)
        q, model = (int(m.group(1)), m.group(2)) if m else (1, t)
        out[mode].append(model if mode == 'less' else [model, q])
    return out


def parse_crossover(pages):
    """pages: [(pdf, text)] -> (rows, warnings). Each row:
    [enerpac, items[[pt, qty]], less[pt], plus[[pt, qty]], description, match 'E'|'S'|'', pdf page]."""
    rows, warns, cur = [], [], None

    def close():
        if not cur:
            return
        parts, desc, match = _xref_split(cur['body'])
        if not parts or not desc:
            warns.append({'pdf': cur['pdf'], 'issue': 'crossover row not understood', 'raw': (cur['e'] + ' ' + cur['body'])[:120]})
            return
        x = _xref_parts(parts)
        rows.append([cur['e'], x['items'], x['less'], x['plus'], desc, match, cur['pdf']])

    for pdf, text in pages:
        for raw in text.splitlines():
            l = raw.strip()
            if not l or XREF_SKIP.match(l):
                continue
            if cur and not _xref_split(cur['body'])[1]:
                cur['body'] += ' ' + l              # the row has no description yet: this line continues it
                continue
            first = l.split()[0]
            if not XREF_ENERPAC.match(first) or first.endswith(','):
                if cur:
                    cur['body'] += ' ' + l
                continue
            close()
            cur = {'e': first, 'body': l[len(first):].strip(), 'pdf': pdf}
    close()
    return rows, warns


def write_crossover(pdf_path, out_dir, known):
    import logging
    import pypdf
    logging.disable(logging.CRITICAL)
    r = pypdf.PdfReader(pdf_path)
    pages = [(i + 1, p.extract_text() or '') for i, p in enumerate(r.pages)]
    rows, warns = parse_crossover(pages[2:31])
    unknown = sorted({it[0] for row in rows for it in row[1] if it[0] not in known and not re.fullmatch(r'\d+', it[0])})
    src = {'title': '2025 Power Team Crossover Reference', 'file': os.path.basename(pdf_path), 'url': XREF_URL,
           'pages': len(pages), 'sha256': hashlib.sha256(open(pdf_path, 'rb').read()).hexdigest(),
           'extractor': 'pypdf ' + pypdf.__version__, 'tool': 'tools_pt_catalog.py --crossover', 'generated': date.today().isoformat()}
    doc = {'_source': src, '_legend': {'E': 'equivalent', 'S': 'similar', '': 'match type not stated'},
           '_cols': ['enerpac', 'items [[pt, qty]]', 'less', 'plus [[pt, qty]]', 'description', 'match', 'pdf page'],
           '_warnings': warns, '_notInCatalog': unknown, 'rows': rows}
    with open(os.path.join(out_dir, 'pt_crossover.json'), 'w') as f:
        json.dump(doc, f, separators=(',', ':'), ensure_ascii=False)
        f.write('\n')
    print('crossover rows:', len(rows), '| warnings:', len(warns), '| Power Team numbers not in the catalog:', len(unknown))
    return 0


def write_outputs(catalog, index, out_dir, source):
    catalog = dict(_source=source, **catalog)
    index = dict(_source=source, **index)
    with open(os.path.join(out_dir, 'pt_catalog.json'), 'w') as f:
        json.dump(catalog, f, separators=(',', ':'), sort_keys=False, ensure_ascii=False)
        f.write('\n')
    with open(os.path.join(out_dir, 'pt_index.json'), 'w') as f:
        json.dump(index, f, separators=(',', ':'), ensure_ascii=False)
        f.write('\n')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('pdf', nargs='?')
    ap.add_argument('--text-json', help='development: {"sha256":…, "pages":[text…]} instead of the PDF')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dashboard', 'data'))
    ap.add_argument('--check', action='store_true', help='regenerate in memory and compare with the committed JSON')
    ap.add_argument('--crossover', metavar='PDF', help='read the 2025 Power Team Crossover Reference into pt_crossover.json')
    a = ap.parse_args(argv)
    if a.crossover:
        known = {r['m'] for r in json.load(open(os.path.join(a.out, 'pt_catalog.json')))['models']}
        return write_crossover(a.crossover, a.out, known)
    if a.text_json:
        d = json.load(open(a.text_json))
        pages, sha, extractor, fname, n = [(i + 1, t) for i, t in enumerate(d['pages'])], d['sha256'], 'pypdf (cached text)', d.get('file', 'PT_Catalog_0124_US_Web_hot_spot (1).pdf'), len(d['pages'])
    else:
        pages, ver = extract_pages(a.pdf)
        sha, extractor, fname, n = hashlib.sha256(open(a.pdf, 'rb').read()).hexdigest(), 'pypdf ' + ver, os.path.basename(a.pdf), len(pages)
    fam_ids = []
    try:
        fam_ids = [p['id'] for p in json.load(open(os.path.join(a.out, 'products.json')))['products']]
    except (OSError, ValueError, KeyError):
        pass
    catalog, index, report = build(pages, fam_ids)
    source = {'file': fname, 'pages': n, 'sha256': sha, 'extractor': extractor, 'tool': 'tools_pt_catalog.py'}
    if a.check:
        cur = json.load(open(os.path.join(a.out, 'pt_catalog.json')))
        same = cur.get('models') == json.loads(json.dumps(catalog['models']))
        print('pt_catalog.json is', 'up to date' if same else 'DIFFERENT from a fresh import')
        return 0 if same else 1
    source['generated'] = date.today().isoformat()
    write_outputs(catalog, index, a.out, source)
    print('models by category:', json.dumps(report['counts'], sort_keys=True))
    print('index rows:', len(index['rows']), '| warnings:', len(report['warnings']), '| chart duplicates:', len(report['chartDuplicates']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
