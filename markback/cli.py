"""MarkBack V2 command-line interface."""

import glob as glob_module
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import typer
from rich.console import Console

from .linter import format_diagnostics, lint_file, lint_files, summarize_results
from .parser import parse_directory, parse_file
from .types import FileRef, Record
from .writer import OutputMode, normalize, write, write_file, write_string

err_console = Console(stderr=True)
out_console = Console()


def get_mb_path(target: Path) -> Path:
    """Get the .mb sidecar path for a target file."""
    return target.with_suffix(target.suffix + ".mb")


def get_feedback_path(directory: Path) -> Path:
    """Get a non-colliding feedback.mb path in the given directory."""
    candidate = directory / "feedback.mb"
    if not candidate.exists():
        return candidate
    counter = 1
    while True:
        candidate = directory / f"feedback-{counter}.mb"
        if not candidate.exists():
            return candidate
        counter += 1


def open_editor(path: Path) -> None:
    """Open the file in the user's editor."""
    editor = os.environ.get("EDITOR") or os.environ.get("VISUAL")

    if editor:
        subprocess.run([editor, str(path)])
    elif sys.platform == "win32":
        os.startfile(path)
    elif sys.platform == "darwin":
        subprocess.run(["open", str(path)])
    else:
        if shutil.which("xdg-open"):
            result = subprocess.run(["xdg-open", str(path)], capture_output=True)
            if result.returncode == 0:
                return
        for fallback in ("nano", "vi"):
            if shutil.which(fallback):
                subprocess.run([fallback, str(path)])
                return
        err_console.print(
            f"[red]No editor found. Set the EDITOR environment variable, e.g.:[/red]\n"
            f"  export EDITOR=nano"
        )
        raise typer.Exit(1)


def _is_url(target: str) -> bool:
    """Check if target is a URI (any scheme of length > 1).

    Length > 1 avoids confusing Windows drive letters (`c:\\path`) with
    schemes — matches FileRef's own URI heuristic.
    """
    scheme = urlparse(target).scheme
    return len(scheme) > 1


def _is_glob(target: str) -> bool:
    """Check if target contains glob characters."""
    if _is_url(target):
        return False
    return any(c in target for c in ('*', '?', '['))


_UNSAFE_FS_CHARS = re.compile(r'[\x00-\x1f<>:"/\\|?*]')


def url_to_mb_path(url: str) -> Path:
    """Derive a sidecar .mb path from a URL.

    Picks the last non-empty path segment, falling back to the hostname.
    """
    parsed = urlparse(url)
    segments = [s for s in parsed.path.split("/") if s]
    name = segments[-1] if segments else (parsed.hostname or "url")
    name = _UNSAFE_FS_CHARS.sub("_", name).strip(". ") or (parsed.hostname or "url")
    return Path(f"{name}.mb")


def _is_text_file(path: Path) -> bool:
    """Heuristic check if a file is text (not binary)."""
    try:
        with open(path, 'rb') as f:
            chunk = f.read(8192)
        return b'\x00' not in chunk
    except OSError:
        return False


_MAX_INLINE_SIZE = 65_536


def _read_inline_content(path: Path) -> Optional[str]:
    """Read file content for inline embedding if it's a small text file."""
    try:
        if not path.is_file():
            return None
        if path.stat().st_size > _MAX_INLINE_SIZE:
            return None
        if not _is_text_file(path):
            return None
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def _output_dir_for(files: list[str]) -> Path:
    """Determine output directory from a list of file paths."""
    parents = {str(Path(f).parent) for f in files}
    if len(parents) == 1:
        p = parents.pop()
        return Path(p) if p and p != "" else Path(".")
    return Path(".")


def version_callback(value: bool):
    if value:
        from importlib.metadata import version
        try:
            v = version("markback")
        except Exception:
            v = "unknown"
        typer.echo(f"markback {v}")
        raise typer.Exit()


def _do_lint(targets: list[str], json_output: bool, no_source_check: bool, no_canonical_check: bool):
    """Run linter on targets."""
    resolved = [Path(p) for p in targets]
    results = lint_files(
        resolved,
        check_sources=not no_source_check,
        check_canonical=not no_canonical_check,
    )

    all_diagnostics = []
    for r in results:
        all_diagnostics.extend(r.diagnostics)

    summary = summarize_results(results)

    if json_output:
        output = {
            "summary": summary,
            "diagnostics": [d.to_dict() for d in all_diagnostics],
        }
        typer.echo(json.dumps(output, indent=2))
    else:
        if all_diagnostics:
            typer.echo(format_diagnostics(all_diagnostics))
            typer.echo()

        if len(results) > 1:
            typer.echo(f"Files: {summary['files']}")
        typer.echo(f"Records: {summary['records']}")
        typer.echo(f"Errors: {summary['errors']}")
        typer.echo(f"Warnings: {summary['warnings']}")

    if summary["errors"] > 0:
        raise typer.Exit(1)


def _do_list(targets: list[str], json_output: bool):
    """List records in targets."""
    all_records: list[Record] = []

    for p in targets:
        path = Path(p)
        if path.is_dir():
            result = parse_directory(path)
        else:
            result = parse_file(path)
        all_records.extend(result.records)

    if json_output:
        typer.echo(json.dumps([r.to_dict() for r in all_records], indent=2))
    else:
        for i, record in enumerate(all_records, 1):
            identifier = record.get_identifier() or f"record-{i}"
            typer.echo(f"  {i}. [{identifier}] {record.feedback}")
        typer.echo(f"Total: {len(all_records)} record(s)")


def _do_normalize(targets: list[str], output: Optional[str], in_place: bool):
    """Normalize a file to canonical format."""
    if not targets:
        err_console.print("[red]No file specified for --normalize[/red]")
        raise typer.Exit(1)
    inp = Path(targets[0])
    out = Path(output) if output else None

    content = normalize(inp, output_path=out, in_place=in_place)

    if not out and not in_place:
        typer.echo(content, nl=False)


def _do_convert(targets: list[str], output: Optional[str], to_format: str):
    """Convert a file to a different format."""
    if not targets:
        err_console.print("[red]No file specified for --convert[/red]")
        raise typer.Exit(1)
    if not output:
        err_console.print("[red]--output is required with --convert[/red]")
        raise typer.Exit(1)

    inp = Path(targets[0])
    out = Path(output)

    result = parse_file(inp)
    if result.has_errors:
        err_console.print("[red]Input file has errors, cannot convert[/red]")
        raise typer.Exit(1)

    try:
        mode = OutputMode(to_format)
    except ValueError:
        err_console.print(f"[red]Unknown format: {to_format}. Use: single, multi, compact[/red]")
        raise typer.Exit(1)

    write_file(out, result.records, mode=mode)
    err_console.print(f"Converted {len(result.records)} record(s) to {to_format} format")


def _do_upgrade(targets: list[str], dry_run: bool):
    """Upgrade V1 files to V2 format."""
    if not targets:
        err_console.print("[red]No files specified for --upgrade[/red]")
        raise typer.Exit(1)

    for target in targets:
        path = Path(target)
        if path.is_dir():
            files = list(path.glob("**/*.mb"))
        else:
            files = [path]

        for f in files:
            result = parse_file(f)
            v1_warnings = [d for d in result.diagnostics if d.code == WarningCode.W010]

            if not v1_warnings:
                typer.echo(f"  {f}: already V2 format")
                continue

            if dry_run:
                typer.echo(f"  {f}: {len(v1_warnings)} V1 header(s) to upgrade")
            else:
                content = write_string(
                    result.records,
                    scope=result.scope,
                    covers=result.covers,
                    version_header=True,
                )
                f.write_text(content, encoding="utf-8")
                err_console.print(f"  Upgraded {f}")


def _do_stats(targets: list[str], json_output: bool):
    """Show statistics for MarkBack files."""
    all_records: list[Record] = []
    file_count = 0

    for p in targets:
        path = Path(p)
        if path.is_dir():
            result = parse_directory(path)
        else:
            result = parse_file(path)
            file_count += 1
        all_records.extend(result.records)

    # Compute stats
    tag_counts: dict[str, int] = {}
    by_counts: dict[str, int] = {}
    with_file = sum(1 for r in all_records if r.file)
    with_content = sum(1 for r in all_records if r.has_inline_content())
    with_input = sum(1 for r in all_records if r.input)

    for r in all_records:
        for t in r.tags:
            tag_counts[t] = tag_counts.get(t, 0) + 1
        if r.by:
            by_counts[r.by] = by_counts.get(r.by, 0) + 1

    stats = {
        "records": len(all_records),
        "with_file_ref": with_file,
        "with_inline_content": with_content,
        "with_input_ref": with_input,
        "tags": tag_counts,
        "reviewers": by_counts,
    }

    if json_output:
        typer.echo(json.dumps(stats, indent=2))
    else:
        typer.echo(f"Records: {len(all_records)}")
        typer.echo(f"  With @file: {with_file}")
        typer.echo(f"  With inline content: {with_content}")
        typer.echo(f"  With @input: {with_input}")
        if tag_counts:
            typer.echo("Tags:")
            for tag, count in sorted(tag_counts.items(), key=lambda x: -x[1]):
                typer.echo(f"  {tag}: {count}")
        if by_counts:
            typer.echo("Reviewers:")
            for by, count in sorted(by_counts.items(), key=lambda x: -x[1]):
                typer.echo(f"  {by}: {count}")


# Import here to avoid circular import at module level
from .types import WarningCode


def _add_single(
    target: str,
    feedback: Optional[str],
    input_ref: Optional[FileRef],
    tags: list[str],
    by: Optional[str],
) -> None:
    """Handle single-file feedback entry."""
    is_url = _is_url(target)
    if is_url:
        mb_path = url_to_mb_path(target)
        target_path = None
    else:
        target_path = Path(target)
        mb_path = get_mb_path(target_path)

    file_ref = FileRef(target)

    if feedback is None:
        if not mb_path.exists():
            if not is_url and not target_path.exists():
                err_console.print(f"[red]Target file not found: {target}[/red]")
                raise typer.Exit(1)
            write_file(mb_path, [Record(file=file_ref, feedback="")])
        open_editor(mb_path)
    else:
        content = None if is_url else _read_inline_content(target_path)
        new_record = Record(
            file=file_ref,
            feedback=feedback,
            input=input_ref,
            tags=tags,
            by=by,
            content=content,
        )
        if mb_path.exists():
            existing = parse_file(mb_path)
            records = existing.records + [new_record]
        else:
            records = [new_record]
        write_file(mb_path, records)
        err_console.print(f"Wrote feedback to {mb_path}")


def _add_multi(
    matches: list[str],
    feedback: Optional[str],
    input_ref: Optional[FileRef],
    tags: list[str],
    by: Optional[str],
    print_content: bool,
    scope: Optional[list[str]],
    covers: Optional[str],
) -> None:
    """Handle multi-file feedback entry (batch or interactive)."""
    if feedback is not None:
        records = [
            Record(
                file=FileRef(f),
                feedback=feedback,
                input=input_ref,
                tags=tags,
                by=by,
                content=_read_inline_content(Path(f)),
            )
            for f in matches
        ]
        output_path = get_feedback_path(_output_dir_for(matches))
        write(output_path, records, scope=scope, covers=covers)
        err_console.print(f"Wrote {len(records)} record(s) to {output_path}")
    else:
        collected: list[Record] = []
        output_path: Optional[Path] = None
        for i, match in enumerate(matches, 1):
            if print_content:
                path = Path(match)
                if path.is_file():
                    if _is_text_file(path):
                        out_console.print(path.read_text(encoding="utf-8", errors="replace"))
                    else:
                        size = path.stat().st_size
                        out_console.print(f"[binary file, {size} bytes]")

            typer.echo(f"[{i}/{len(matches)}] {match}")
            fb = typer.prompt("Feedback", default="", show_default=False)
            if fb.strip():
                collected.append(
                    Record(
                        file=FileRef(match),
                        feedback=fb.strip(),
                        input=input_ref,
                        tags=tags,
                        by=by,
                        content=_read_inline_content(Path(match)),
                    )
                )
                if output_path is None:
                    output_path = get_feedback_path(_output_dir_for(matches))
                write(output_path, collected, scope=scope, covers=covers)

        if collected:
            err_console.print(f"Wrote {len(collected)} record(s) to {output_path}")
        else:
            err_console.print("No feedback entered.")


app = typer.Typer(
    name="mb",
    help="MarkBack V2: annotate files with feedback.",
    add_completion=False,
)


@app.command()
def main(
    targets: Optional[list[str]] = typer.Argument(None, help="Target file(s) or glob pattern"),
    # Annotation options
    feedback: Optional[str] = typer.Option(None, "--feedback", "-f", help="Feedback text"),
    input_ref: Optional[str] = typer.Option(None, "--input", help="Path to input/prior file"),
    tag: Optional[str] = typer.Option(None, "--tag", help="Space-separated tags"),
    by: Optional[str] = typer.Option(None, "--by", help="Reviewer attribution"),
    print_content: bool = typer.Option(False, "--print", help="Print file contents before prompting"),
    # Sweep options
    scope: Optional[str] = typer.Option(None, "--scope", help="Space-separated scope items for sweep"),
    covers: Optional[str] = typer.Option(None, "--covers", help="Glob pattern declaring file coverage"),
    # Utility modes
    do_lint: bool = typer.Option(False, "--lint", help="Lint the target file(s)"),
    do_list: bool = typer.Option(False, "--list", help="List records in the target file(s)"),
    do_normalize: bool = typer.Option(False, "--normalize", help="Normalize a file to canonical format"),
    do_convert: bool = typer.Option(False, "--convert", help="Convert a file to a different format"),
    do_upgrade: bool = typer.Option(False, "--upgrade", help="Upgrade V1 files to V2 format"),
    do_stats: bool = typer.Option(False, "--stats", help="Show statistics for MarkBack files"),
    # Utility options
    json_output: bool = typer.Option(False, "--json", help="Output as JSON"),
    no_source_check: bool = typer.Option(False, "--no-source-check", help="Skip file existence checks"),
    no_canonical_check: bool = typer.Option(False, "--no-canonical-check", help="Skip canonical checks"),
    output: Optional[str] = typer.Option(None, "--output", "-o", help="Output file"),
    in_place: bool = typer.Option(False, "--in-place", help="Modify file in place"),
    to_format: Optional[str] = typer.Option(None, "--to", help="Target format: single, multi, compact"),
    force: bool = typer.Option(False, "--force", help="Overwrite existing file"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Preview upgrade without writing"),
    # Meta
    version: bool = typer.Option(False, "--version", "-V", callback=version_callback, is_eager=True, help="Show version and exit."),
):
    """Annotate files with feedback, or run utility operations."""
    files = targets or []

    # Dispatch utility modes
    if do_lint:
        _do_lint(files, json_output, no_source_check, no_canonical_check)
        return
    if do_list:
        _do_list(files, json_output)
        return
    if do_normalize:
        _do_normalize(files, output, in_place)
        return
    if do_convert:
        if not to_format:
            err_console.print("[red]--to is required with --convert[/red]")
            raise typer.Exit(1)
        _do_convert(files, output, to_format)
        return
    if do_upgrade:
        _do_upgrade(files, dry_run)
        return
    if do_stats:
        _do_stats(files, json_output)
        return

    # Default: annotation mode
    if not files:
        typer.echo("Usage: mb [OPTIONS] TARGET [TARGET...]\n\nTry 'mb --help' for help.")
        raise typer.Exit(0)

    input_file_ref = FileRef(input_ref) if input_ref else None
    tags = tag.split() if tag else []
    scope_list = scope.split() if scope else None

    # Single target with glob chars — expand it
    if len(files) == 1 and _is_glob(files[0]):
        matches = sorted(glob_module.glob(files[0]))
        if not matches:
            err_console.print(f"[red]No files match pattern: {files[0]}[/red]")
            raise typer.Exit(1)
        _add_multi(matches, feedback, input_file_ref, tags, by, print_content, scope_list, covers)
    elif len(files) == 2 and not _is_glob(files[0]) and not Path(files[1]).exists():
        # Positional shorthand: mb file.txt "some feedback"
        _add_single(files[0], files[1], input_file_ref, tags, by)
    elif len(files) == 1:
        _add_single(files[0], feedback, input_file_ref, tags, by)
    else:
        # Multiple files (shell-expanded glob or explicit list)
        _add_multi(files, feedback, input_file_ref, tags, by, print_content, scope_list, covers)


def cli():
    """Entry point for the CLI."""
    app()


if __name__ == "__main__":
    cli()
