"""Form validation helpers for compensatory movement detection."""

from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np

from config import ExerciseThresholds


class FormChecker:
    """Exercise-agnostic form checks driven by configurable thresholds."""

    def __init__(self, thresholds: ExerciseThresholds) -> None:
        self.thresholds = thresholds
        self._baseline_elbow: Optional[np.ndarray] = None

    def reset(self) -> None:
        """Reset baseline state."""

        self._baseline_elbow = None

    def check_elbow_stability(self, elbow_landmark: Optional[np.ndarray]) -> List[str]:
        """Detect excessive elbow motion during wrist exercises."""

        if elbow_landmark is None:
            return []
        if self._baseline_elbow is None:
            self._baseline_elbow = elbow_landmark.copy()
            return []
        delta = np.linalg.norm(elbow_landmark[:2] - self._baseline_elbow[:2])
        if delta > self.thresholds.elbow_motion_px:
            return ["Excess elbow movement"]
        return []

    def check_joint_isolation(
        self,
        tracked_angles: Dict[str, float],
        exempt_joint: str,
    ) -> List[str]:
        """Detect unwanted motion in non-target joints."""

        warnings = []
        for joint_name, angle in tracked_angles.items():
            if joint_name == exempt_joint:
                continue
            if angle > self.thresholds.blocking_joint_max_deg:
                warnings.append("Compensatory finger motion")
                break
        return warnings
