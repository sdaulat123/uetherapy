"""Kinematic derivations for wrist and forearm motion."""

from __future__ import annotations

from typing import Dict, Optional

import numpy as np

from biomechanics.angle_utils import angle_between_points


def wrist_angle(
    landmarks: Dict[str, np.ndarray],
    elbow_proxy: Optional[np.ndarray],
) -> float:
    """Compute wrist angle using elbow proxy, wrist, and middle MCP."""

    if elbow_proxy is None:
        forearm_axis = landmarks["wrist"] + np.array([0.0, -100.0, 0.0], dtype=np.float32)
        elbow_proxy = forearm_axis
    return angle_between_points(elbow_proxy, landmarks["wrist"], landmarks["middle_mcp"])


def palm_normal(landmarks: Dict[str, np.ndarray]) -> np.ndarray:
    """Compute an approximate palm normal vector."""

    wrist = landmarks["wrist"]
    index_base = landmarks["index_mcp"] - wrist
    pinky_base = landmarks["pinky_mcp"] - wrist
    normal = np.cross(index_base, pinky_base)
    magnitude = np.linalg.norm(normal)
    if magnitude == 0:
        return np.zeros(3, dtype=np.float32)
    return (normal / magnitude).astype(np.float32)


def pronation_supination_angle(landmarks: Dict[str, np.ndarray]) -> float:
    """Estimate pronation/supination angle from palm normal orientation."""

    normal = palm_normal(landmarks)
    projected = normal[[0, 2]]
    magnitude = np.linalg.norm(projected)
    if magnitude == 0:
        return 0.0
    projected = projected / magnitude
    return float(np.degrees(np.arctan2(projected[0], projected[1])))


def radial_ulnar_deviation(
    landmarks: Dict[str, np.ndarray],
    elbow_proxy: Optional[np.ndarray],
) -> float:
    """Measure lateral hand displacement relative to the forearm axis."""

    wrist = landmarks["wrist"]
    middle_mcp = landmarks["middle_mcp"]
    if elbow_proxy is None:
        elbow_proxy = wrist + np.array([0.0, -100.0, 0.0], dtype=np.float32)
    forearm = wrist - elbow_proxy
    hand = middle_mcp - wrist
    denominator = np.linalg.norm(forearm[:2]) * np.linalg.norm(hand[:2])
    if denominator == 0:
        return 0.0
    sine = np.cross(forearm[:2], hand[:2]) / denominator
    return float(np.degrees(np.arcsin(np.clip(sine, -1.0, 1.0))))


def derivative(current: float, previous: float, dt: float) -> float:
    """Return numerical derivative with divide-by-zero protection."""

    if dt <= 0:
        return 0.0
    return float((current - previous) / dt)
