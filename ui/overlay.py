"""Realtime on-frame overlay rendering."""

from __future__ import annotations

from typing import Optional

import cv2
import mediapipe as mp
import numpy as np

from exercises.base_exercise import ExerciseFrameResult
from vision.mediapipe_tracker import HAND_LANDMARK_NAMES, TrackingObservation


class OverlayRenderer:
    """Draw landmarks, metrics, state, and warnings on a frame."""

    def __init__(self) -> None:
        self._drawer = mp.solutions.drawing_utils
        self._hands = mp.solutions.hands

    def draw(
        self,
        frame: np.ndarray,
        observation: TrackingObservation,
        result: Optional[ExerciseFrameResult],
    ) -> np.ndarray:
        """Return an annotated copy of the frame."""

        canvas = frame.copy()
        if observation.hand_landmarks:
            self._draw_landmarks(canvas, observation.hand_landmarks)
        if result is not None:
            self._draw_metrics(canvas, result)
        return canvas

    def _draw_landmarks(self, frame: np.ndarray, landmarks: dict[str, np.ndarray]) -> None:
        """Draw hand landmarks and skeletal connections."""

        for key, point in landmarks.items():
            xy = tuple(np.round(point[:2]).astype(int))
            cv2.circle(frame, xy, 4, (0, 255, 0), -1)
            if key in ("wrist", "thumb_tip", "index_tip", "middle_tip"):
                cv2.putText(
                    frame,
                    key,
                    (xy[0] + 4, xy[1] - 4),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.4,
                    (255, 255, 255),
                    1,
                    cv2.LINE_AA,
                )

    def _draw_metrics(self, frame: np.ndarray, result: ExerciseFrameResult) -> None:
        """Draw metrics and warnings in a compact HUD."""

        lines = [
            f"Exercise: {result.exercise_name}",
            f"State: {result.state}",
            f"Reps: {result.rep_count}",
            f"Primary: {result.primary_metric:.1f}",
        ]
        for key, value in result.display_metrics.items():
            lines.append(f"{key}: {value}")
        if result.warnings:
            lines.extend([f"Warning: {warning}" for warning in result.warnings])

        for idx, line in enumerate(lines):
            cv2.putText(
                frame,
                line,
                (16, 28 + idx * 22),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (0, 255, 255) if line.startswith("Warning") else (255, 255, 255),
                2,
                cv2.LINE_AA,
            )
