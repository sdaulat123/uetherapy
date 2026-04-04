"""Entry point for the rehabilitation motion tracking system."""

from __future__ import annotations

import argparse
from typing import Dict

import cv2

from camera.video_stream import VideoStream
from config import AppConfig, build_state_machine_configs
from exercises.base_exercise import BaseExercise
from exercises.finger_exercises import (
    CompositeFingerFlexionExercise,
    DIPBlockingExercise,
    FingerSpreadingExercise,
    PIPBlockingExercise,
    TendonGlidingExercise,
)
from exercises.strength_exercises import (
    GripStrengthExercise,
    RubberBandExtensionExercise,
    TipPinchExercise,
)
from exercises.thumb_exercises import ThumbAbductionExercise, ThumbOppositionExercise
from exercises.wrist_exercises import (
    PrayerStretchExercise,
    PronationSupinationExercise,
    RadialUlnarDeviationExercise,
    WristCircumductionExercise,
    WristExtensionExercise,
    WristExtensionStretchExercise,
    WristFlexionExercise,
    WristFlexionStretchExercise,
)
from storage.session_logger import SessionLogger
from ui.overlay import OverlayRenderer
from vision.landmark_smoother import LandmarkSmoother
from vision.mediapipe_tracker import MediaPipeTracker


def build_exercise_registry(config: AppConfig) -> Dict[str, BaseExercise]:
    """Instantiate all supported exercise classes."""

    state_configs = build_state_machine_configs(config.thresholds)
    thresholds = config.thresholds
    return {
        "tendon_gliding": TendonGlidingExercise(thresholds),
        "pip_blocking": PIPBlockingExercise(thresholds),
        "dip_blocking": DIPBlockingExercise(thresholds),
        "finger_spreading": FingerSpreadingExercise(thresholds),
        "composite_finger_flexion": CompositeFingerFlexionExercise(thresholds),
        "thumb_opposition": ThumbOppositionExercise(
            thresholds, state_configs["thumb_opposition"]
        ),
        "thumb_abduction": ThumbAbductionExercise(thresholds),
        "wrist_flexion": WristFlexionExercise(thresholds, state_configs["wrist_flexion"]),
        "wrist_extension": WristExtensionExercise(thresholds, state_configs["wrist_flexion"]),
        "radial_ulnar_deviation": RadialUlnarDeviationExercise(thresholds),
        "wrist_circumduction": WristCircumductionExercise(thresholds),
        "pronation_supination": PronationSupinationExercise(thresholds),
        "grip_strength": GripStrengthExercise(thresholds),
        "tip_pinch": TipPinchExercise(thresholds),
        "rubber_band_extension": RubberBandExtensionExercise(thresholds),
        "wrist_flexion_stretch": WristFlexionStretchExercise(thresholds),
        "wrist_extension_stretch": WristExtensionStretchExercise(thresholds),
        "prayer_stretch": PrayerStretchExercise(thresholds),
    }


def parse_args(available_exercises: list[str], default_exercise: str) -> argparse.Namespace:
    """Parse CLI arguments."""

    parser = argparse.ArgumentParser(description="Rehabilitation motion tracking application")
    parser.add_argument(
        "--exercise",
        choices=sorted(available_exercises),
        default=default_exercise,
        help="Exercise to track in realtime.",
    )
    return parser.parse_args()


def main() -> None:
    """Run the realtime rehab motion tracking loop."""

    config = AppConfig()
    exercises = build_exercise_registry(config)
    args = parse_args(list(exercises.keys()), config.default_exercise)
    active_exercise = exercises[args.exercise]

    stream = VideoStream(config.camera)
    smoother = LandmarkSmoother(config.smoothing)
    tracker = MediaPipeTracker(config.tracker, smoother=smoother)
    overlay = OverlayRenderer()
    logger = SessionLogger(config.session.output_dir)

    try:
        for frame, timestamp_s in stream.frames():
            observation = tracker.process(frame, timestamp_s)
            result = active_exercise.process(observation)
            rendered = overlay.draw(frame, observation, result)
            cv2.imshow("Rehabilitation Motion Tracker", rendered)
            key = cv2.waitKey(1) & 0xFF
            if key in (27, ord("q")):
                break
    finally:
        summary = active_exercise.build_session_summary()
        output_path = logger.save(summary)
        tracker.close()
        stream.release()
        cv2.destroyAllWindows()
        print(f"Session saved to: {output_path}")


if __name__ == "__main__":
    main()
