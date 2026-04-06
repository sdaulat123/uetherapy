"""Wrist rehabilitation exercise implementations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional

import numpy as np

from config import ExerciseThresholds, StateMachineConfig
from exercises.base_exercise import BaseExercise, BiomechanicalFrame, ExerciseFrameResult
from vision.mediapipe_tracker import TrackingObservation


class WristFlexionExercise(BaseExercise):
    """Fully implemented wrist flexion exercise with rep counting and form checks."""

    name = "wrist_flexion"

    def __init__(self, thresholds: ExerciseThresholds, state_config: StateMachineConfig) -> None:
        super().__init__(thresholds=thresholds, state_config=state_config, invert_metric=False)

    def _process_frame(
        self,
        frame: BiomechanicalFrame,
        observation: TrackingObservation,
    ) -> ExerciseFrameResult:
        primary_value = frame.wrist_angle_deg
        state, velocity, _ = self._common_state_update(primary_value, frame.timestamp_s)
        warnings = self.form_checker.check_elbow_stability(observation.elbow_landmark)
        self.warning_history.extend(warnings)
        return ExerciseFrameResult(
            exercise_name=self.name,
            state=state,
            rep_count=self.rep_counter.rep_count,
            primary_metric=primary_value,
            display_metrics={
                "wrist_angle_deg": round(frame.wrist_angle_deg, 1),
                "velocity_deg_s": round(velocity, 1),
                "deviation_deg": round(frame.radial_ulnar_deviation_deg, 1),
            },
            warnings=warnings,
        )


class WristExtensionExercise(WristFlexionExercise):
    """Wrist extension using the same biomechanical signal but inverted thresholding."""

    name = "wrist_extension"

    def __init__(self, thresholds: ExerciseThresholds, state_config: StateMachineConfig) -> None:
        BaseExercise.__init__(self, thresholds=thresholds, state_config=state_config, invert_metric=True)


class RadialUlnarDeviationExercise(BaseExercise):
    """Track radial and ulnar deviation using forearm-hand lateral angle."""

    name = "radial_ulnar_deviation"

    def _process_frame(
        self,
        frame: BiomechanicalFrame,
        observation: TrackingObservation,
    ) -> ExerciseFrameResult:
        primary_value = frame.radial_ulnar_deviation_deg
        state, velocity, _ = self._common_state_update(abs(primary_value), frame.timestamp_s)
        warnings = self.form_checker.check_elbow_stability(observation.elbow_landmark)
        self.warning_history.extend(warnings)
        handedness_multiplier = -1.0 if observation.handedness == "Left" else 1.0
        return ExerciseFrameResult(
            exercise_name=self.name,
            state=state,
            rep_count=self.rep_counter.rep_count,
            primary_metric=primary_value,
            display_metrics={
                "deviation_deg": round(primary_value, 1),
                "asymmetry_score": round(handedness_multiplier * primary_value, 1),
                "velocity_deg_s": round(velocity, 1),
            },
            warnings=warnings,
        )


class WristCircumductionExercise(BaseExercise):
    """Track circular wrist trajectories using MCP motion around the wrist."""

    name = "wrist_circumduction"

    def __init__(self, thresholds: ExerciseThresholds, state_config: Optional[StateMachineConfig] = None) -> None:
        super().__init__(thresholds=thresholds, state_config=state_config)
        self._trajectory: list[np.ndarray] = []

    def _process_frame(
        self,
        frame: BiomechanicalFrame,
        observation: TrackingObservation,
    ) -> ExerciseFrameResult:
        wrist = observation.hand_landmarks["wrist"][:2]
        middle_mcp = observation.hand_landmarks["middle_mcp"][:2]
        rel = middle_mcp - wrist
        self._trajectory.append(rel)
        radius = float(np.linalg.norm(rel))
        state, velocity, _ = self._common_state_update(radius, frame.timestamp_s)
        completeness = 0.0
        if len(self._trajectory) >= 10:
            angles = np.unwrap(np.arctan2([p[1] for p in self._trajectory], [p[0] for p in self._trajectory]))
            completeness = float(min(abs(angles[-1] - angles[0]) / (2 * np.pi), 1.0))
        return ExerciseFrameResult(
            exercise_name=self.name,
            state=state,
            rep_count=self.rep_counter.rep_count,
            primary_metric=radius,
            display_metrics={
                "radius_px": round(radius, 1),
                "circle_completeness": round(completeness, 2),
                "velocity_px_s": round(velocity, 1),
            },
            warnings=[],
        )


class PronationSupinationExercise(BaseExercise):
    """Track palm rotation from palm normal orientation."""

    name = "pronation_supination"

    def _process_frame(
        self,
        frame: BiomechanicalFrame,
        observation: TrackingObservation,
    ) -> ExerciseFrameResult:
        primary_value = frame.pronation_supination_deg
        state, velocity, _ = self._common_state_update(abs(primary_value), frame.timestamp_s)
        warnings = self.form_checker.check_elbow_stability(observation.elbow_landmark)
        self.warning_history.extend(warnings)
        control = max(0.0, 1.0 - abs(velocity) / 180.0)
        return ExerciseFrameResult(
            exercise_name=self.name,
            state=state,
            rep_count=self.rep_counter.rep_count,
            primary_metric=primary_value,
            display_metrics={
                "rotation_deg": round(primary_value, 1),
                "control_score": round(control, 2),
                "velocity_deg_s": round(velocity, 1),
            },
            warnings=warnings,
        )


class WristFlexionStretchExercise(BaseExercise):
    """Static hold detection for wrist flexion stretch."""

    name = "wrist_flexion_stretch"

    def _process_frame(
        self,
        frame: BiomechanicalFrame,
        observation: TrackingObservation,
    ) -> ExerciseFrameResult:
        primary_value = frame.wrist_angle_deg
        state, velocity, _ = self._common_state_update(primary_value, frame.timestamp_s)
        hold_window = self.measure_history[-30:] + [primary_value]
        stability = float(np.std(hold_window)) if hold_window else 0.0
        warnings = []
        if stability > self.thresholds.static_hold_std_threshold:
            warnings.append("Stretch not stable")
        self.warning_history.extend(warnings)
        return ExerciseFrameResult(
            exercise_name=self.name,
            state=state,
            rep_count=self.rep_counter.rep_count,
            primary_metric=primary_value,
            display_metrics={
                "wrist_angle_deg": round(primary_value, 1),
                "hold_stability": round(stability, 2),
                "velocity_deg_s": round(velocity, 1),
            },
            warnings=warnings,
        )


class WristExtensionStretchExercise(WristFlexionStretchExercise):
    """Static wrist extension stretch scaffold."""

    name = "wrist_extension_stretch"


class PrayerStretchExercise(WristFlexionStretchExercise):
    """Prayer stretch scaffold."""

    name = "prayer_stretch"
