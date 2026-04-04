"""Thumb exercise implementations."""

from __future__ import annotations

import numpy as np

from config import ExerciseThresholds, StateMachineConfig
from exercises.base_exercise import BaseExercise, BiomechanicalFrame, ExerciseFrameResult
from vision.mediapipe_tracker import TrackingObservation


class ThumbOppositionExercise(BaseExercise):
    """Fully implemented thumb opposition exercise with success/precision tracking."""

    name = "thumb_opposition"

    def __init__(self, thresholds: ExerciseThresholds, state_config: StateMachineConfig) -> None:
        super().__init__(thresholds=thresholds, state_config=state_config, invert_metric=True)
        self.successful_contacts = 0

    def _process_frame(
        self,
        frame: BiomechanicalFrame,
        observation: TrackingObservation,
    ) -> ExerciseFrameResult:
        target_finger, primary_value = min(frame.thumb_distances.items(), key=lambda item: item[1])
        state, velocity, rep_completed = self._common_state_update(primary_value, frame.timestamp_s)
        precision = max(
            0.0,
            1.0 - primary_value / max(self.thresholds.contact_distance_px * 2.0, 1.0),
        )
        if rep_completed and primary_value <= self.thresholds.contact_distance_px:
            self.successful_contacts += 1

        success_rate = (
            self.successful_contacts / self.rep_counter.rep_count if self.rep_counter.rep_count else 0.0
        )
        return ExerciseFrameResult(
            exercise_name=self.name,
            state=state,
            rep_count=self.rep_counter.rep_count,
            primary_metric=primary_value,
            display_metrics={
                "thumb_distance_px": round(primary_value, 1),
                "target_finger": target_finger,
                "precision": round(precision, 2),
                "success_rate": round(success_rate, 2),
                "velocity_px_s": round(velocity, 1),
            },
            warnings=[],
            events={"target_finger": target_finger},
        )

    def build_session_summary(self) -> dict:
        """Extend base session summary with thumb opposition-specific metrics."""

        summary = super().build_session_summary()
        summary["success_rate"] = (
            self.successful_contacts / self.rep_counter.rep_count if self.rep_counter.rep_count else 0.0
        )
        summary["precision_threshold_px"] = self.thresholds.contact_distance_px
        return summary


class ThumbAbductionExercise(BaseExercise):
    """Thumb abduction exercise scaffold."""

    name = "thumb_abduction"

    def _process_frame(
        self,
        frame: BiomechanicalFrame,
        observation: TrackingObservation,
    ) -> ExerciseFrameResult:
        thumb_tip = observation.hand_landmarks["thumb_tip"][:2]
        index_mcp = observation.hand_landmarks["index_mcp"][:2]
        wrist = observation.hand_landmarks["wrist"][:2]
        primary_value = float(np.linalg.norm(thumb_tip - (wrist + index_mcp) / 2.0))
        state, velocity, _ = self._common_state_update(primary_value, frame.timestamp_s)
        return ExerciseFrameResult(
            exercise_name=self.name,
            state=state,
            rep_count=self.rep_counter.rep_count,
            primary_metric=primary_value,
            display_metrics={
                "abduction_px": round(primary_value, 1),
                "velocity_px_s": round(velocity, 1),
            },
            warnings=[],
        )
