"""MarkBack command-line interface."""

import json
import sys
from pathlib import Path
from typing import Annotated, Optional

import typer
from rich.console import Console
from rich.table import Table

from .config import Config, init_env, load_config, validate_config
from .linter import format_diagnostics, lint_files, summarize_results
from .parser import parse_file, parse_string
from .types import Severity, parse_feedback
from .writer import OutputMode, normalize_file, write_file, write_records_multi

app = typer.Typer(
    name="markback",
    help="MarkBack: A compact format for content + feedback",
    no_args_is_help=True,
)

console = Console()
err_console = Console(stderr=True)


@app.command()
def init(
    path: Annotated[
        Path,
        typer.Argument(help="Path to create .env file"),
    ] = Path(".env"),
    force: Annotated[
        bool,
        typer.Option("--force", "-f", help="Overwrite existing file"),
    ] = False,
):
    """Initialize a .env configuration file."""
    if init_env(path, force=force):
        console.print(f"[green]Created {path}[/green]")
    else:
        console.print(f"[yellow]{path} already exists. Use --force to overwrite.[/yellow]")
        raise typer.Exit(1)


@app.command()
def lint(
    paths: Annotated[
        list[Path],
        typer.Argument(help="Files or directories to lint"),
    ],
    output_json: Annotated[
        bool,
        typer.Option("--json", "-j", help="Output as JSON"),
    ] = False,
    no_source_check: Annotated[
        bool,
        typer.Option("--no-source-check", help="Skip checking if @source files exist"),
    ] = False,
    no_canonical_check: Annotated[
        bool,
        typer.Option("--no-canonical-check", help="Skip canonical format check"),
    ] = False,
):
    """Lint MarkBack files."""
    results = lint_files(
        paths,
        check_sources=not no_source_check,
        check_canonical=not no_canonical_check,
    )

    summary = summarize_results(results)

    # Collect all diagnostics
    all_diagnostics = []
    for result in results:
        all_diagnostics.extend(result.diagnostics)

    if output_json:
        output = {
            "summary": summary,
            "diagnostics": [d.to_dict() for d in all_diagnostics],
        }
        console.print(json.dumps(output, indent=2))
    else:
        # Print diagnostics
        for d in all_diagnostics:
            if d.severity == Severity.ERROR:
                err_console.print(f"[red]{d}[/red]")
            else:
                err_console.print(f"[yellow]{d}[/yellow]")

        # Print summary
        console.print()
        console.print(f"Files: {summary['files']}")
        console.print(f"Records: {summary['records']}")
        console.print(f"Errors: {summary['errors']}")
        console.print(f"Warnings: {summary['warnings']}")

    # Exit with error code if there were errors
    if summary["errors"] > 0:
        raise typer.Exit(1)


@app.command()
def normalize(
    input_path: Annotated[
        Path,
        typer.Argument(help="Input MarkBack file"),
    ],
    output_path: Annotated[
        Optional[Path],
        typer.Argument(help="Output file (omit for in-place)"),
    ] = None,
    in_place: Annotated[
        bool,
        typer.Option("--in-place", "-i", help="Modify input file in place"),
    ] = False,
):
    """Normalize a MarkBack file to canonical format."""
    try:
        content = normalize_file(
            input_path,
            output_path=output_path,
            in_place=in_place or (output_path is None),
        )

        if output_path:
            console.print(f"[green]Wrote {output_path}[/green]")
        elif in_place:
            console.print(f"[green]Normalized {input_path}[/green]")
        else:
            console.print(content)

    except ValueError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        raise typer.Exit(1)


@app.command("list")
def list_records(
    paths: Annotated[
        list[Path],
        typer.Argument(help="Files or directories to list"),
    ],
    output_json: Annotated[
        bool,
        typer.Option("--json", "-j", help="Output as JSON"),
    ] = False,
):
    """List records in MarkBack files."""
    all_records = []

    for path in paths:
        if path.is_dir():
            for mb_file in path.glob("**/*.mb"):
                result = parse_file(mb_file)
                for record in result.records:
                    all_records.append((mb_file, record))
        else:
            result = parse_file(path)
            for record in result.records:
                all_records.append((path, record))

    if output_json:
        output = []
        for file_path, record in all_records:
            output.append({
                "file": str(file_path),
                "uri": record.uri,
                "source": str(record.source) if record.source else None,
                "feedback": record.feedback,
                "has_content": record.has_inline_content(),
            })
        console.print(json.dumps(output, indent=2))
    else:
        table = Table(show_header=True)
        table.add_column("URI", style="cyan")
        table.add_column("Source", style="green")
        table.add_column("Feedback", style="white")

        for file_path, record in all_records:
            uri = record.uri or "-"
            source = str(record.source) if record.source else "-"
            # Truncate feedback for display
            feedback = record.feedback
            if len(feedback) > 50:
                feedback = feedback[:47] + "..."

            table.add_row(uri, source, feedback)

        console.print(table)
        console.print(f"\nTotal: {len(all_records)} records")


@app.command()
def convert(
    input_path: Annotated[
        Path,
        typer.Argument(help="Input MarkBack file or directory"),
    ],
    output_path: Annotated[
        Path,
        typer.Argument(help="Output file or directory"),
    ],
    to: Annotated[
        str,
        typer.Option("--to", "-t", help="Output format: single, multi, compact, paired"),
    ] = "multi",
):
    """Convert between MarkBack storage modes."""
    # Parse input
    if input_path.is_dir():
        from .parser import parse_directory
        result = parse_directory(input_path)
    else:
        result = parse_file(input_path)

    if result.has_errors:
        err_console.print("[red]Cannot convert file with errors[/red]")
        for d in result.diagnostics:
            if d.severity == Severity.ERROR:
                err_console.print(f"[red]{d}[/red]")
        raise typer.Exit(1)

    records = result.records

    # Convert to output format
    mode_map = {
        "single": OutputMode.SINGLE,
        "multi": OutputMode.MULTI,
        "compact": OutputMode.COMPACT,
        "paired": OutputMode.PAIRED,
    }

    if to not in mode_map:
        err_console.print(f"[red]Unknown format: {to}. Use: single, multi, compact, paired[/red]")
        raise typer.Exit(1)

    mode = mode_map[to]

    if mode == OutputMode.PAIRED:
        # Paired mode: create output directory with label files
        output_path.mkdir(parents=True, exist_ok=True)
        from .writer import write_paired_files
        for i, record in enumerate(records):
            # Determine filename from URI or source or index
            if record.source:
                basename = Path(str(record.source)).stem
            elif record.uri:
                basename = record.uri.split("/")[-1].split(":")[-1]
            else:
                basename = f"record_{i:04d}"

            label_path = output_path / f"{basename}.label.txt"
            write_paired_files(label_path, None, record)

        console.print(f"[green]Wrote {len(records)} label files to {output_path}[/green]")

    elif mode == OutputMode.SINGLE:
        if len(records) != 1:
            err_console.print(f"[red]Single mode requires exactly 1 record, got {len(records)}[/red]")
            raise typer.Exit(1)
        write_file(output_path, records, mode=mode)
        console.print(f"[green]Wrote {output_path}[/green]")

    else:
        write_file(output_path, records, mode=mode)
        console.print(f"[green]Wrote {len(records)} records to {output_path}[/green]")


# Workflow subcommand group
workflow_app = typer.Typer(
    name="workflow",
    help="Editor/Operator LLM workflow commands",
)
app.add_typer(workflow_app, name="workflow")


@workflow_app.command("run")
def workflow_run(
    dataset: Annotated[
        Path,
        typer.Argument(help="Path to MarkBack dataset file or directory"),
    ],
    prompt: Annotated[
        str,
        typer.Option("--prompt", "-p", help="Initial prompt (or path to prompt file)"),
    ] = "",
    output: Annotated[
        Path,
        typer.Option("--output", "-o", help="Output file for results"),
    ] = Path("workflow_result.json"),
    env_file: Annotated[
        Optional[Path],
        typer.Option("--env", "-e", help="Path to .env file"),
    ] = None,
):
    """Run the editor/operator workflow on a dataset."""
    from .workflow import run_workflow, save_workflow_result

    # Load config
    config = load_config(env_file)

    # Validate config
    issues = validate_config(config)
    if issues:
        for issue in issues:
            err_console.print(f"[yellow]Config warning: {issue}[/yellow]")

    if config.editor is None or config.operator is None:
        err_console.print("[red]Editor and Operator LLMs must be configured in .env[/red]")
        raise typer.Exit(1)

    # Load initial prompt
    initial_prompt = prompt
    if prompt and Path(prompt).exists():
        initial_prompt = Path(prompt).read_text(encoding="utf-8")

    # Load dataset
    if dataset.is_dir():
        from .parser import parse_directory
        result = parse_directory(dataset)
    else:
        result = parse_file(dataset)

    if result.has_errors:
        err_console.print("[red]Dataset has errors:[/red]")
        for d in result.diagnostics:
            if d.severity == Severity.ERROR:
                err_console.print(f"[red]{d}[/red]")
        raise typer.Exit(1)

    if not result.records:
        err_console.print("[red]No records found in dataset[/red]")
        raise typer.Exit(1)

    console.print(f"Loaded {len(result.records)} records from {dataset}")
    console.print("Running workflow...")

    try:
        workflow_result = run_workflow(config, initial_prompt, result.records)

        # Save result
        output_file = save_workflow_result(workflow_result, output, config)
        console.print(f"[green]Results saved to {output_file}[/green]")

        # Print summary
        console.print("\n[bold]Workflow Results:[/bold]")
        console.print(f"Refined prompt length: {len(workflow_result.refined_prompt)} chars")
        console.print(f"Outputs generated: {len(workflow_result.outputs)}")

        eval_result = workflow_result.evaluation
        console.print(f"\n[bold]Evaluation:[/bold]")
        console.print(f"Total: {eval_result['total']}")
        console.print(f"Correct: {eval_result['correct']}")
        console.print(f"Incorrect: {eval_result['incorrect']}")
        console.print(f"Accuracy: {eval_result['accuracy']:.1%}")

    except Exception as e:
        err_console.print(f"[red]Workflow error: {e}[/red]")
        raise typer.Exit(1)


@workflow_app.command("evaluate")
def workflow_evaluate(
    results_file: Annotated[
        Path,
        typer.Argument(help="Path to workflow results JSON"),
    ],
    output_json: Annotated[
        bool,
        typer.Option("--json", "-j", help="Output as JSON"),
    ] = False,
):
    """Show evaluation details from a workflow run."""
    if not results_file.exists():
        err_console.print(f"[red]File not found: {results_file}[/red]")
        raise typer.Exit(1)

    data = json.loads(results_file.read_text(encoding="utf-8"))
    evaluation = data.get("evaluation", {})

    if output_json:
        console.print(json.dumps(evaluation, indent=2))
    else:
        console.print("[bold]Evaluation Summary:[/bold]")
        console.print(f"Total: {evaluation.get('total', 0)}")
        console.print(f"Correct: {evaluation.get('correct', 0)}")
        console.print(f"Incorrect: {evaluation.get('incorrect', 0)}")
        console.print(f"Accuracy: {evaluation.get('accuracy', 0):.1%}")

        details = evaluation.get("details", [])
        if details:
            console.print("\n[bold]Details:[/bold]")
            for d in details:
                status = "[green]PASS[/green]" if d.get("match") else "[red]FAIL[/red]"
                uri = d.get("uri") or f"record {d.get('record_idx')}"
                console.print(f"  {status} {uri}: expected={d.get('expected_label')}")


@workflow_app.command("prompt")
def workflow_prompt(
    results_file: Annotated[
        Path,
        typer.Argument(help="Path to workflow results JSON"),
    ],
    output: Annotated[
        Optional[Path],
        typer.Option("--output", "-o", help="Save prompt to file"),
    ] = None,
):
    """Extract the refined prompt from a workflow run."""
    if not results_file.exists():
        err_console.print(f"[red]File not found: {results_file}[/red]")
        raise typer.Exit(1)

    data = json.loads(results_file.read_text(encoding="utf-8"))
    prompt = data.get("refined_prompt", "")

    if output:
        output.write_text(prompt, encoding="utf-8")
        console.print(f"[green]Saved prompt to {output}[/green]")
    else:
        console.print(prompt)


def main():
    """Entry point for the CLI."""
    app()


if __name__ == "__main__":
    main()
