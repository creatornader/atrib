#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Inspect scorer proof for the atrib evidence-packet fixture."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from inspect_ai import Task
from inspect_ai import eval as inspect_eval
from inspect_ai.dataset import Sample
from inspect_ai.model import ModelOutput
from inspect_ai.scorer import Score, Target, accuracy, scorer
from inspect_ai.solver import Generate, TaskState, solver

REPO_ROOT = Path(__file__).resolve().parents[4]


def run_atrib_fixture() -> dict[str, Any]:
    completed = subprocess.run(
        ["pnpm", "--silent", "--filter", "@atrib/integration", "evidence-packet-eval"],
        cwd=REPO_ROOT,
        capture_output=True,
        check=False,
        text=True,
    )
    if completed.returncode != 0:
        sys.stderr.write(completed.stderr)
        raise SystemExit(completed.returncode)
    return json.loads(completed.stdout)


@solver
def receipt_completion_solver():
    async def solve(state: TaskState, generate: Generate) -> TaskState:
        arm = state.metadata["arm"]
        state.output = ModelOutput(completion=f"completion evidence checked: {arm['arm']}")
        return state

    return solve


@scorer(metrics=[accuracy()])
def completion_evidence_scorer():
    async def score(state: TaskState, target: Target) -> Score:
        arm = state.metadata["arm"]
        expected = target.text
        accepted = arm["accepted_record_hashes"]
        rejected_reasons = {
            reason for claim in arm["rejected"] for reason in claim["reasons"]
        }

        if expected == "accept":
            followup = arm.get("followup") or {}
            ok = (
                arm["passed"]
                and len(accepted) == 1
                and followup.get("signature_ok") is True
                and followup.get("informed_by_resolved") == accepted
                and followup.get("informed_by_dangling") == []
            )
            explanation = "current packet accepted and Agent B follow-up links to it"
        else:
            expected_reasons = set(arm["expected_rejection_reasons"])
            ok = (
                arm["passed"]
                and accepted == []
                and expected_reasons.issubset(rejected_reasons)
            )
            explanation = "control packet rejected for the expected verifier reason"

        return Score(
            value=ok,
            answer=expected,
            explanation=explanation,
            metadata={
                "arm": arm["arm"],
                "expected": expected,
                "accepted_record_hashes": accepted,
                "rejected_reasons": sorted(rejected_reasons),
                "followup_record_hash": (arm.get("followup") or {}).get("record_hash"),
            },
        )

    return score


def build_task(fixture: dict[str, Any]) -> Task:
    samples = [
        Sample(
            id=arm["arm"],
            input=(
                "Decide whether the receiver has enough signed completion evidence "
                f"for arm {arm['arm']}."
            ),
            target=arm["expected"],
            metadata={"arm": arm},
        )
        for arm in fixture["arms"]
    ]
    return Task(
        dataset=samples,
        solver=receipt_completion_solver(),
        scorer=completion_evidence_scorer(),
        name="atrib_evidence_packet_completion",
        metadata={
            "strategy": fixture["strategy"],
            "max_age_ms": fixture["max_age_ms"],
        },
    )


def metric_value(log: Any) -> float:
    score = log.results.scores[0]
    return float(score.metrics["accuracy"].value)


def main() -> int:
    fixture = run_atrib_fixture()
    with tempfile.TemporaryDirectory(prefix="atrib-inspect-eval-") as log_dir:
        logs = inspect_eval(
            build_task(fixture),
            model="mockllm/model",
            display="none",
            log_dir=log_dir,
        )

    log = logs[0]
    accuracy_value = metric_value(log)
    passed = (
        log.status == "success"
        and accuracy_value == 1.0
        and fixture["summary"]["passed_arms"] == fixture["summary"]["total_arms"]
    )
    output = {
        "strategy": "atrib-inspect-completion-evidence-v1",
        "inspect_task": "atrib_evidence_packet_completion",
        "inspect_status": log.status,
        "inspect_accuracy": accuracy_value,
        "fixture_strategy": fixture["strategy"],
        "fixture_summary": fixture["summary"],
        "sample_count": len(fixture["arms"]),
        "passed": passed,
        "accepted_followup": next(
            arm.get("followup")
            for arm in fixture["arms"]
            if arm["arm"] == "packet_on"
        ),
    }
    print(json.dumps(output, indent=2, sort_keys=True))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
