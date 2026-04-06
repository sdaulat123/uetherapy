"""Velocity summary metrics."""

from __future__ import annotations

from typing import Sequence

import numpy as np


def summarize_velocity(values: Sequence[float]) -> dict:
    """Return average and peak absolute velocity."""

    if not values:
        return {"avg_velocity": 0.0, "peak_velocity": 0.0}
    array = np.abs(np.asarray(values, dtype=float))
    return {"avg_velocity": float(array.mean()), "peak_velocity": float(array.max())}
