"""Repetition counting and rep-level aggregation."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

import numpy as np


@dataclass
class RepSample:
    """Per-frame signal recorded within a repetition."""

    timestamp_s: float
    primary_value: float
    velocity: float


@dataclass
class CompletedRep:
    """Aggregated metrics for a completed repetition."""

    duration_s: float
    max_value: float
    min_value: float
    rom: float
    avg_velocity: float


@dataclass
class RepCounter:
    """Collect repetition samples and completed rep summaries."""

    rep_count: int = 0
    current_samples: List[RepSample] = field(default_factory=list)
    completed_reps: List[CompletedRep] = field(default_factory=list)

    def add_sample(self, timestamp_s: float, primary_value: float, velocity: float) -> None:
        """Append a per-frame sample for the current active rep."""

        self.current_samples.append(
            RepSample(timestamp_s=timestamp_s, primary_value=primary_value, velocity=velocity)
        )

    def close_rep(self) -> None:
        """Finalize current repetition metrics if enough data exists."""

        if len(self.current_samples) < 2:
            self.current_samples.clear()
            return

        values = np.array([sample.primary_value for sample in self.current_samples], dtype=float)
        velocities = np.array([abs(sample.velocity) for sample in self.current_samples], dtype=float)
        duration_s = self.current_samples[-1].timestamp_s - self.current_samples[0].timestamp_s
        self.rep_count += 1
        self.completed_reps.append(
            CompletedRep(
                duration_s=float(max(duration_s, 0.0)),
                max_value=float(values.max()),
                min_value=float(values.min()),
                rom=float(values.max() - values.min()),
                avg_velocity=float(velocities.mean()) if len(velocities) else 0.0,
            )
        )
        self.current_samples.clear()
