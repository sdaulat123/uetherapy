"""Range-of-motion metrics."""

from __future__ import annotations

from typing import Sequence

import numpy as np


def compute_rom(values: Sequence[float]) -> dict:
    """Return minimum, maximum, and ROM for a signal."""

    if not values:
        return {"min": 0.0, "max": 0.0, "rom": 0.0}
    array = np.asarray(values, dtype=float)
    minimum = float(array.min())
    maximum = float(array.max())
    return {"min": minimum, "max": maximum, "rom": maximum - minimum}
