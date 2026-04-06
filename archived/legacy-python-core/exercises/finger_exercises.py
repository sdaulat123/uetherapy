"""Finger and hand range-of-motion exercises."""

from __future__ import annotations

from typing import Dict, List

import numpy as np

from config import ExerciseThresholds, StateMachineConfig
from exercises.base_exercise import BaseExercise, BiomechanicalFrame, ExerciseFrameResult
from vision.mediapipe_tracker import TrackingObservation


class TendonGlidingExercise(BaseExercise):
    """Tendon gliding sequence detector: open -> hook -> flat -> fist."""

    name = "tendon_gliding"
    expected_sequence = ["open", "hook", "flat", "fist"]

    def __init__(self, thresholds: ExerciseThresholds, state_config: StateMachineConfig | None = None) -> None:
        super().__init__(thresholds=thresholds, state_config=state_config)
        self.sequence_progress: List[str] = []
        self.last_transition_time_s: float | None = None
        self.transition_durations: List[float] = []

    def _classify_pose(self, frame: BiomechanicalFrame) -> str:
        index = frame.finger_angles["index"]
        middle = frame.finger_angles["middle"]
        pip_mean = np.mean([frame.finger_angles[f]["pip"] for f in ("index", "middle", "ring", "pinky")])
        dip_mean = np.mean([frame.finger_angles[f]["dip"] for f in ("index", "middle", "ring", "pinky")])
        mcp_mean = np.mean([frame.finger_angles[f]["mcp"] for f in ("index", "middle", "ring", "pinky")])

        if pip_mean < 35 and dip_mean < 30 and mcp_mean < 30:
            return "open"
        if pip_mean > self.thresholds.tendon_pip_hook_deg and dip_mean > self.thresholds.tendon_dip_hook_deg and mcp_mean < self.thresholds.tendon_mcp_flexed_deg:
            return "hook"
        if mcp_mean > self.thresholds.tendon_mcp_flexed_deg and pip_mean < 45:
            return "flat"
        if mcp_mean > self.thresholds.tendon_fist_deg and pip_mean > self.thresholds.tendon_fist_deg and dip_mean > 45:
            return "fist"
        _ = index, middle
        return "transition"

    def _process_frame(
        self,
        frame: BiomechanicalFrame,
        observation: TrackingObservation,
    ) -> ExerciseFrameResult:
        pose_state = self._classify_pose(frame)
        if not self.sequence_progress or pose_state != self.sequence_progress[-1]:
            if pose_state in self.expected_sequence:
                expected = self.expected_sequence[len(self.sequence_progress) % len(self.expected_sequence)]
                if pose_state == expected:
                    if self.last_transition_time_s is not None:
                        self.transition_durations.append(frame.timestamp_s - self.last_transition_time_s)
                    self.last_transition_time_s = frame.timestamp_s
                    self.sequence_progress.append(pose_state)
                    if len(self.sequence_progress) == len(self.expected_sequence):
                        self.rep_counter.rep_count += 1
                        self.sequence_progress.clear()
        mcp_values = [frame.finger_angles[f]["mcp"] for f in ("index", "middle", "ring", "pinky")]
        primary_value = float(np.mean(mcp_values))
        state, velocity, _ = self._common_state_update(primary_value, frame.timestamp_s)
        accuracy = min(len(self.sequence_progress) / len(self.expected_sequence), 1.0)
        return ExerciseFrameResult(
            exercise_name=self.name,
            state=state if pose_state == "transition" else pose_state.upper(),
            rep_count=self.rep_counter.rep_count,
            primary_metric=primary_value,
            display_metrics={
                "sequence_accuracy": round(accuracy, 2),
                "transition_time_s": round(np.mean(self.transition_durations), 2) if self.transition_durations else 0.0,
                "mean_mcp_deg": round(primary_value, 1),
                "velocity_deg_s": round(velocity, 1),
            },
            warnings=[],
        )


class PIPBlockingExercise(BaseExercise):
    """PIP blocking exercise with joint isolation scoring."""

    name = "pip_blocking"

    def _process_frame(
        self,
        frame: BiomechanicalFrame,
        observation: TrackingObservation,
    ) -> ExerciseFrameResult:
        finger = frame.finger_angles["index"]
        primary_value = finger["pip"]
        state, velocity, _ = self._common_state_update(primary_value, frame.timestamp_s)
        warnings = self.form_checker.check_joint_isolation(
            {"mcp": finger["mcp"], "dip": finger["dip"]},
            exempt_joint="pip",
        )
        self.warning_history.extend(warnings)
        isolation_score = max(
            0.0,
            1.0 - (abs(finger["mcp"]) + abs(finger["dip"])) / max(primary_value + 1e-6, 1.0),
        )
        return ExerciseFrameResult(
            exercise_name=self.name,
            state=state,
            rep_count=self.rep_counter.rep_count,
            primary_metric=primary_value,
            display_metrics={
                "pip_angle_deg": round(primary_value, 1),
                "isolation_score": round(isolation_score, 2),
                "velocity_deg_s": round(velocity, 1),
            },
            warnings=warnings,
        )


class DIPBlockingExercise(BaseExercise):
    """DIP blocking exercise scaffold."""

    name = "dip_blocking"

    def _process_frame(
        self,
        frame: BiomechanicalFrame,
        observation: TrackingObservation,
    ) -> ExerciseFrameResult:
        finger = frame.finger_angles["index"]
        primary_value = finger["dip"]
        state, velocity, _ = self._common_state_update(primary_value, frame.timestamp_s)
        warnings = self.form_checker.check_joint_isolation(
            {"mcp": finger["mcp"], "pip": finger["pip"]},
            exempt_joint="dip",
        )
        self.warning_history.extend(warnings)
        return ExerciseFrameResult(
            exercise_name=self.name,
            state=state,
            rep_count=self.rep_counter.rep_count,
            primary_metric=primary_value,
            display_metrics={
                "dip_angle_deg": round(primary_value, 1),
                "velocity_deg_s": round(velocity, 1),
            },
            warnings=warnings,
        )


class FingerSpreadingExercise(BaseExercise):
    """Finger spreading exercise scaffold with spread symmetry metric."""

    name = "finger_spreading"

    def _process_frame(
        self,
        frame: BiomechanicalFrame,
        observation: TrackingObservation,
    ) -> ExerciseFrameResult:
        primary_value = frame.finger_spread_px
        state, velocity, _ = self._common_state_update(primary_value, frame.timestamp_s)
        outer_span = np.linalg.norm(
            observation.hand_landmarks["thumb_tip"][:2] - observation.hand_landmarks["pinky_tip"][:2]
        )
        inner_span = np.linalg.norm(
            observation.hand_landmarks["index_tip"][:2] - observation.hand_landmarks["ring_tip"][:2]
        )
        symmetry = float(min(inner_span / max(outer_span, 1e-6), 1.0))
        return ExerciseFrameResult(
            exercise_name=self.name,
            state=state,
            rep_count=self.rep_counter.rep_count,
            primary_metric=primary_value,
            display_metrics={
                "spread_px": round(primary_value, 1),
                "symmetry": round(symmetry, 2),
                "velocity_px_s": round(velocity, 1),
            },
            warnings=[],
        )


class CompositeFingerFlexionExercise(BaseExercise):
    """Composite finger flexion exercise scaffold."""

    name = "composite_finger_flexion"

    def _process_frame(
        self,
        frame: BiomechanicalFrame,
        observation: TrackingObservation,
    ) -> ExerciseFrameResult:
        primary_value = float(
            sum(
                frame.finger_angles[finger][joint]
                for finger in ("index", "middle", "ring", "pinky")
                for joint in ("mcp", "pip", "dip")
            )
        )
        state, velocity, _ = self._common_state_update(primary_value, frame.timestamp_s)
        return ExerciseFrameResult(
            exercise_name=self.name,
            state=state,
            rep_count=self.rep_counter.rep_count,
            primary_metric=primary_value,
            display_metrics={
                "total_flexion_deg": round(primary_value, 1),
                "velocity_deg_s": round(velocity, 1),
            },
            warnings=[],
        )
