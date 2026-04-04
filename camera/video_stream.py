"""Video capture wrapper with deterministic lifecycle management."""

from __future__ import annotations

from typing import Iterator, Tuple

import cv2
import numpy as np

from config import CameraConfig


class VideoStream:
    """Thin wrapper over OpenCV capture with configured resolution and FPS."""

    def __init__(self, config: CameraConfig) -> None:
        self.config = config
        self.capture = cv2.VideoCapture(config.device_index)
        self.capture.set(cv2.CAP_PROP_FRAME_WIDTH, config.width)
        self.capture.set(cv2.CAP_PROP_FRAME_HEIGHT, config.height)
        self.capture.set(cv2.CAP_PROP_FPS, config.fps)

        if not self.capture.isOpened():
            raise RuntimeError(f"Unable to open camera index {config.device_index}.")

    def frames(self) -> Iterator[Tuple[np.ndarray, float]]:
        """Yield captured frames and OpenCV timestamps in milliseconds."""

        while True:
            success, frame = self.capture.read()
            if not success:
                break
            timestamp_ms = self.capture.get(cv2.CAP_PROP_POS_MSEC)
            yield frame, timestamp_ms / 1000.0

    def release(self) -> None:
        """Release the underlying capture device."""

        self.capture.release()
