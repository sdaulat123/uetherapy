"""Angle computation utilities for hand biomechanics."""

from __future__ import annotations

from typing import Dict

import numpy as np


def angle_between_points(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Return the angle ABC in degrees."""

    ba = a - b
    bc = c - b
    denominator = np.linalg.norm(ba) * np.linalg.norm(bc)
    if denominator == 0:
        return 0.0
    cosine = float(np.clip(np.dot(ba, bc) / denominator, -1.0, 1.0))
    return float(np.degrees(np.arccos(cosine)))


def compute_finger_joint_angles(landmarks: Dict[str, np.ndarray]) -> Dict[str, Dict[str, float]]:
    """Compute MCP, PIP, and DIP angles for each finger."""

    wrist = landmarks["wrist"]
    finger_map = {
        "index": ("index_mcp", "index_pip", "index_dip", "index_tip"),
        "middle": ("middle_mcp", "middle_pip", "middle_dip", "middle_tip"),
        "ring": ("ring_mcp", "ring_pip", "ring_dip", "ring_tip"),
        "pinky": ("pinky_mcp", "pinky_pip", "pinky_dip", "pinky_tip"),
    }
    output: Dict[str, Dict[str, float]] = {}
    for finger, (mcp, pip, dip, tip) in finger_map.items():
        output[finger] = {
            "mcp": angle_between_points(wrist, landmarks[mcp], landmarks[pip]),
            "pip": angle_between_points(landmarks[mcp], landmarks[pip], landmarks[dip]),
            "dip": angle_between_points(landmarks[pip], landmarks[dip], landmarks[tip]),
        }
    output["thumb"] = {
        "mcp": angle_between_points(
            landmarks["thumb_cmc"], landmarks["thumb_mcp"], landmarks["thumb_ip"]
        ),
        "ip": angle_between_points(
            landmarks["thumb_mcp"], landmarks["thumb_ip"], landmarks["thumb_tip"]
        ),
    }
    return output


def total_finger_flexion(finger_angles: Dict[str, Dict[str, float]]) -> float:
    """Return the summed flexion score across non-thumb digits."""

    total = 0.0
    for finger in ("index", "middle", "ring", "pinky"):
        total += finger_angles[finger]["mcp"]
        total += finger_angles[finger]["pip"]
        total += finger_angles[finger]["dip"]
    return total
