"""MarkBack command-line interface."""

import glob
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console

from .writer import write_file

err_console = Console(stderr=True)


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


def collect_glob(pattern: str) -> None:
    """Expand a glob pattern and write all matches into a single .mb file."""
    from .types import Record, SourceRef

    matches = sorted(glob.glob(pattern))
    if not matches:
        err_console.print(f"[red]No files match pattern: {pattern}[/red]")
        raise typer.Exit(1)

    records = [Record(source=SourceRef(f), feedback="") for f in matches]

    # Determine output directory from the pattern's parent, defaulting to cwd
    pattern_parent = Path(pattern).parent
    output_dir = pattern_parent if pattern_parent != Path("") else Path(".")
    output_path = get_feedback_path(output_dir)

    write_file(output_path, records)
    err_console.print(f"Created {output_path} with {len(records)} source(s)")
    open_editor(output_path)


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
        # Try xdg-open first, then fall back to common editors
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


def main(
    target: Annotated[
        str,
        typer.Argument(help="Target file or glob pattern to manage feedback for"),
    ],
):
    """MarkBack: Create or view feedback for a target file."""
    # Check if target is a glob pattern
    if any(c in target for c in ('*', '?', '[')):
        collect_glob(target)
        return

    target = Path(target)
    mb_path = get_mb_path(target)

    if not mb_path.exists():
        # Create new .mb file
        if not target.exists():
            err_console.print(f"[red]Target file not found: {target}[/red]")
            raise typer.Exit(1)

        from .types import Record
        record = Record(
            source=target,
            feedback="",
        )
        write_file(mb_path, [record])

    open_editor(mb_path)


def cli():
    """Entry point for the CLI."""
    typer.run(main)


if __name__ == "__main__":
    cli()
