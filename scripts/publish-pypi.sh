#!/bin/bash
set -e

# Publish Python package to PyPI

cd "$(dirname "$0")/.."

echo "Building Python package..."
python -m build

echo "Uploading to PyPI..."
python -m twine upload dist/*

echo "Done! Package published to PyPI."
