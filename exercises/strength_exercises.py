"""Strength-oriented hand exercise scaffolds."""

from __future__ import annotations

import numpy as np

from exercises.base_exercise import BaseExercise, BiomechanicalFrame, ExerciseFrameResult
from vision.mediapipe_tracker import TrackingObservation


class GripStrengthExercise(BaseExercise):
    """Grip exercise using aggregate finger curl and hold duration."""

    name = "grip_strength"

    def _process_frame(self, frame: BiomechanicalFrame, observation: TrackingObservation) -> ExerciseFrameResult:
        primary_value = float(
            np.mean([frame.finger_angles[finger]["pip"] for finger in ("index", "middle", "ring", "pinky")])
        )
        state, velocity, _ = self._common_state_update(primary_value, frame.timestamp_s)
        closure = min(primary_value / 90.0, 1.0)
        return ExerciseFrameResult(
            exercise_name=self.name,
            state=state,
            rep_count=self.rep_counter.rep_count,
            primary_metric=primary_value,
            display_metrics={
                "closure_completeness": round(closure, 2),
                "velocity_deg_s": round(velocity, 1),
            },
            warnings=[],
        )


class TipPinchExercise(BaseExercise):
    """Tip pinch scaffold using thumb-index precision and hold stability."""

    name = "tip_pinch"

    def _process_frame(self, frame: BiomechanicalFrame, observation: TrackingObservation) -> ExerciseFrameResult:
        primary_value = frame.thumb_distances["index"]
        state, velocity, _ = self._common_state_update(primary_value, frame.timestamp_s)
        hold_window = self.measure_history[-20:] + [primary_value]
        hold_stability = float(np.std(hold_window)) if hold_window else 0.0
        return ExerciseFrameResult(
            exercise_name=self.name,
            state=state,
            rep_count=self.rep_counter.rep_count,
            primary_metric=primary_value,
            display_metrics={
                "pinch_distance_px": round(primary_value, 1),
                "hold_stability": round(hold_stability, 2),
                "velocity_px_s": round(velocity, 1),
            },
            warnings=[],
        )


class RubberBandExtensionExercise(BaseExercise):
    """Finger extension scaffold for resistance band work."""

    name = "rubber_band_extension"

    def _process_frame(self, frame: BiomechanicalFrame, observation: TrackingObservation) -> ExerciseFrameResult:
        primary_value = frame.finger_spread_px
        state, velocity, _ = self._common_state_update(primary_value, frame.timestamp_s)
        controlled_return = max(0.0, 1.0 - abs(velocity) / 250.0)
        return ExerciseFrameResult(
            exercise_name=self.name,
            state=state,
            rep_count=self.rep_counter.rep_count,
            primary_metric=primary_value,
            display_metrics={
                "max_extension_px": round(primary_value, 1),
                "controlled_return": round(controlled_return, 2),
                "velocity_px_s": round(velocity, 1),
            },
            warnings=[],
        )
