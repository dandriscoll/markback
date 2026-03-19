"""MarkBack command-line interface."""

import glob as glob_module
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console

from .config import init_env
from .linter import format_diagnostics, lint_file, lint_files, summarize_results
from .parser import parse_directory, parse_file
from .types import Record, SourceRef
from .writer import OutputMode, normalize_file, write_file, write_paired_files

err_console = Console(stderr=True)
out_console = Console()


def get_mb_path(target: Path) -> Path:
    """Get the .mb file path for a target file."""
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


def _is_glob(target: str) -> bool:
    """Check if target contains glob characters."""
    return any(c in target for c in ('*', '?', '['))


def _is_text_file(path: Path) -> bool:
    """Heuristic check if a file is text (not binary)."""
    try:
        with open(path, 'rb') as f:
            chunk = f.read(8192)
        return b'\x00' not in chunk
    except OSError:
        return False


# Max file size (in bytes) for embedding content inline
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

    content = normalize_file(inp, output_path=out, in_place=in_place)

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
        err_console.print(f"[red]Unknown format: {to_format}. Use: single, multi, compact, paired[/red]")
        raise typer.Exit(1)

    if mode == OutputMode.PAIRED:
        out.mkdir(parents=True, exist_ok=True)
        for i, record in enumerate(result.records):
            identifier = record.get_identifier() or f"record-{i}"
            safe_name = identifier.replace("/", "_").replace(":", "_").replace(" ", "_")
            label_path = out / f"{safe_name}.label.txt"
            content_path = out / f"{safe_name}.txt"
            write_paired_files(label_path, content_path, record, write_content=record.has_inline_content())
    else:
        write_file(out, result.records, mode=mode)

    err_console.print(f"Converted {len(result.records)} record(s) to {to_format} format")


def _do_init(targets: list[str], force: bool):
    """Initialize a .env config file."""
    env_path = Path(targets[0]) if targets else Path(".env")

    created = init_env(env_path, force=force)
    if created:
        typer.echo(f"Created {env_path}")
    else:
        err_console.print(f"[red]{env_path} already exists. Use --force to overwrite.[/red]")
        raise typer.Exit(1)


def _add_single(target: str, feedback: Optional[str], prior_ref: Optional[SourceRef]) -> None:
    """Handle single-file feedback entry."""
    target_path = Path(target)
    mb_path = get_mb_path(target_path)

    if feedback is None:
        # No feedback arg — open editor
        if not mb_path.exists():
            if not target_path.exists():
                err_console.print(f"[red]Target file not found: {target}[/red]")
                raise typer.Exit(1)
            record = Record(source=SourceRef(target), feedback="")
            write_file(mb_path, [record])
        open_editor(mb_path)
    else:
        content = _read_inline_content(target_path)
        new_record = Record(
            source=SourceRef(target),
            feedback=feedback,
            prior=prior_ref,
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
    prior_ref: Optional[SourceRef],
    print_content: bool,
) -> None:
    """Handle multi-file feedback entry (batch or interactive)."""
    if feedback is not None:
        records = [
            Record(
                source=SourceRef(f),
                feedback=feedback,
                prior=prior_ref,
                content=_read_inline_content(Path(f)),
            )
            for f in matches
        ]
        output_path = get_feedback_path(_output_dir_for(matches))
        write_file(output_path, records, mode=OutputMode.MULTI)
        err_console.print(f"Wrote {len(records)} record(s) to {output_path}")
    else:
        collected: list[Record] = []
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
                        source=SourceRef(match),
                        feedback=fb.strip(),
                        prior=prior_ref,
                        content=_read_inline_content(Path(match)),
                    )
                )

        if collected:
            output_path = get_feedback_path(_output_dir_for(matches))
            write_file(output_path, collected, mode=OutputMode.MULTI)
            err_console.print(f"Wrote {len(collected)} record(s) to {output_path}")
        else:
            err_console.print("No feedback entered.")


app = typer.Typer(
    name="mb",
    help="MarkBack: annotate files with feedback.",
    add_completion=False,
)


@app.command()
def main(
    targets: Optional[list[str]] = typer.Argument(None, help="Target file(s) or glob pattern"),
    # Annotation options
    feedback: Optional[str] = typer.Option(None, "--feedback", "-f", help="Feedback text"),
    prior: Optional[str] = typer.Option(None, "--prior", help="Path to prior file"),
    print_content: bool = typer.Option(False, "--print", help="Print file contents before prompting"),
    # Utility modes
    do_lint: bool = typer.Option(False, "--lint", help="Lint the target file(s)"),
    do_list: bool = typer.Option(False, "--list", help="List records in the target file(s)"),
    do_normalize: bool = typer.Option(False, "--normalize", help="Normalize a file to canonical format"),
    do_convert: bool = typer.Option(False, "--convert", help="Convert a file to a different format"),
    do_init: bool = typer.Option(False, "--init", help="Initialize a .env config file"),
    # Utility options
    json_output: bool = typer.Option(False, "--json", help="Output as JSON (with --lint or --list)"),
    no_source_check: bool = typer.Option(False, "--no-source-check", help="Skip source file checks (with --lint)"),
    no_canonical_check: bool = typer.Option(False, "--no-canonical-check", help="Skip canonical checks (with --lint)"),
    output: Optional[str] = typer.Option(None, "--output", "-o", help="Output file (with --normalize or --convert)"),
    in_place: bool = typer.Option(False, "--in-place", help="Modify file in place (with --normalize)"),
    to_format: Optional[str] = typer.Option(None, "--to", help="Target format: single, multi, compact, paired (with --convert)"),
    force: bool = typer.Option(False, "--force", help="Overwrite existing file (with --init)"),
    # Meta
    version: bool = typer.Option(False, "--version", "-V", callback=version_callback, is_eager=True, help="Show version and exit."),
):
    """Annotate files with feedback, or run utility operations."""
    files = targets or []

    # Dispatch utility modes
    if do_init:
        _do_init(files, force)
        return
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

    # Default: annotation mode
    if not files:
        typer.echo("Usage: mb [OPTIONS] TARGET [TARGET...]\n\nTry 'mb --help' for help.")
        raise typer.Exit(0)

    prior_ref = SourceRef(prior) if prior else None

    # Single target with glob chars — expand it
    if len(files) == 1 and _is_glob(files[0]):
        matches = sorted(glob_module.glob(files[0]))
        if not matches:
            err_console.print(f"[red]No files match pattern: {files[0]}[/red]")
            raise typer.Exit(1)
        _add_multi(matches, feedback, prior_ref, print_content)
    elif len(files) == 2 and not _is_glob(files[0]) and not Path(files[1]).exists():
        # Positional shorthand: mb file.txt "some feedback"
        _add_single(files[0], files[1], prior_ref)
    elif len(files) == 1:
        _add_single(files[0], feedback, prior_ref)
    else:
        # Multiple files (shell-expanded glob or explicit list)
        _add_multi(files, feedback, prior_ref, print_content)


def cli():
    """Entry point for the CLI."""
    app()


if __name__ == "__main__":
    cli()
