"""Landmark smoothing primitives."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict

import numpy as np

from config import SmoothingConfig


@dataclass
class LandmarkSmoother:
    """Exponential moving average smoother keyed by landmark label."""

    config: SmoothingConfig
    _state: Dict[str, np.ndarray] = field(default_factory=dict)

    def smooth(self, key: str, point: np.ndarray) -> np.ndarray:
        """Smooth a single landmark point."""

        if not self.config.enabled:
            return point

        previous = self._state.get(key)
        if previous is None:
            self._state[key] = point.astype(np.float64)
            return point

        smoothed = (
            self.config.ema_alpha * point.astype(np.float64)
            + (1.0 - self.config.ema_alpha) * previous
        )
        self._state[key] = smoothed
        return smoothed.astype(np.float32)

    def reset(self) -> None:
        """Clear smoothing history."""

        self._state.clear()
