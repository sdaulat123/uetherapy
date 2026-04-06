"""JSON session logging for rehabilitation metrics."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Dict


class SessionLogger:
    """Persist structured session summaries to JSON."""

    def __init__(self, output_dir: Path) -> None:
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def save(self, session_summary: Dict) -> Path:
        """Write a timestamped JSON session record."""

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        exercise_name = session_summary["exercise"]
        output_path = self.output_dir / f"{exercise_name}_{timestamp}.json"
        with output_path.open("w", encoding="utf-8") as handle:
            json.dump(session_summary, handle, indent=2)
        return output_path
