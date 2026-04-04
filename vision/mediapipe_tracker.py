"""MediaPipe-based hand and optional pose tracking."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional

import cv2
import mediapipe as mp
import numpy as np

from config import TrackerConfig
from vision.landmark_smoother import LandmarkSmoother


HAND_LANDMARK_NAMES = [
    "wrist",
    "thumb_cmc",
    "thumb_mcp",
    "thumb_ip",
    "thumb_tip",
    "index_mcp",
    "index_pip",
    "index_dip",
    "index_tip",
    "middle_mcp",
    "middle_pip",
    "middle_dip",
    "middle_tip",
    "ring_mcp",
    "ring_pip",
    "ring_dip",
    "ring_tip",
    "pinky_mcp",
    "pinky_pip",
    "pinky_dip",
    "pinky_tip",
]


@dataclass(frozen=True)
class TrackingObservation:
    """Normalized tracking output for downstream exercise logic."""

    timestamp_s: float
    frame_shape: tuple[int, int, int]
    hand_landmarks: Dict[str, np.ndarray]
    elbow_landmark: Optional[np.ndarray]
    handedness: Optional[str]

    @property
    def has_hand(self) -> bool:
        """Return whether a hand was detected in the frame."""

        return bool(self.hand_landmarks)


class MediaPipeTracker:
    """Primary hand tracker with optional elbow estimation via pose landmarks."""

    def __init__(
        self,
        config: TrackerConfig,
        smoother: Optional[LandmarkSmoother] = None,
    ) -> None:
        self.config = config
        self.smoother = smoother
        self._hands = mp.solutions.hands.Hands(
            static_image_mode=False,
            max_num_hands=config.max_num_hands,
            model_complexity=config.model_complexity,
            min_detection_confidence=config.min_detection_confidence,
            min_tracking_confidence=config.min_tracking_confidence,
        )
        self._pose = (
            mp.solutions.pose.Pose(
                static_image_mode=False,
                model_complexity=1,
                min_detection_confidence=config.min_detection_confidence,
                min_tracking_confidence=config.min_tracking_confidence,
            )
            if config.use_pose
            else None
        )

    def process(self, frame: np.ndarray, timestamp_s: float) -> TrackingObservation:
        """Track a hand and optional elbow proxy for the current frame."""

        image_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        hand_results = self._hands.process(image_rgb)
        pose_results = self._pose.process(image_rgb) if self._pose else None

        hand_landmarks = {}
        handedness = None

        if hand_results.multi_hand_landmarks:
            height, width = frame.shape[:2]
            landmarks = hand_results.multi_hand_landmarks[0].landmark
            for idx, landmark in enumerate(landmarks):
                point = np.array(
                    [landmark.x * width, landmark.y * height, landmark.z * width],
                    dtype=np.float32,
                )
                key = HAND_LANDMARK_NAMES[idx]
                if self.smoother is not None:
                    point = self.smoother.smooth(key, point)
                hand_landmarks[key] = point

            if hand_results.multi_handedness:
                handedness = hand_results.multi_handedness[0].classification[0].label

        elbow_landmark = self._extract_elbow(frame, pose_results, handedness)
        return TrackingObservation(
            timestamp_s=timestamp_s,
            frame_shape=frame.shape,
            hand_landmarks=hand_landmarks,
            elbow_landmark=elbow_landmark,
            handedness=handedness,
        )

    def _extract_elbow(
        self,
        frame: np.ndarray,
        pose_results: Optional[object],
        handedness: Optional[str],
    ) -> Optional[np.ndarray]:
        """Extract elbow position matching the tracked hand side when pose exists."""

        if pose_results is None or pose_results.pose_landmarks is None:
            return None

        if handedness == "Left":
            elbow_index = mp.solutions.pose.PoseLandmark.LEFT_ELBOW
        else:
            elbow_index = mp.solutions.pose.PoseLandmark.RIGHT_ELBOW

        landmark = pose_results.pose_landmarks.landmark[elbow_index]
        height, width = frame.shape[:2]
        point = np.array(
            [landmark.x * width, landmark.y * height, landmark.z * width],
            dtype=np.float32,
        )
        if self.smoother is not None:
            return self.smoother.smooth(f"pose_elbow_{elbow_index.name}", point)
        return point

    def close(self) -> None:
        """Release MediaPipe resources."""

        self._hands.close()
        if self._pose is not None:
            self._pose.close()
