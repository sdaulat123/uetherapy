"""Smoothness metrics based on acceleration and jerk variability."""

from __future__ import annotations

from typing import Sequence

import numpy as np


def summarize_smoothness(velocities: Sequence[float], timestamps: Sequence[float]) -> dict:
    """Return acceleration and jerk variance metrics."""

    if len(velocities) < 3 or len(timestamps) < 3:
        return {"acceleration_variance": 0.0, "jerk_variance": 0.0, "smoothness": 0.0}

    velocity_array = np.asarray(velocities, dtype=float)
    time_array = np.asarray(timestamps, dtype=float)
    dt = np.diff(time_array)
    dt[dt <= 0] = np.nan
    acceleration = np.diff(velocity_array) / dt
    acceleration = acceleration[np.isfinite(acceleration)]
    if len(acceleration) < 2:
        return {"acceleration_variance": 0.0, "jerk_variance": 0.0, "smoothness": 0.0}
    jerk = np.diff(acceleration)
    acceleration_variance = float(np.var(acceleration))
    jerk_variance = float(np.var(jerk)) if len(jerk) else 0.0
    smoothness = jerk_variance
    return {
        "acceleration_variance": acceleration_variance,
        "jerk_variance": jerk_variance,
        "smoothness": smoothness,
    }
