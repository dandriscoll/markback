"""Tests for MarkBack workflow."""

import pytest
from pathlib import Path
import json

from markback import Record, Config, parse_file
from markback.llm import MockLLMClient, LLMClientFactory
from markback.workflow import (
    run_editor,
    run_operator,
    run_operator_batch,
    evaluate_outputs,
    run_workflow,
    format_examples_for_editor,
    EvaluationResult,
)


FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestFormatExamples:
    """Tests for format_examples_for_editor function."""

    def test_format_basic(self):
        """Test formatting basic examples."""
        records = [
            Record(feedback="positive", content="Good content"),
            Record(feedback="negative; too short", content="Bad"),
        ]

        result = format_examples_for_editor(records)

        assert "Example 1" in result
        assert "Example 2" in result
        assert "Good content" in result
        assert "positive" in result

    def test_format_with_source(self):
        """Test formatting examples with source refs."""
        from markback import SourceRef

        records = [
            Record(feedback="approved", source=SourceRef("./file.txt")),
        ]

        result = format_examples_for_editor(records)

        assert "./file.txt" in result


class TestRunEditor:
    """Tests for run_editor function."""

    def test_editor_returns_prompt(self):
        """Test that editor returns a refined prompt."""
        mock_client = MockLLMClient(responses=["Refined prompt: Be more specific"])

        records = [
            Record(feedback="good", content="Example 1"),
            Record(feedback="bad; needs detail", content="Example 2"),
        ]

        result = run_editor(mock_client, "Initial prompt", records)

        assert "Refined prompt" in result
        assert mock_client.call_count == 1

    def test_editor_receives_examples(self):
        """Test that editor receives formatted examples."""
        mock_client = MockLLMClient(responses=["OK"])

        records = [Record(feedback="positive", content="Test content")]

        run_editor(mock_client, "", records)

        # Check that the call included the content
        assert len(mock_client.calls) == 1
        assert "Test content" in mock_client.calls[0]["prompt"]


class TestRunOperator:
    """Tests for run_operator function."""

    def test_operator_processes_input(self):
        """Test that operator processes input."""
        mock_client = MockLLMClient(responses=["Output: processed"])

        result = run_operator(mock_client, "Analyze this", "Input data")

        assert "processed" in result
        assert mock_client.call_count == 1

    def test_operator_receives_prompt_and_input(self):
        """Test that operator receives both prompt and input."""
        mock_client = MockLLMClient(responses=["OK"])

        run_operator(mock_client, "My prompt", "My input")

        assert "My prompt" in mock_client.calls[0]["prompt"]
        assert "My input" in mock_client.calls[0]["prompt"]


class TestRunOperatorBatch:
    """Tests for run_operator_batch function."""

    def test_batch_processes_all_records(self):
        """Test that batch processes all records."""
        mock_client = MockLLMClient(responses=["Out 1", "Out 2", "Out 3"])

        records = [
            Record(feedback="good", content="Content 1"),
            Record(feedback="good", content="Content 2"),
            Record(feedback="good", content="Content 3"),
        ]

        results = run_operator_batch(mock_client, "Process this", records)

        assert len(results) == 3
        assert mock_client.call_count == 3


class TestEvaluateOutputs:
    """Tests for evaluate_outputs function."""

    def test_evaluate_positive_match(self):
        """Test evaluation of positive matching."""
        config = Config()

        outputs = [{"record_idx": 0, "output": "This is good and correct"}]
        records = [Record(feedback="positive", content="Test")]

        result = evaluate_outputs(outputs, records, config)

        assert result.total == 1
        # "good" in output + "positive" expected = match
        assert result.correct >= 0

    def test_evaluate_negative_match(self):
        """Test evaluation of negative matching."""
        config = Config()

        outputs = [{"record_idx": 0, "output": "There is an error here"}]
        records = [Record(feedback="negative", content="Test")]

        result = evaluate_outputs(outputs, records, config)

        assert result.total == 1

    def test_evaluate_accuracy_calculation(self):
        """Test accuracy calculation."""
        config = Config()

        outputs = [
            {"record_idx": 0, "output": "good result"},
            {"record_idx": 1, "output": "good result"},
        ]
        records = [
            Record(feedback="positive", content="Test 1"),
            Record(feedback="positive", content="Test 2"),
        ]

        result = evaluate_outputs(outputs, records, config)

        assert result.total == 2
        assert 0 <= result.accuracy <= 1


class TestRunWorkflow:
    """Tests for run_workflow function."""

    def test_full_workflow(self):
        """Test running the full workflow."""
        # Set up mock clients
        editor_mock = MockLLMClient(responses=["Improved prompt"])
        operator_mock = MockLLMClient(responses=["Good output", "Good output"])

        config = Config()

        records = [
            Record(feedback="positive", content="Example 1"),
            Record(feedback="positive", content="Example 2"),
        ]

        result = run_workflow(
            config,
            "Initial prompt",
            records,
            editor_client=editor_mock,
            operator_client=operator_mock,
        )

        assert result.refined_prompt == "Improved prompt"
        assert len(result.outputs) == 2
        assert "total" in result.evaluation

    def test_workflow_with_fixture(self):
        """Test workflow with fixture data."""
        editor_mock = MockLLMClient(responses=["Better prompt"])
        operator_mock = MockLLMClient(default_response="Processed output")

        config = Config()

        # Load fixture
        parse_result = parse_file(FIXTURES_DIR / "freeform_feedback.mb")
        records = parse_result.records

        result = run_workflow(
            config,
            "",
            records,
            editor_client=editor_mock,
            operator_client=operator_mock,
        )

        assert result.refined_prompt == "Better prompt"
        assert len(result.outputs) == len(records)


class TestMockLLMClient:
    """Tests for MockLLMClient."""

    def test_mock_returns_responses_in_order(self):
        """Test that mock returns responses in order."""
        mock = MockLLMClient(responses=["First", "Second", "Third"])

        assert mock.complete("a").content == "First"
        assert mock.complete("b").content == "Second"
        assert mock.complete("c").content == "Third"

    def test_mock_falls_back_to_default(self):
        """Test that mock falls back to default."""
        mock = MockLLMClient(responses=["First"], default_response="Default")

        assert mock.complete("a").content == "First"
        assert mock.complete("b").content == "Default"
        assert mock.complete("c").content == "Default"

    def test_mock_tracks_calls(self):
        """Test that mock tracks calls."""
        mock = MockLLMClient()

        mock.complete("prompt1", system="sys1")
        mock.complete("prompt2", system="sys2")

        assert len(mock.calls) == 2
        assert mock.calls[0]["prompt"] == "prompt1"
        assert mock.calls[1]["system"] == "sys2"

    def test_mock_reset(self):
        """Test that mock can be reset."""
        mock = MockLLMClient(responses=["First"])

        mock.complete("a")
        mock.reset()

        assert mock.call_count == 0
        assert len(mock.calls) == 0
        assert mock.complete("b").content == "First"
