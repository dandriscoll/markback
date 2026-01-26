#!/bin/bash
set -e

# Publish both Python and JavaScript packages

SCRIPT_DIR="$(dirname "$0")"

echo "=== Publishing to PyPI ==="
"$SCRIPT_DIR/publish-pypi.sh"

echo ""
echo "=== Publishing to npm ==="
"$SCRIPT_DIR/publish-npm.sh"

echo ""
echo "All packages published successfully!"
