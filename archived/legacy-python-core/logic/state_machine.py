"""Threshold-based repetition state machine with debounce and hold support."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from config import StateMachineConfig


class MovementState(str, Enum):
    """Supported repetition states."""

    REST = "REST"
    ACTIVE = "ACTIVE"
    HOLD = "HOLD"


@dataclass
class StateTransition:
    """State transition outcome for the current frame."""

    state: MovementState
    changed: bool
    rep_completed: bool


class ExerciseStateMachine:
    """Robust threshold state machine for dynamic and static exercises."""

    def __init__(self, config: StateMachineConfig, invert_metric: bool = False) -> None:
        self.config = config
        self.invert_metric = invert_metric
        self.state = MovementState.REST
        self._candidate_state = self.state
        self._candidate_frames = 0
        self._hold_start_s: float | None = None

    def update(self, metric_value: float, velocity: float, timestamp_s: float) -> StateTransition:
        """Update state using measurement thresholds and velocity gating."""

        rep_completed = False
        effective_value = -metric_value if self.invert_metric else metric_value

        if abs(velocity) < self.config.velocity_threshold and self.state == MovementState.REST:
            desired = MovementState.REST
        elif self.config.hold_threshold is not None and effective_value >= self.config.hold_threshold:
            desired = MovementState.HOLD
        elif effective_value >= self.config.active_threshold:
            desired = MovementState.ACTIVE
        elif effective_value <= self.config.rest_threshold:
            desired = MovementState.REST
        else:
            desired = self.state

        if desired == self._candidate_state:
            self._candidate_frames += 1
        else:
            self._candidate_state = desired
            self._candidate_frames = 1

        changed = False
        if (
            self._candidate_state != self.state
            and self._candidate_frames >= self.config.debounce_frames
        ):
            previous_state = self.state
            self.state = self._candidate_state
            changed = True

            if self.state == MovementState.HOLD and self._hold_start_s is None:
                self._hold_start_s = timestamp_s
            elif self.state != MovementState.HOLD:
                self._hold_start_s = None

            if previous_state in (MovementState.ACTIVE, MovementState.HOLD) and self.state == MovementState.REST:
                rep_completed = True

        if self.state == MovementState.HOLD and self._hold_start_s is not None:
            hold_time = timestamp_s - self._hold_start_s
            if hold_time < self.config.min_hold_time_s:
                rep_completed = False

        return StateTransition(state=self.state, changed=changed, rep_completed=rep_completed)
