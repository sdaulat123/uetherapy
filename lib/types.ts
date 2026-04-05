export const HAND_LANDMARK_NAMES = [
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
  "pinky_tip"
] as const;

export type HandLandmarkName = (typeof HAND_LANDMARK_NAMES)[number];

export type ExerciseName =
  | "tendon_gliding"
  | "pip_blocking"
  | "dip_blocking"
  | "finger_spreading"
  | "composite_finger_flexion"
  | "wrist_flexion"
  | "thumb_opposition"
  | "thumb_abduction"
  | "wrist_extension"
  | "radial_ulnar_deviation"
  | "wrist_circumduction"
  | "pronation_supination"
  | "grip_strength"
  | "tip_pinch"
  | "rubber_band_extension"
  | "wrist_flexion_stretch"
  | "wrist_extension_stretch"
  | "prayer_stretch";

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export type HandLandmarks = Record<HandLandmarkName, Point3D>;

export interface TrackingFrame {
  timestampMs: number;
  handLandmarks: HandLandmarks | null;
  handWorldLandmarks?: HandLandmarks | null;
  elbowPoint: Point3D | null;
  imageWidth: number;
  imageHeight: number;
}

export interface FingerAngles {
  mcp: number;
  pip: number;
  dip?: number;
  ip?: number;
}

export interface BiomechanicalFrame {
  timestampMs: number;
  handLandmarks: HandLandmarks;
  handWorldLandmarks: HandLandmarks;
  elbowPoint: Point3D | null;
  wristAngleDeg: number;
  radialUlnarDeviationDeg: number;
  pronationSupinationDeg: number;
  wristFlexionDeg: number;
  wristExtensionDeg: number;
  radialDeviationDeg: number;
  ulnarDeviationDeg: number;
  movementType: string;
  neutralReady: boolean;
  fingerSpreadPx: number;
  thumbDistancesPx: Record<"index" | "middle" | "ring" | "pinky", number>;
  fingerAngles: Record<"index" | "middle" | "ring" | "pinky" | "thumb", FingerAngles>;
}

export interface FrameResult {
  exerciseName: ExerciseName;
  state: string;
  repCount: number;
  primaryMetric: number;
  displayMetrics: Record<string, string | number>;
  warnings: string[];
}

export interface SessionSummary {
  exercise: ExerciseName;
  reps: number;
  max_angle: number;
  min_angle: number;
  rom: number;
  avg_velocity: number;
  peak_velocity: number;
  smoothness: number;
  consistency: number;
  form_issues: string[];
  rep_details: Array<{
    duration_s: number;
    max_value: number;
    min_value: number;
    rom: number;
    avg_velocity: number;
  }>;
  [key: string]: string | number | string[] | SessionSummary["rep_details"];
}

export interface ExerciseOption {
  id: ExerciseName;
  label: string;
  description: string;
}
