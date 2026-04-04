"""Base classes and shared data contracts for rehab exercises."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import numpy as np

from biomechanics.angle_utils import compute_finger_joint_angles
from biomechanics.distance_utils import finger_spread, thumb_to_fingertip_distances
from biomechanics.kinematics import (
    derivative,
    pronation_supination_angle,
    radial_ulnar_deviation,
    wrist_angle,
)
from config import ExerciseThresholds, StateMachineConfig
from logic.form_checker import FormChecker
from logic.rep_counter import RepCounter
from logic.state_machine import ExerciseStateMachine, MovementState
from metrics.rom import compute_rom
from metrics.smoothness import summarize_smoothness
from metrics.velocity import summarize_velocity
from vision.mediapipe_tracker import TrackingObservation


@dataclass
class BiomechanicalFrame:
    """All derived measurements for a tracked frame."""

    timestamp_s: float
    wrist_angle_deg: float
    pronation_supination_deg: float
    radial_ulnar_deviation_deg: float
    finger_angles: Dict[str, Dict[str, float]]
    thumb_distances: Dict[str, float]
    finger_spread_px: float


@dataclass
class ExerciseFrameResult:
    """Structured output for a processed exercise frame."""

    exercise_name: str
    state: str
    rep_count: int
    primary_metric: float
    display_metrics: Dict[str, Any]
    warnings: List[str] = field(default_factory=list)
    events: Dict[str, Any] = field(default_factory=dict)


class BaseExercise(ABC):
    """Base exercise contract for all rehab movements."""

    name: str = "base_exercise"

    def __init__(
        self,
        thresholds: ExerciseThresholds,
        state_config: Optional[StateMachineConfig] = None,
        invert_metric: bool = False,
    ) -> None:
        self.thresholds = thresholds
        self.state_machine = (
            ExerciseStateMachine(state_config, invert_metric=invert_metric)
            if state_config is not None
            else None
        )
        self.rep_counter = RepCounter()
        self.form_checker = FormChecker(thresholds)
        self.measure_history: List[float] = []
        self.velocity_history: List[float] = []
        self.timestamp_history: List[float] = []
        self.warning_history: List[str] = []
        self._previous_primary_value = 0.0
        self._previous_timestamp: Optional[float] = None

    def reset(self) -> None:
        """Reset exercise state between sessions."""

        self.rep_counter = RepCounter()
        self.form_checker.reset()
        self.measure_history.clear()
        self.velocity_history.clear()
        self.timestamp_history.clear()
        self.warning_history.clear()
        self._previous_primary_value = 0.0
        self._previous_timestamp = None

    def build_frame(self, observation: TrackingObservation) -> BiomechanicalFrame:
        """Derive the canonical biomechanical feature set."""

        landmarks = observation.hand_landmarks
        return BiomechanicalFrame(
            timestamp_s=observation.timestamp_s,
            wrist_angle_deg=wrist_angle(landmarks, observation.elbow_landmark),
            pronation_supination_deg=pronation_supination_angle(landmarks),
            radial_ulnar_deviation_deg=radial_ulnar_deviation(
                landmarks, observation.elbow_landmark
            ),
            finger_angles=compute_finger_joint_angles(landmarks),
            thumb_distances=thumb_to_fingertip_distances(landmarks),
            finger_spread_px=finger_spread(landmarks),
        )

    def process(self, observation: TrackingObservation) -> Optional[ExerciseFrameResult]:
        """Execute exercise-specific logic against the current observation."""

        if not observation.has_hand:
            return None

        frame = self.build_frame(observation)
        result = self._process_frame(frame, observation)
        self.measure_history.append(result.primary_metric)
        self.timestamp_history.append(frame.timestamp_s)
        return result

    def _common_state_update(
        self,
        primary_value: float,
        timestamp_s: float,
    ) -> tuple[str, float, bool]:
        """Update velocity and repetition logic for the current frame."""

        dt = 0.0 if self._previous_timestamp is None else timestamp_s - self._previous_timestamp
        velocity = derivative(primary_value, self._previous_primary_value, dt)
        self._previous_primary_value = primary_value
        self._previous_timestamp = timestamp_s
        self.velocity_history.append(velocity)

        rep_completed = False
        state = MovementState.ACTIVE.value
        if self.state_machine is not None:
            transition = self.state_machine.update(primary_value, velocity, timestamp_s)
            state = transition.state.value
            if state in (MovementState.ACTIVE.value, MovementState.HOLD.value):
                self.rep_counter.add_sample(timestamp_s, primary_value, velocity)
            if transition.rep_completed:
                self.rep_counter.close_rep()
                rep_completed = True
        return state, velocity, rep_completed

    def build_session_summary(self) -> Dict[str, Any]:
        """Generate session-level metrics and structured JSON output."""

        rom = compute_rom(self.measure_history)
        velocity = summarize_velocity(self.velocity_history)
        smoothness = summarize_smoothness(self.velocity_history, self.timestamp_history)
        consistency = 0.0
        if self.rep_counter.completed_reps:
            consistency = float(
                np.std([rep.rom for rep in self.rep_counter.completed_reps], ddof=0)
            )
        unique_warnings = sorted(set(self.warning_history))
        return {
            "exercise": self.name,
            "reps": self.rep_counter.rep_count,
            "max_angle": rom["max"],
            "min_angle": rom["min"],
            "rom": rom["rom"],
            "avg_velocity": velocity["avg_velocity"],
            "peak_velocity": velocity["peak_velocity"],
            "smoothness": smoothness["smoothness"],
            "acceleration_variance": smoothness["acceleration_variance"],
            "jerk_variance": smoothness["jerk_variance"],
            "consistency": consistency,
            "form_issues": unique_warnings,
            "rep_details": [
                {
                    "duration_s": rep.duration_s,
                    "max_value": rep.max_value,
                    "min_value": rep.min_value,
                    "rom": rep.rom,
                    "avg_velocity": rep.avg_velocity,
                }
                for rep in self.rep_counter.completed_reps
            ],
        }

    @abstractmethod
    def _process_frame(
        self,
        frame: BiomechanicalFrame,
        observation: TrackingObservation,
    ) -> ExerciseFrameResult:
        """Handle exercise-specific classification, rep logic, and metrics."""
