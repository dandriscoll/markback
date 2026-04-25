#!/bin/bash
set -e

# Publish Python package to PyPI

cd "$(dirname "$0")/.."

VENV="$(pwd)/.venv"
if [[ ! -x "$VENV/bin/python" ]]; then
    echo "Error: virtualenv not found at $VENV"
    echo "Create it with: python -m venv .venv && .venv/bin/pip install -e '.[dev]'"
    exit 1
fi

PY="$VENV/bin/python"

# Clean stale builds — twine upload dist/* would otherwise try to re-upload
# previously-built versions (which PyPI rejects, masking the real version).
echo "Cleaning dist/..."
rm -rf dist/

echo "Building Python package..."
"$PY" -m build

echo "Uploading to PyPI..."
"$PY" -m twine upload dist/*

echo "Done! Package published to PyPI."
