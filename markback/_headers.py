"""DO NOT EDIT — generated from shared/headers.json by scripts/gen_headers.py."""

# Header keywords the parser recognizes (others emit W002).
KNOWN_HEADERS = set(["id", "by", "file", "input", "tag", "reply-to", "action"])

# The order headers are emitted in canonical output (SPEC §7.1).
CANONICAL_ORDER = ["id", "reply-to", "by", "action", "tag", "input", "file"]

# Headers inherited by continuation segments of a multi-segment section
# (@id, @reply-to, and @action are per-record and never inherited).
SECTION_INHERITED = set(["file", "by", "tag", "input"])

# V1 header names mapped to their V2 equivalents (each emits W010).
V1_HEADER_MAP = {"uri": "id", "source": "file", "prior": "input"}
