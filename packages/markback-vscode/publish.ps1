#!/usr/bin/env pwsh
# Publish the Markback VS Code extension to the Marketplace from Windows.
#
# Reads the Marketplace Personal Access Token from `ADO_PAT` in the repo-root
# `.env` (the Azure DevOps PAT with "Marketplace > Manage" scope) and hands it
# to vsce as VSCE_PAT. The .env is gitignored and must never be committed; this
# script never prints the token nor passes it as a command-line argument (which
# would leak into process listings) — it goes only through the env var that
# vsce reads.
#
# Usage (run from anywhere):
#   ./publish.ps1                      # publish the current package.json version
#   ./publish.ps1 patch                # let vsce bump the patch version, then publish
#   ./publish.ps1 --packagePath x.vsix # publish a pre-built .vsix
# Any extra arguments are forwarded verbatim to `vsce publish`.

$ErrorActionPreference = 'Stop'

# --- Locate the repository root (where .env lives) ---------------------------
# Prefer git; fall back to this script's fixed location (packages/markback-vscode
# is two levels below the repo root).
$repoRoot = $null
try {
    $top = git -C $PSScriptRoot rev-parse --show-toplevel 2>$null
    if ($LASTEXITCODE -eq 0 -and $top) { $repoRoot = $top.Trim() }
} catch {
    # git not on PATH — fall through to the path-based default
}
if (-not $repoRoot) {
    $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
}

$envPath = Join-Path $repoRoot '.env'
if (-not (Test-Path -LiteralPath $envPath)) {
    throw "No .env found at '$envPath'. Create it with a line: ADO_PAT=<your-marketplace-PAT>"
}

# --- Read ONLY ADO_PAT from .env (do not import the whole environment) -------
$pat = $null
foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -match '^\s*(?:export\s+)?ADO_PAT\s*=\s*(.*)$') {
        $val = $Matches[1].Trim()
        # Strip one layer of surrounding single or double quotes, if present.
        if ($val.Length -ge 2 -and
            (($val.StartsWith('"') -and $val.EndsWith('"')) -or
             ($val.StartsWith("'") -and $val.EndsWith("'")))) {
            $val = $val.Substring(1, $val.Length - 2)
        }
        $pat = $val
        # Use the first non-empty definition; tolerate an earlier empty one.
        if ($pat) { break }
    }
}

if (-not $pat) {
    throw "ADO_PAT not found (or empty) in '$envPath'. Expected a line: ADO_PAT=<your-marketplace-PAT>"
}
Write-Host "Loaded ADO_PAT from $envPath (length: $($pat.Length))."

# --- Publish (vsce reads the PAT from VSCE_PAT) ------------------------------
# Run from the extension directory so vsce finds package.json. --no-dependencies
# is required: the extension is esbuild-bundled (see PUBLISH.md).
$env:VSCE_PAT = $pat
try {
    Push-Location -LiteralPath $PSScriptRoot
    try {
        Write-Host "Publishing dandriscoll.markback-vscode ..."
        npx @vscode/vsce publish --no-dependencies @args
        if ($LASTEXITCODE -ne 0) {
            throw "vsce publish failed with exit code $LASTEXITCODE."
        }
        Write-Host "Published successfully."
    } finally {
        Pop-Location
    }
} finally {
    # Don't leave the token in the session's environment.
    Remove-Item Env:VSCE_PAT -ErrorAction SilentlyContinue
}
