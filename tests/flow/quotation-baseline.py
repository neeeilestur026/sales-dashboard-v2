"""Capture or check the byte-identity baseline for the SCOPE-LESS quotation path.

    venv/bin/python tests/flow/quotation-baseline.py --capture   # write the hashes (do this FIRST)
    venv/bin/python tests/flow/quotation-baseline.py             # check nothing moved

This is the only thing protecting the ~100 live quotations while A213 rewires the items table's
backgrounds and rules. Capture before touching the renderer; check after every step.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from quo_fixtures import fixtures, render, digest  # noqa: E402

OUT = Path(__file__).resolve().parent / "baseline" / "quotation-noscope.json"


def main():
    capture = "--capture" in sys.argv
    got = {}
    for name, kw in fixtures():
        try:
            pdf = render(kw)
        except Exception as e:                       # a fixture that cannot render is itself a failure
            print("  FAIL %-20s raised %s: %s" % (name, type(e).__name__, e))
            return 1
        got[name] = {"sha256": digest(pdf), "bytes": len(pdf)}

    if capture:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(got, indent=2, sort_keys=True) + "\n")
        print("captured %d fixtures -> %s" % (len(got), OUT))
        for k, v in sorted(got.items()):
            print("  %-20s %s  %6d bytes" % (k, v["sha256"][:16], v["bytes"]))
        return 0

    if not OUT.exists():
        print("no baseline at %s — run with --capture first" % OUT)
        return 1
    want = json.loads(OUT.read_text())
    fail = 0
    for name in sorted(set(want) | set(got)):
        w, g = want.get(name), got.get(name)
        if w is None:
            print("  FAIL %-20s is new — capture again if that is intended" % name); fail += 1
        elif g is None:
            print("  FAIL %-20s disappeared from the fixture list" % name); fail += 1
        elif w["sha256"] != g["sha256"]:
            print("  FAIL %-20s CHANGED  %d -> %d bytes" % (name, w["bytes"], g["bytes"])); fail += 1
        else:
            print("  ok   %-20s unchanged (%d bytes)" % (name, g["bytes"]))
    print("\n%d fixture(s), %d changed" % (len(got), fail))
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
