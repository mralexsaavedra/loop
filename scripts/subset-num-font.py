#!/usr/bin/env python3
"""Rebuild web/src/fonts/hc-num-bold.woff2: the numerals-only subset of D-DIN Bold used for dial
and score numbers (inlined as base64 @font-face by web/layouts/Plan.astro).

D-DIN is SIL OFL 1.1 with the Reserved Font Name "D-DIN" (see web/src/fonts/OFL.txt). A subset is
a Modified Version under the OFL, so it must NOT carry the reserved name: the name table is
rewritten to "HC Num". Needs fontTools + brotli (pip install fonttools brotli).

Usage: python3 scripts/subset-num-font.py path/to/D-DIN-Bold.ttf
  (D-DIN-Bold.ttf from https://github.com/amcchord/datto-d-din)
"""
import sys
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

TEXT = "0123456789+-,.%×h "  # digits, sign, decimal separators, %, ×, h (hours), space
OUT = Path(__file__).resolve().parent.parent / "web" / "src" / "fonts" / "hc-num-bold.woff2"
FAMILY = "HC Num"
NAMES = {
    0: "Copyright (C) 2017 Datto Inc. Modified Version (subset, renamed) under SIL OFL 1.1.",
    1: FAMILY, 2: "Bold", 3: "HC Num Bold 1.00 subset", 4: "HC Num Bold",
    5: "Version 1.00", 6: "HCNum-Bold",
}


def main(src):
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["tnum", "kern"]
    opts.hinting = False
    opts.desubroutinize = True
    opts.name_IDs = list(NAMES)
    font = subset.load_font(src, opts)
    sub = subset.Subsetter(opts)
    sub.populate(text=TEXT)
    sub.subset(font)
    name = font["name"]
    name.names = [r for r in name.names if r.nameID not in NAMES]
    for nid, val in NAMES.items():
        name.setName(val, nid, 3, 1, 0x409)
    font.flavor = "woff2"
    font.save(str(OUT))
    check = TTFont(str(OUT))
    assert not any("D-DIN" in r.toUnicode() for r in check["name"].names), "reserved name leaked"
    print(f"{OUT} {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "D-DIN-Bold.ttf")
