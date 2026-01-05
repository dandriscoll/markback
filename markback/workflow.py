"""Editor/Operator workflow for prompt refinement and evaluation."""

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

from .config import Config
from .llm import LLMClient, LLMClientFactory, LLMResponse
from .types import Record, parse_feedback


@dataclass
class WorkflowResult:
    """Result of a workflow run."""
    refined_prompt: str
    outputs: list[dict]  # {record_idx, output, ...}
    evaluation: dict
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())


@dataclass
class EvaluationResult:
    """Result of evaluating operator outputs against expected feedback."""
    total: int
    correct: int
    incorrect: int
    accuracy: float
    details: list[dict]  # Per-record evaluation details


# Default prompts
EDITOR_SYSTEM_PROMPT = """You are a prompt engineer. Your task is to refine and improve prompts based on examples and feedback.

Given:
1. An initial prompt (may be empty)
2. A set of examples with their expected outputs/labels
3. Feedback on what works and what doesn't

Produce an improved prompt that will help an LLM generate better outputs for similar examples.

Output ONLY the refined prompt, no explanations."""

EDITOR_USER_TEMPLATE = """Initial prompt:
{initial_prompt}

Examples and feedback:
{examples}

Based on this feedback, produce an improved prompt that addresses the issues noted."""

OPERATOR_SYSTEM_PROMPT = """Follow the instructions in the prompt exactly. Respond with the output only."""


def format_examples_for_editor(records: list[Record]) -> str:
    """Format records as examples for the editor prompt."""
    parts = []

    for i, record in enumerate(records):
        parts.append(f"--- Example {i + 1} ---")

        if record.content:
            parts.append(f"Input: {record.content[:500]}{'...' if len(record.content) > 500 else ''}")
        elif record.source:
            parts.append(f"Input: [from {record.source}]")

        # Parse feedback for structured info
        parsed = parse_feedback(record.feedback)

        if parsed.label:
            parts.append(f"Label: {parsed.label}")
        if parsed.comment:
            parts.append(f"Feedback: {parsed.comment}")
        if parsed.attributes:
            parts.append(f"Attributes: {parsed.attributes}")

        parts.append(f"Raw feedback: {record.feedback}")
        parts.append("")

    return "\n".join(parts)


def run_editor(
    client: LLMClient,
    initial_prompt: str,
    records: list[Record],
    system_prompt: Optional[str] = None,
) -> str:
    """Run the editor LLM to refine a prompt.

    Args:
        client: LLM client to use
        initial_prompt: The starting prompt (may be empty)
        records: Training records with content and feedback
        system_prompt: Optional custom system prompt

    Returns:
        Refined prompt string
    """
    examples = format_examples_for_editor(records)

    user_prompt = EDITOR_USER_TEMPLATE.format(
        initial_prompt=initial_prompt or "(No initial prompt provided)",
        examples=examples,
    )

    response = client.complete(
        prompt=user_prompt,
        system=system_prompt or EDITOR_SYSTEM_PROMPT,
    )

    return response.content.strip()


def run_operator(
    client: LLMClient,
    prompt: str,
    input_content: str,
    system_prompt: Optional[str] = None,
) -> str:
    """Run the operator LLM with a prompt on input content.

    Args:
        client: LLM client to use
        prompt: The prompt to apply
        input_content: The input content to process
        system_prompt: Optional custom system prompt

    Returns:
        Operator output
    """
    user_prompt = f"{prompt}\n\nInput:\n{input_content}"

    response = client.complete(
        prompt=user_prompt,
        system=system_prompt or OPERATOR_SYSTEM_PROMPT,
    )

    return response.content.strip()


def run_operator_batch(
    client: LLMClient,
    prompt: str,
    records: list[Record],
    system_prompt: Optional[str] = None,
) -> list[dict]:
    """Run the operator LLM on multiple records.

    Args:
        client: LLM client to use
        prompt: The prompt to apply
        records: Records to process
        system_prompt: Optional custom system prompt

    Returns:
        List of outputs with record info
    """
    outputs = []

    for i, record in enumerate(records):
        content = record.content or ""

        if not content and record.source:
            # Try to load content from source
            try:
                source_path = record.source.resolve()
                if source_path.exists():
                    content = source_path.read_text(encoding="utf-8")
            except Exception:
                content = f"[Content from {record.source}]"

        output = run_operator(client, prompt, content, system_prompt)

        outputs.append({
            "record_idx": i,
            "uri": record.uri,
            "output": output,
            "input_preview": content[:200] if content else None,
        })

    return outputs


def evaluate_outputs(
    outputs: list[dict],
    records: list[Record],
    config: Config,
) -> EvaluationResult:
    """Evaluate operator outputs against expected feedback.

    Simple evaluation:
    - Parse feedback for label
    - Check if output "matches" the expected label semantically

    For v1, we use a simple heuristic:
    - If feedback label is positive, output should not contain negative indicators
    - If feedback label is negative, output should acknowledge issues
    """
    positive_labels = set(config.positive_labels)
    negative_labels = set(config.negative_labels)

    details = []
    correct = 0
    incorrect = 0

    for output_info in outputs:
        idx = output_info["record_idx"]
        record = records[idx]
        operator_output = output_info["output"]

        # Parse expected feedback
        parsed = parse_feedback(record.feedback)
        expected_label = parsed.label.lower() if parsed.label else None

        # Determine expected sentiment
        expected_positive = expected_label in positive_labels if expected_label else None
        expected_negative = expected_label in negative_labels if expected_label else None

        # Simple output analysis
        output_lower = operator_output.lower()

        # Check for obvious positive/negative indicators in output
        output_has_positive = any(word in output_lower for word in ["good", "correct", "yes", "approved", "success"])
        output_has_negative = any(word in output_lower for word in ["bad", "wrong", "no", "error", "fail", "issue"])

        # Determine if match
        match = None
        if expected_positive is True:
            match = output_has_positive or not output_has_negative
        elif expected_negative is True:
            match = output_has_negative or not output_has_positive
        else:
            # Unknown expected sentiment - can't evaluate
            match = None

        if match is True:
            correct += 1
        elif match is False:
            incorrect += 1

        details.append({
            "record_idx": idx,
            "uri": record.uri,
            "expected_label": expected_label,
            "expected_positive": expected_positive,
            "operator_output_preview": operator_output[:200],
            "match": match,
        })

    total = len(outputs)
    evaluated = correct + incorrect
    accuracy = correct / evaluated if evaluated > 0 else 0.0

    return EvaluationResult(
        total=total,
        correct=correct,
        incorrect=incorrect,
        accuracy=accuracy,
        details=details,
    )


def run_workflow(
    config: Config,
    initial_prompt: str,
    records: list[Record],
    editor_client: Optional[LLMClient] = None,
    operator_client: Optional[LLMClient] = None,
) -> WorkflowResult:
    """Run the full editor/operator workflow.

    1. Editor refines the prompt using examples and feedback
    2. Operator runs the refined prompt on examples
    3. Evaluate operator performance

    Args:
        config: Configuration
        initial_prompt: Starting prompt (may be empty)
        records: Training records with content and feedback
        editor_client: LLM client for editor (created from config if None)
        operator_client: LLM client for operator (created from config if None)

    Returns:
        Workflow result with refined prompt, outputs, and evaluation
    """
    # Create clients if not provided
    if editor_client is None:
        if config.editor is None:
            raise ValueError("Editor LLM not configured")
        editor_client = LLMClientFactory.create(config.editor)

    if operator_client is None:
        if config.operator is None:
            raise ValueError("Operator LLM not configured")
        operator_client = LLMClientFactory.create(config.operator)

    # Step 1: Editor refines prompt
    refined_prompt = run_editor(editor_client, initial_prompt, records)

    # Step 2: Operator processes examples with refined prompt
    outputs = run_operator_batch(operator_client, refined_prompt, records)

    # Step 3: Evaluate
    evaluation = evaluate_outputs(outputs, records, config)

    return WorkflowResult(
        refined_prompt=refined_prompt,
        outputs=outputs,
        evaluation={
            "total": evaluation.total,
            "correct": evaluation.correct,
            "incorrect": evaluation.incorrect,
            "accuracy": evaluation.accuracy,
            "details": evaluation.details,
        },
    )


def save_workflow_result(
    result: WorkflowResult,
    output_path: Path,
    config: Config,
) -> Path:
    """Save workflow result to file.

    Args:
        result: The workflow result
        output_path: Base path for output
        config: Configuration (for file mode)

    Returns:
        Path to saved file
    """
    data = {
        "timestamp": result.timestamp,
        "refined_prompt": result.refined_prompt,
        "outputs": result.outputs,
        "evaluation": result.evaluation,
    }

    if config.file_mode == "versioned":
        # Add timestamp to filename
        stem = output_path.stem
        suffix = output_path.suffix
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = output_path.with_name(f"{stem}_{ts}{suffix}")

    output_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return output_path
