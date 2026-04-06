"""Application-wide configuration for the rehabilitation motion tracker."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional


PROJECT_ROOT = Path(__file__).resolve().parent
SESSION_DIR = PROJECT_ROOT / "sessions"


@dataclass(frozen=True)
class CameraConfig:
    """Camera and frame acquisition settings."""

    device_index: int = 0
    width: int = 1280
    height: int = 720
    fps: int = 30


@dataclass(frozen=True)
class SmoothingConfig:
    """Landmark smoothing settings."""

    enabled: bool = True
    ema_alpha: float = 0.35


@dataclass(frozen=True)
class TrackerConfig:
    """MediaPipe tracker settings."""

    max_num_hands: int = 1
    model_complexity: int = 1
    min_detection_confidence: float = 0.6
    min_tracking_confidence: float = 0.6
    use_pose: bool = True


@dataclass(frozen=True)
class StateMachineConfig:
    """Generic repetition state machine thresholds."""

    active_threshold: float
    rest_threshold: float
    hold_threshold: Optional[float] = None
    velocity_threshold: float = 1.0
    min_hold_time_s: float = 0.2
    debounce_frames: int = 3


@dataclass(frozen=True)
class ExerciseThresholds:
    """Exercise-specific measurement thresholds."""

    contact_distance_px: float = 28.0
    spread_active_distance_px: float = 145.0
    spread_rest_distance_px: float = 115.0
    wrist_flexion_active_deg: float = 36.0
    wrist_flexion_rest_deg: float = 14.0
    elbow_motion_px: float = 25.0
    compensation_angle_deg: float = 18.0
    tendon_mcp_flexed_deg: float = 45.0
    tendon_pip_hook_deg: float = 70.0
    tendon_dip_hook_deg: float = 55.0
    tendon_fist_deg: float = 65.0
    blocking_joint_max_deg: float = 18.0
    pronation_active_deg: float = 30.0
    static_hold_std_threshold: float = 4.0


@dataclass(frozen=True)
class SessionConfig:
    """Session output settings."""

    output_dir: Path = SESSION_DIR
    save_frames: bool = False


@dataclass(frozen=True)
class AppConfig:
    """Top-level application configuration."""

    camera: CameraConfig = field(default_factory=CameraConfig)
    tracker: TrackerConfig = field(default_factory=TrackerConfig)
    smoothing: SmoothingConfig = field(default_factory=SmoothingConfig)
    thresholds: ExerciseThresholds = field(default_factory=ExerciseThresholds)
    session: SessionConfig = field(default_factory=SessionConfig)
    default_exercise: str = "wrist_flexion"


def build_state_machine_configs(
    thresholds: ExerciseThresholds,
) -> Dict[str, StateMachineConfig]:
    """Return configurable state machine settings keyed by exercise name."""

    return {
        "wrist_flexion": StateMachineConfig(
            active_threshold=thresholds.wrist_flexion_active_deg,
            rest_threshold=thresholds.wrist_flexion_rest_deg,
            hold_threshold=thresholds.wrist_flexion_active_deg + 8.0,
            velocity_threshold=6.0,
            min_hold_time_s=0.15,
            debounce_frames=3,
        ),
        "thumb_opposition": StateMachineConfig(
            active_threshold=thresholds.contact_distance_px,
            rest_threshold=thresholds.contact_distance_px + 14.0,
            hold_threshold=thresholds.contact_distance_px,
            velocity_threshold=2.0,
            min_hold_time_s=0.1,
            debounce_frames=2,
        ),
    }
