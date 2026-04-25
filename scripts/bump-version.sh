#!/bin/bash
# Bump version across all package manifests (no git, no publish, just file edits).
# Each file's current version is detected independently, so drifted files
# get pulled back into sync automatically.
set -e

cd "$(dirname "$0")/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

if [[ $# -ne 1 ]]; then
    echo "Usage: $0 <new-version>"
    echo "Example: $0 0.2.2"
    exit 1
fi

NEW="$1"

if ! [[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo -e "${RED}Invalid version: $NEW${NC}"
    exit 1
fi

# Replace the first match of <prefix><semver><suffix> in $file with NEW.
# Detects the current version itself, so it works even if the file has drifted.
update() {
    local file="$1" prefix="$2" suffix="$3"
    if [[ ! -f "$file" ]]; then
        echo -e "${RED}  MISSING  $file${NC}"
        return 1
    fi
    local current
    current=$(grep -oE "${prefix}[0-9]+\.[0-9]+\.[0-9]+${suffix}" "$file" | head -1 \
              | sed -E "s|${prefix}||; s|${suffix}||")
    if [[ -z "$current" ]]; then
        echo -e "${RED}  NOT FOUND  pattern in $file${NC}"
        return 1
    fi
    if [[ "$current" == "$NEW" ]]; then
        echo -e "  unchanged $file (already $NEW)"
        return 0
    fi
    sed -i "0,/${prefix}${current}${suffix}/s||${prefix}${NEW}${suffix}|" "$file"
    echo -e "${GREEN}  updated  $file ($current -> $NEW)${NC}"
}

echo "Setting version to $NEW"
echo ""

update pyproject.toml \
    'version = "' \
    '"'

update packages/markbackjs/package.json \
    '"version": "' \
    '"'

# package-lock.json: top-level "version" and the root package entry ("")
# both carry the project's own version. All other "version" lines are
# dependency versions and must be left alone — rewrite only the first two.
LOCK=packages/markbackjs/package-lock.json
if [[ -f "$LOCK" ]]; then
    awk -v new="$NEW" '
        BEGIN { count = 0; changed = 0 }
        count < 2 && /^[[:space:]]*"version":[[:space:]]*"[0-9]+\.[0-9]+\.[0-9]+"/ {
            if ($0 !~ "\"" new "\"") changed = 1
            sub(/"[0-9]+\.[0-9]+\.[0-9]+"/, "\"" new "\"")
            count++
        }
        { print }
        END { exit changed ? 0 : 2 }
    ' "$LOCK" > "$LOCK.tmp"
    rc=$?
    if [[ $rc -eq 0 ]]; then
        mv "$LOCK.tmp" "$LOCK"
        echo -e "${GREEN}  updated  $LOCK${NC}"
    elif [[ $rc -eq 2 ]]; then
        rm "$LOCK.tmp"
        echo -e "  unchanged $LOCK (already $NEW)"
    else
        rm -f "$LOCK.tmp"
        echo -e "${RED}  FAILED   $LOCK${NC}"
        exit 1
    fi
fi

echo ""
echo -e "${GREEN}Done. All files at ${NEW}.${NC}"
