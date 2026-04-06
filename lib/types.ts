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
export type HandLabel = "Left" | "Right" | "Unknown";

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
  | "prayer_stretch"
  | "hand_arom_tendon_gliding_series"
  | "hand_arom_pip_blocking"
  | "hand_arom_dip_blocking"
  | "seated_finger_composite_flexion_stretch"
  | "thumb_abduction_arom_on_table"
  | "seated_thumb_composite_flexion_arom"
  | "hand_prom_finger_extension"
  | "seated_forearm_pronation_and_supination_arom"
  | "wrist_arom_radial_and_ulnar_deviation"
  | "seated_wrist_flexion_arom"
  | "seated_wrist_extension_arom"
  | "wrist_arom_wrist_circumduction"
  | "standing_wrist_flexion_stretch"
  | "standing_wrist_extension_stretch"
  | "seated_wrist_flexion_prom_stretch"
  | "seated_wrist_extension_prom"
  | "wrist_prayer_stretch_at_table"
  | "seated_wrist_extension_with_dumbbell"
  | "seated_wrist_flexion_with_dumbbell"
  | "seated_wrist_radial_deviation_with_dumbbell"
  | "forearm_pronation_and_supination_with_hammer"
  | "seated_gripping_towel"
  | "tip_pinch_with_putty"
  | "resisted_finger_extension_and_thumb_abduction"
  | "hand_towel_scrunching"
  | "seated_thumb_extension_with_resistance"
  | "thumb_radial_abduction_with_rubber_band_palm_down"
  | "putty_squeezes";

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export type HandLandmarks = Record<HandLandmarkName, Point3D>;

export interface TrackingFrame {
  timestampMs: number;
  handedness: HandLabel;
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
  handedness: HandLabel;
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
  handedness?: HandLabel;
  state: string;
  repCount: number;
  primaryMetric: number;
  displayMetrics: Record<string, string | number>;
  warnings: string[];
}

export interface SessionSummary {
  exercise: ExerciseName;
  handedness?: HandLabel;
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
  [key: string]: string | number | string[] | SessionSummary["rep_details"] | undefined;
}

export interface ExerciseOption {
  id: ExerciseName;
  label: string;
  description: string;
  group: string;
}
