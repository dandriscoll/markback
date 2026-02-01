"""MarkBack command-line interface."""

import os
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
        subprocess.run(["xdg-open", str(path)])


def main(
    target: Annotated[
        Path,
        typer.Argument(help="Target file to manage feedback for"),
    ],
):
    """MarkBack: Create or view feedback for a target file."""
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
