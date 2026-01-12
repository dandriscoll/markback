---
title: "MarkBack"
summary: "Human-writable format for pairing content with labels and feedback."
shipped: 2026-01-04
tags: [data-annotation, machine-learning, cli, python, typescript]
links:
  - label: "markback.org"
    url: "https://markback.org"
  - label: "GitHub"
    url: "https://github.com/dandriscoll/markback"
    primary: true
  - label: "NPM"
    url: "https://www.npmjs.com/package/markbackjs"
---

## What is it?

MarkBack is a compact file format for storing content alongside feedback and labels. It's built for training data management, prompt engineering, and annotation workflows where you need human-readable files that machines can parse reliably.

## Key Features

- **Multiple storage modes** — Single-file, multi-record, compact one-liner, or paired files. Pick what fits your workflow.
- **Structured feedback parsing** — Labels, key-value attributes, JSON, and freeform comments in one line.
- **Comprehensive linting** — 18 diagnostic rules catch errors and style issues with precise line numbers.
- **External content references** — Point to files, URIs, or embed content inline. Works with text, images, and binary files.
- **Dual-language support** — Full implementations in Python (CLI + library) and TypeScript.
