"""Distance-based measurements for hand motion analysis."""

from __future__ import annotations

from itertools import combinations
from typing import Dict, Iterable, List

import numpy as np


def distance(a: np.ndarray, b: np.ndarray) -> float:
    """Return Euclidean distance between two points."""

    return float(np.linalg.norm(a - b))


def mean_pairwise_distance(points: Iterable[np.ndarray]) -> float:
    """Return the mean pairwise distance for a collection of points."""

    point_list: List[np.ndarray] = list(points)
    if len(point_list) < 2:
        return 0.0
    values = [distance(a, b) for a, b in combinations(point_list, 2)]
    return float(np.mean(values)) if values else 0.0


def thumb_to_fingertip_distances(landmarks: Dict[str, np.ndarray]) -> Dict[str, float]:
    """Return thumb tip distance to each fingertip."""

    thumb_tip = landmarks["thumb_tip"]
    return {
        "index": distance(thumb_tip, landmarks["index_tip"]),
        "middle": distance(thumb_tip, landmarks["middle_tip"]),
        "ring": distance(thumb_tip, landmarks["ring_tip"]),
        "pinky": distance(thumb_tip, landmarks["pinky_tip"]),
    }


def finger_spread(landmarks: Dict[str, np.ndarray]) -> float:
    """Measure average fingertip spread distance."""

    fingertips = [
        landmarks["thumb_tip"],
        landmarks["index_tip"],
        landmarks["middle_tip"],
        landmarks["ring_tip"],
        landmarks["pinky_tip"],
    ]
    return mean_pairwise_distance(fingertips)
