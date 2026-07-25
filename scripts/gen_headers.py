#!/usr/bin/env python3
"""Generate the per-language header registries from shared/headers.json.

The set of known headers and their canonical order used to be duplicated across
the Python and JS parsers and writers, so a new header meant editing several
sites by hand and the two languages could silently diverge. This script makes
`shared/headers.json` the one authoritative definition and regenerates:

  - markback/_headers.py
  - packages/markbackjs/src/_headers.ts

Run it after editing shared/headers.json:

    python scripts/gen_headers.py

A sync test in each library fails if the generated files drift from the source.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "shared" / "headers.json"

BANNER = "DO NOT EDIT — generated from shared/headers.json by scripts/gen_headers.py."


def _load() -> dict:
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    return {
        "known": list(data["known"]),
        "canonical_order": list(data["canonical_order"]),
        "section_inherited": list(data["section_inherited"]),
        "v1_map": dict(data["v1_map"]),
    }


def _py(data: dict) -> str:
    def lst(name):
        items = ", ".join(f'"{h}"' for h in data[name])
        return f"[{items}]"

    v1 = ", ".join(f'"{k}": "{v}"' for k, v in data["v1_map"].items())
    return f'''"""{BANNER}"""

# Header keywords the parser recognizes (others emit W002).
KNOWN_HEADERS = set({lst("known")})

# The order headers are emitted in canonical output (SPEC §7.1).
CANONICAL_ORDER = {lst("canonical_order")}

# Headers inherited by continuation segments of a multi-segment section
# (@id, @reply-to, and @action are per-record and never inherited).
SECTION_INHERITED = set({lst("section_inherited")})

# V1 header names mapped to their V2 equivalents (each emits W010).
V1_HEADER_MAP = {{{v1}}}
'''


def _ts(data: dict) -> str:
    def arr(name):
        items = ", ".join(f'"{h}"' for h in data[name])
        return f"[{items}]"

    v1 = ", ".join(f'{k}: "{v}"' for k, v in data["v1_map"].items())
    return f'''// {BANNER}

// Header keywords the parser recognizes (others emit W002).
export const KNOWN_HEADERS = new Set<string>({arr("known")});

// The order headers are emitted in canonical output (SPEC §7.1).
export const CANONICAL_ORDER: string[] = {arr("canonical_order")};

// Headers inherited by continuation segments of a multi-segment section
// (@id, @reply-to, and @action are per-record and never inherited).
export const SECTION_INHERITED = new Set<string>({arr("section_inherited")});

// V1 header names mapped to their V2 equivalents (each emits W010).
export const V1_HEADER_MAP: {{ [key: string]: string }} = {{ {v1} }};
'''


def main() -> None:
    data = _load()
    (ROOT / "markback" / "_headers.py").write_text(_py(data), encoding="utf-8")
    (ROOT / "packages" / "markbackjs" / "src" / "_headers.ts").write_text(
        _ts(data), encoding="utf-8"
    )
    print("Generated markback/_headers.py and packages/markbackjs/src/_headers.ts")


if __name__ == "__main__":
    main()
