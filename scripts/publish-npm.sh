#!/bin/bash
set -e

# Publish JavaScript package to npm

cd "$(dirname "$0")/../packages/markbackjs"

echo "Building and publishing to npm..."
npm publish

echo "Done! Package published to npm."
