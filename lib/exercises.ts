import type {
  BiomechanicalFrame,
  ExerciseName,
  ExerciseOption,
  FrameResult,
  SessionSummary
} from "@/lib/types";
import { distance } from "@/lib/biomechanics";

type MovementState = "REST" | "ACTIVE" | "HOLD";

interface StateMachineConfig {
  activeThreshold: number;
  restThreshold: number;
  holdThreshold?: number;
  velocityThreshold: number;
  minHoldMs: number;
  debounceFrames: number;
  invertMetric?: boolean;
}

interface RepSample {
  timestampMs: number;
  value: number;
  velocity: number;
}

const EXERCISE_META: ExerciseOption[] = [
  {
    id: "hand_arom_tendon_gliding_series",
    label: "Hand AROM Tendon Gliding Series",
    description: "Sequence detection for open, hook, flat, and fist positions."
    ,
    group: "Hand Range of Motion"
  },
  {
    id: "hand_arom_pip_blocking",
    label: "Hand AROM PIP Blocking",
    description: "Tracks isolated PIP flexion while penalizing MCP and DIP compensation."
    ,
    group: "Hand Range of Motion"
  },
  {
    id: "hand_arom_dip_blocking",
    label: "Hand AROM DIP Blocking",
    description: "Tracks isolated DIP flexion with compensation monitoring."
    ,
    group: "Hand Range of Motion"
  },
  {
    id: "finger_spreading",
    label: "Finger Spreading",
    description: "Measures fingertip spread and spread symmetry across the hand."
    ,
    group: "Hand Range of Motion"
  },
  {
    id: "seated_finger_composite_flexion_stretch",
    label: "Seated Finger Composite Flexion Stretch",
    description: "Aggregates finger flexion into a single total flexion score."
    ,
    group: "Hand Range of Motion"
  },
  {
    id: "thumb_opposition",
    label: "Thumb Opposition",
    description: "Detects thumb-to-finger contact with precision and success-rate metrics."
    ,
    group: "Hand Range of Motion"
  },
  {
    id: "thumb_abduction_arom_on_table",
    label: "Thumb Abduction AROM on Table",
    description: "Measures radial thumb displacement relative to the index-wrist base."
    ,
    group: "Hand Range of Motion"
  },
  {
    id: "seated_thumb_composite_flexion_arom",
    label: "Seated Thumb Composite Flexion AROM",
    description: "Tracks thumb flexion and opposition closure through composite thumb motion."
    ,
    group: "Hand Range of Motion"
  },
  {
    id: "hand_prom_finger_extension",
    label: "Hand PROM Finger Extension",
    description: "Monitors passive-style finger extension opening and return."
    ,
    group: "Hand Range of Motion"
  },
  {
    id: "seated_forearm_pronation_and_supination_arom",
    label: "Seated Forearm Pronation and Supination AROM",
    description: "Uses palm orientation to estimate forearm rotation control."
    ,
    group: "Wrist Range of Motion"
  },
  {
    id: "wrist_arom_radial_and_ulnar_deviation",
    label: "Wrist AROM Radial and Ulnar deviation",
    description: "Lateral hand deviation relative to the forearm axis."
    ,
    group: "Wrist Range of Motion"
  },
  {
    id: "seated_wrist_flexion_arom",
    label: "Seated Wrist Flexion AROM",
    description: "Realtime wrist flexion tracking with repetition gating and form warnings."
    ,
    group: "Wrist Range of Motion"
  },
  {
    id: "seated_wrist_extension_arom",
    label: "Seated Wrist Extension AROM",
    description: "Realtime wrist extension tracking with repetition gating and form warnings."
    ,
    group: "Wrist Range of Motion"
  },
  {
    id: "wrist_arom_wrist_circumduction",
    label: "Wrist AROM Wrist Circumduction",
    description: "Tracks circular hand trajectory completeness and smoothness."
    ,
    group: "Wrist Range of Motion"
  },
  {
    id: "standing_wrist_flexion_stretch",
    label: "Standing Wrist Flexion Stretch",
    description: "Static wrist flexion hold detection with stability monitoring."
    ,
    group: "Wrist Stretches"
  },
  {
    id: "standing_wrist_extension_stretch",
    label: "Standing Wrist Extension Stretch",
    description: "Static wrist extension hold detection with stability scoring."
    ,
    group: "Wrist Stretches"
  },
  {
    id: "seated_wrist_flexion_prom_stretch",
    label: "Seated Wrist Flexion PROM Stretch",
    description: "Passive-style wrist flexion stretch hold with stability monitoring."
    ,
    group: "Wrist Stretches"
  },
  {
    id: "seated_wrist_extension_prom",
    label: "Seated Wrist Extension PROM",
    description: "Passive-style wrist extension stretch hold with stability monitoring."
    ,
    group: "Wrist Stretches"
  },
  {
    id: "wrist_prayer_stretch_at_table",
    label: "Wrist Prayer Stretch at Table",
    description: "Static prayer-position stretch with hold stability monitoring."
    ,
    group: "Wrist Stretches"
  },
  {
    id: "seated_wrist_extension_with_dumbbell",
    label: "Seated Wrist Extension with Dumbbell",
    description: "Loaded wrist extension tracking using the wrist extension movement pattern."
    ,
    group: "Strengthening"
  },
  {
    id: "seated_wrist_flexion_with_dumbbell",
    label: "Seated Wrist Flexion with Dumbbell",
    description: "Loaded wrist flexion tracking using the wrist flexion movement pattern."
    ,
    group: "Strengthening"
  },
  {
    id: "seated_wrist_radial_deviation_with_dumbbell",
    label: "Seated Wrist Radial Deviation with Dumbbell",
    description: "Loaded radial deviation tracking using the radial-ulnar movement pattern."
    ,
    group: "Strengthening"
  },
  {
    id: "forearm_pronation_and_supination_with_hammer",
    label: "Forearm Pronation and Supination with Hammer",
    description: "Loaded forearm rotation tracking using pronation-supination motion."
    ,
    group: "Strengthening"
  },
  {
    id: "seated_gripping_towel",
    label: "Seated Gripping Towel",
    description: "Measures finger curl closure completeness and hold quality."
    ,
    group: "Strengthening"
  },
  {
    id: "tip_pinch_with_putty",
    label: "Tip Pinch with Putty",
    description: "Thumb-index pinch precision with hold stability."
    ,
    group: "Strengthening"
  },
  {
    id: "resisted_finger_extension_and_thumb_abduction",
    label: "Resisted Finger Extension and Thumb Abduction",
    description: "Tracks finger extension and thumb opening against resistance."
    ,
    group: "Strengthening"
  },
  {
    id: "hand_towel_scrunching",
    label: "Hand Towel Scrunching",
    description: "Tracks composite finger flexion during towel-scrunch style grasping."
    ,
    group: "Strengthening"
  },
  {
    id: "seated_thumb_extension_with_resistance",
    label: "Seated Thumb Extension with Resistance",
    description: "Tracks thumb opening/extension against resistance."
    ,
    group: "Strengthening"
  },
  {
    id: "thumb_radial_abduction_with_rubber_band_palm_down",
    label: "Thumb Radial Abduction with Rubber Band - Palm Down",
    description: "Tracks thumb radial abduction against elastic resistance."
    ,
    group: "Strengthening"
  },
  {
    id: "putty_squeezes",
    label: "Putty Squeezes",
    description: "Measures global grip closure completeness and return control."
    ,
    group: "Strengthening"
  }
];

class ExerciseStateMachine {
  private state: MovementState = "REST";
  private candidateState: MovementState = "REST";
  private candidateFrames = 0;
  private holdStartedAt: number | null = null;

  constructor(private readonly config: StateMachineConfig) {}

  update(value: number, velocity: number, timestampMs: number) {
    const effectiveValue = this.config.invertMetric ? -value : value;
    let desired = this.state;

    if (Math.abs(velocity) < this.config.velocityThreshold && this.state === "REST") {
      desired = "REST";
    } else if (
      this.config.holdThreshold !== undefined &&
      effectiveValue >= this.config.holdThreshold
    ) {
      desired = "HOLD";
    } else if (effectiveValue >= this.config.activeThreshold) {
      desired = "ACTIVE";
    } else if (effectiveValue <= this.config.restThreshold) {
      desired = "REST";
    }

    if (desired === this.candidateState) {
      this.candidateFrames += 1;
    } else {
      this.candidateState = desired;
      this.candidateFrames = 1;
    }

    let repCompleted = false;
    let stateChanged = false;
    if (this.candidateState !== this.state && this.candidateFrames >= this.config.debounceFrames) {
      const previous = this.state;
      this.state = this.candidateState;
      stateChanged = true;
      if (this.state === "HOLD") {
        this.holdStartedAt = timestampMs;
      } else {
        this.holdStartedAt = null;
      }
      if ((previous === "ACTIVE" || previous === "HOLD") && this.state === "REST") {
        repCompleted = true;
      }
    }

    if (
      repCompleted &&
      this.holdStartedAt !== null &&
      timestampMs - this.holdStartedAt < this.config.minHoldMs
    ) {
      repCompleted = false;
    }

    return { state: this.state, repCompleted, stateChanged };
  }
}

abstract class BaseExerciseEvaluator {
  protected readonly stateMachine: ExerciseStateMachine | null;
  protected readonly measureHistory: number[] = [];
  protected readonly velocityHistory: number[] = [];
  protected readonly timestampHistory: number[] = [];
  protected readonly warningHistory: string[] = [];
  protected readonly repSamples: RepSample[] = [];
  protected readonly completedReps: SessionSummary["rep_details"] = [];
  protected repCount = 0;
  private previousValue = 0;
  private previousTimestampMs: number | null = null;

  constructor(stateConfig?: StateMachineConfig) {
    this.stateMachine = stateConfig ? new ExerciseStateMachine(stateConfig) : null;
  }

  protected updateState(primaryMetric: number, timestampMs: number, stateMetric = primaryMetric) {
    const dtSeconds =
      this.previousTimestampMs === null ? 0 : (timestampMs - this.previousTimestampMs) / 1000;
    const velocity = dtSeconds > 0 ? (primaryMetric - this.previousValue) / dtSeconds : 0;
    this.previousValue = primaryMetric;
    this.previousTimestampMs = timestampMs;
    this.measureHistory.push(primaryMetric);
    this.velocityHistory.push(velocity);
    this.timestampHistory.push(timestampMs);

    if (!this.stateMachine) {
      return { state: "ACTIVE" as MovementState, velocity, repCompleted: false, stateChanged: false };
    }

    const transition = this.stateMachine.update(stateMetric, velocity, timestampMs);
    if (transition.state === "ACTIVE" || transition.state === "HOLD") {
      this.repSamples.push({ timestampMs, value: primaryMetric, velocity });
    }
    if (transition.repCompleted) {
      this.closeRep();
    }
    return { ...transition, velocity };
  }

  protected forceRep(primaryMetric: number, timestampMs: number, velocity = 0) {
    this.repSamples.push({ timestampMs, value: primaryMetric, velocity });
    this.closeRep();
  }

  private closeRep() {
    if (this.repSamples.length < 1) {
      return;
    }
    const values = this.repSamples.map((sample) => sample.value);
    const avgVelocity =
      this.repSamples.reduce((sum, sample) => sum + Math.abs(sample.velocity), 0) /
      this.repSamples.length;
    const first = this.repSamples[0];
    const last = this.repSamples[this.repSamples.length - 1];
    this.completedReps.push({
      duration_s: Math.max(0, (last.timestampMs - first.timestampMs) / 1000),
      max_value: Math.max(...values),
      min_value: Math.min(...values),
      rom: Math.max(...values) - Math.min(...values),
      avg_velocity: avgVelocity
    });
    this.repCount += 1;
    this.repSamples.length = 0;
  }

  protected registerWarnings(warnings: string[]) {
    this.warningHistory.push(...warnings);
  }

  protected windowStd(windowSize: number) {
    const values = this.measureHistory.slice(-windowSize);
    if (values.length < 2) {
      return 0;
    }
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance =
      values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  protected consistency() {
    if (this.completedReps.length === 0) {
      return 0;
    }
    const roms = this.completedReps.map((rep) => rep.rom);
    const avg = roms.reduce((sum, value) => sum + value, 0) / roms.length;
    const variance =
      roms.reduce((sum, value) => sum + (value - avg) ** 2, 0) / roms.length;
    return Math.sqrt(variance);
  }

  protected smoothness() {
    if (this.velocityHistory.length < 3) {
      return 0;
    }
    const accelerations: number[] = [];
    for (let index = 1; index < this.velocityHistory.length; index += 1) {
      const dt = (this.timestampHistory[index] - this.timestampHistory[index - 1]) / 1000 || 1;
      accelerations.push((this.velocityHistory[index] - this.velocityHistory[index - 1]) / dt);
    }
    if (accelerations.length < 2) {
      return 0;
    }
    const jerks: number[] = [];
    for (let index = 1; index < accelerations.length; index += 1) {
      jerks.push(accelerations[index] - accelerations[index - 1]);
    }
    if (jerks.length === 0) {
      return 0;
    }
    const mean = jerks.reduce((sum, value) => sum + value, 0) / jerks.length;
    return jerks.reduce((sum, value) => sum + (value - mean) ** 2, 0) / jerks.length;
  }

  buildSummary(name: ExerciseName): SessionSummary {
    const maxAngle = this.measureHistory.length ? Math.max(...this.measureHistory) : 0;
    const minAngle = this.measureHistory.length ? Math.min(...this.measureHistory) : 0;
    const avgVelocity = this.velocityHistory.length
      ? this.velocityHistory.reduce((sum, value) => sum + Math.abs(value), 0) /
        this.velocityHistory.length
      : 0;
    return {
      exercise: name,
      reps: this.repCount,
      max_angle: maxAngle,
      min_angle: minAngle,
      rom: maxAngle - minAngle,
      avg_velocity: avgVelocity,
      peak_velocity: this.velocityHistory.length
        ? Math.max(...this.velocityHistory.map((value) => Math.abs(value)))
        : 0,
      smoothness: this.smoothness(),
      consistency: this.consistency(),
      form_issues: [...new Set(this.warningHistory)],
      rep_details: this.completedReps
    };
  }

  abstract process(frame: BiomechanicalFrame): FrameResult;
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sumFingerAngles(frame: BiomechanicalFrame) {
  return (
    frame.fingerAngles.index.mcp +
    frame.fingerAngles.index.pip +
    (frame.fingerAngles.index.dip ?? 0) +
    frame.fingerAngles.middle.mcp +
    frame.fingerAngles.middle.pip +
    (frame.fingerAngles.middle.dip ?? 0) +
    frame.fingerAngles.ring.mcp +
    frame.fingerAngles.ring.pip +
    (frame.fingerAngles.ring.dip ?? 0) +
    frame.fingerAngles.pinky.mcp +
    frame.fingerAngles.pinky.pip +
    (frame.fingerAngles.pinky.dip ?? 0)
  );
}

function blockIsolationScore(primary: number, otherAngles: number[]) {
  return Math.max(0, 1 - otherAngles.reduce((sum, value) => sum + Math.abs(value), 0) / Math.max(primary, 1));
}

class TendonGlidingEvaluator extends BaseExerciseEvaluator {
  private readonly expectedSequence = ["open", "hook", "flat", "fist"] as const;
  private sequenceProgress: string[] = [];
  private lastTransitionTimeMs: number | null = null;
  private transitionDurationsMs: number[] = [];

  process(frame: BiomechanicalFrame): FrameResult {
    const pipMean = mean([
      frame.fingerAngles.index.pip,
      frame.fingerAngles.middle.pip,
      frame.fingerAngles.ring.pip,
      frame.fingerAngles.pinky.pip
    ]);
    const dipMean = mean([
      frame.fingerAngles.index.dip ?? 0,
      frame.fingerAngles.middle.dip ?? 0,
      frame.fingerAngles.ring.dip ?? 0,
      frame.fingerAngles.pinky.dip ?? 0
    ]);
    const mcpMean = mean([
      frame.fingerAngles.index.mcp,
      frame.fingerAngles.middle.mcp,
      frame.fingerAngles.ring.mcp,
      frame.fingerAngles.pinky.mcp
    ]);

    let poseState = "transition";
    if (pipMean < 35 && dipMean < 30 && mcpMean < 30) {
      poseState = "open";
    } else if (pipMean > 70 && dipMean > 55 && mcpMean < 45) {
      poseState = "hook";
    } else if (mcpMean > 45 && pipMean < 45) {
      poseState = "flat";
    } else if (mcpMean > 65 && pipMean > 65 && dipMean > 45) {
      poseState = "fist";
    }

    if (!this.sequenceProgress.length || poseState !== this.sequenceProgress.at(-1)) {
      if (this.expectedSequence.includes(poseState as (typeof this.expectedSequence)[number])) {
        const expected = this.expectedSequence[this.sequenceProgress.length % this.expectedSequence.length];
        if (poseState === expected) {
          if (this.lastTransitionTimeMs !== null) {
            this.transitionDurationsMs.push(frame.timestampMs - this.lastTransitionTimeMs);
          }
          this.lastTransitionTimeMs = frame.timestampMs;
          this.sequenceProgress.push(poseState);
          if (this.sequenceProgress.length === this.expectedSequence.length) {
            this.forceRep(mcpMean, frame.timestampMs);
            this.sequenceProgress = [];
          }
        }
      }
    }

    const { velocity } = this.updateState(mcpMean, frame.timestampMs);
    return {
      exerciseName: "tendon_gliding",
      state: poseState.toUpperCase(),
      repCount: this.repCount,
      primaryMetric: mcpMean,
      displayMetrics: {
        sequence_accuracy: (this.sequenceProgress.length / this.expectedSequence.length).toFixed(2),
        transition_time_s: this.transitionDurationsMs.length
          ? (mean(this.transitionDurationsMs) / 1000).toFixed(2)
          : "0.00",
        mean_mcp_deg: mcpMean.toFixed(1),
        velocity_deg_s: velocity.toFixed(1)
      },
      warnings: []
    };
  }
}

class PIPBlockingEvaluator extends BaseExerciseEvaluator {
  constructor() {
    super({
      activeThreshold: 60,
      restThreshold: 18,
      velocityThreshold: 5,
      minHoldMs: 80,
      debounceFrames: 2
    });
  }

  process(frame: BiomechanicalFrame): FrameResult {
    const primary = frame.fingerAngles.index.pip;
    const otherAngles = [frame.fingerAngles.index.mcp, frame.fingerAngles.index.dip ?? 0];
    const isolationScore = blockIsolationScore(primary, otherAngles);
    const stateMetric = isolationScore >= 0.55 ? primary : 0;
    const { state, velocity } = this.updateState(primary, frame.timestampMs, stateMetric);
    const warnings = otherAngles.some((value) => value > 18) ? ["Compensatory finger motion"] : [];
    this.registerWarnings(warnings);
    return {
      exerciseName: "pip_blocking",
      state,
      repCount: this.repCount,
      primaryMetric: primary,
      displayMetrics: {
        pip_angle_deg: primary.toFixed(1),
        isolation_score: isolationScore.toFixed(2),
        velocity_deg_s: velocity.toFixed(1)
      },
      warnings
    };
  }
}

class DIPBlockingEvaluator extends BaseExerciseEvaluator {
  constructor() {
    super({
      activeThreshold: 45,
      restThreshold: 14,
      velocityThreshold: 4,
      minHoldMs: 80,
      debounceFrames: 2
    });
  }

  process(frame: BiomechanicalFrame): FrameResult {
    const primary = frame.fingerAngles.index.dip ?? 0;
    const otherAngles = [frame.fingerAngles.index.mcp, frame.fingerAngles.index.pip];
    const isolationScore = blockIsolationScore(primary, otherAngles);
    const stateMetric = isolationScore >= 0.55 ? primary : 0;
    const { state, velocity } = this.updateState(primary, frame.timestampMs, stateMetric);
    const warnings = otherAngles.some((value) => value > 18) ? ["Compensatory finger motion"] : [];
    this.registerWarnings(warnings);
    return {
      exerciseName: "dip_blocking",
      state,
      repCount: this.repCount,
      primaryMetric: primary,
      displayMetrics: {
        dip_angle_deg: primary.toFixed(1),
        isolation_score: isolationScore.toFixed(2),
        velocity_deg_s: velocity.toFixed(1)
      },
      warnings
    };
  }
}

class FingerSpreadingEvaluator extends BaseExerciseEvaluator {
  constructor() {
    super({
      activeThreshold: 135,
      restThreshold: 105,
      velocityThreshold: 8,
      minHoldMs: 80,
      debounceFrames: 2
    });
  }

  process(frame: BiomechanicalFrame): FrameResult {
    const primary = frame.fingerSpreadPx;
    const { state, velocity } = this.updateState(primary, frame.timestampMs);
    const outerSpan = Math.hypot(
      frame.handLandmarks.thumb_tip.x - frame.handLandmarks.pinky_tip.x,
      frame.handLandmarks.thumb_tip.y - frame.handLandmarks.pinky_tip.y
    );
    const innerSpan = Math.hypot(
      frame.handLandmarks.index_tip.x - frame.handLandmarks.ring_tip.x,
      frame.handLandmarks.index_tip.y - frame.handLandmarks.ring_tip.y
    );
    const symmetry = Math.min(innerSpan / Math.max(outerSpan, 1), 1);
    return {
      exerciseName: "finger_spreading",
      state,
      repCount: this.repCount,
      primaryMetric: primary,
      displayMetrics: {
        spread_px: primary.toFixed(1),
        symmetry: symmetry.toFixed(2),
        velocity_px_s: velocity.toFixed(1)
      },
      warnings: []
    };
  }
}

class CompositeFingerFlexionEvaluator extends BaseExerciseEvaluator {
  constructor() {
    super({
      activeThreshold: 560,
      restThreshold: 280,
      velocityThreshold: 10,
      minHoldMs: 80,
      debounceFrames: 2
    });
  }

  process(frame: BiomechanicalFrame): FrameResult {
    const primary = sumFingerAngles(frame);
    const { state, velocity } = this.updateState(primary, frame.timestampMs);
    return {
      exerciseName: "composite_finger_flexion",
      state,
      repCount: this.repCount,
      primaryMetric: primary,
      displayMetrics: {
        total_flexion_deg: primary.toFixed(1),
        velocity_deg_s: velocity.toFixed(1)
      },
      warnings: []
    };
  }
}

class ThumbOppositionEvaluator extends BaseExerciseEvaluator {
  private successfulContacts = 0;

  constructor() {
    super({
      activeThreshold: -34,
      restThreshold: -48,
      holdThreshold: -30,
      velocityThreshold: 1,
      minHoldMs: 80,
      debounceFrames: 2,
      invertMetric: true
    });
  }

  process(frame: BiomechanicalFrame): FrameResult {
    const [finger, distancePx] = Object.entries(frame.thumbDistancesPx).sort((a, b) => a[1] - b[1])[0] as [
      string,
      number
    ];
    const { state, velocity, repCompleted } = this.updateState(distancePx, frame.timestampMs);
    if (repCompleted && distancePx <= 28) {
      this.successfulContacts += 1;
    }
    const precision = Math.max(0, 1 - distancePx / 56);
    return {
      exerciseName: "thumb_opposition",
      state,
      repCount: this.repCount,
      primaryMetric: distancePx,
      displayMetrics: {
        target_finger: finger,
        thumb_distance_px: distancePx.toFixed(1),
        precision: precision.toFixed(2),
        success_rate: this.repCount > 0 ? (this.successfulContacts / this.repCount).toFixed(2) : "0.00",
        velocity_px_s: velocity.toFixed(1)
      },
      warnings: []
    };
  }

  override buildSummary(name: ExerciseName): SessionSummary {
    return {
      ...super.buildSummary(name),
      success_rate: this.repCount > 0 ? this.successfulContacts / this.repCount : 0,
      precision_threshold_px: 28
    };
  }
}

class ThumbAbductionEvaluator extends BaseExerciseEvaluator {
  constructor() {
    super({
      activeThreshold: 95,
      restThreshold: 65,
      velocityThreshold: 5,
      minHoldMs: 60,
      debounceFrames: 2
    });
  }

  process(frame: BiomechanicalFrame): FrameResult {
    const baseX = (frame.handLandmarks.wrist.x + frame.handLandmarks.index_mcp.x) / 2;
    const baseY = (frame.handLandmarks.wrist.y + frame.handLandmarks.index_mcp.y) / 2;
    const primary = Math.hypot(frame.handLandmarks.thumb_tip.x - baseX, frame.handLandmarks.thumb_tip.y - baseY);
    const { state, velocity } = this.updateState(primary, frame.timestampMs);
    return {
      exerciseName: "thumb_abduction",
      state,
      repCount: this.repCount,
      primaryMetric: primary,
      displayMetrics: {
        abduction_px: primary.toFixed(1),
        velocity_px_s: velocity.toFixed(1)
      },
      warnings: []
    };
  }
}

class WristFlexionEvaluator extends BaseExerciseEvaluator {
  constructor(invert = false) {
    super({
      activeThreshold: 18,
      restThreshold: 6,
      holdThreshold: 24,
      velocityThreshold: 3,
      minHoldMs: 150,
      debounceFrames: 3,
      invertMetric: invert
    });
  }

  protected buildWarnings(frame: BiomechanicalFrame) {
    const warnings: string[] = [];
    if (Math.abs(frame.radialUlnarDeviationDeg) > 25) {
      warnings.push("Excess elbow movement");
    }
    this.registerWarnings(warnings);
    return warnings;
  }

  process(frame: BiomechanicalFrame): FrameResult {
    const primaryMetric = invertMetricFromFrame(frame, false);
    const { state, velocity } = this.updateState(primaryMetric, frame.timestampMs);
    const warnings = this.buildWarnings(frame);
    return {
      exerciseName: "wrist_flexion",
      state,
      repCount: this.repCount,
      primaryMetric: primaryMetric,
      displayMetrics: {
        wrist_flexion_deg: frame.wristFlexionDeg.toFixed(1),
        velocity_deg_s: velocity.toFixed(1),
        neutral_ready: frame.neutralReady ? "yes" : "no",
        movement_type: frame.movementType
      },
      warnings
    };
  }
}

function invertMetricFromFrame(frame: BiomechanicalFrame, extension: boolean) {
  return extension ? frame.wristExtensionDeg : frame.wristFlexionDeg;
}

class WristExtensionEvaluator extends WristFlexionEvaluator {
  constructor() {
    super(false);
  }

  override process(frame: BiomechanicalFrame): FrameResult {
    const extensionMetric = invertMetricFromFrame(frame, true);
    const { state, velocity } = this.updateState(extensionMetric, frame.timestampMs);
    const warnings = this.buildWarnings(frame);
    return {
      exerciseName: "wrist_extension",
      state,
      repCount: this.repCount,
      primaryMetric: extensionMetric,
      displayMetrics: {
        wrist_extension_deg: extensionMetric.toFixed(1),
        velocity_deg_s: velocity.toFixed(1),
        neutral_ready: frame.neutralReady ? "yes" : "no",
        movement_type: frame.movementType
      },
      warnings
    };
  }
}

class RadialUlnarDeviationEvaluator extends BaseExerciseEvaluator {
  constructor() {
    super({
      activeThreshold: 10,
      restThreshold: 4,
      velocityThreshold: 2,
      minHoldMs: 80,
      debounceFrames: 2
    });
  }

  process(frame: BiomechanicalFrame): FrameResult {
    const primary = Math.max(frame.radialDeviationDeg, frame.ulnarDeviationDeg);
    const { state, velocity } = this.updateState(Math.abs(primary), frame.timestampMs);
    const warnings = Math.max(frame.wristFlexionDeg, frame.wristExtensionDeg) > 35 ? ["Excess elbow movement"] : [];
    this.registerWarnings(warnings);
    return {
      exerciseName: "radial_ulnar_deviation",
      state,
      repCount: this.repCount,
      primaryMetric: primary,
      displayMetrics: {
        radial_deg: frame.radialDeviationDeg.toFixed(1),
        ulnar_deg: frame.ulnarDeviationDeg.toFixed(1),
        movement_type:
          frame.radialDeviationDeg >= frame.ulnarDeviationDeg ? "radial" : "ulnar",
        velocity_deg_s: velocity.toFixed(1)
      },
      warnings
    };
  }
}

class WristCircumductionEvaluator extends BaseExerciseEvaluator {
  private trajectory: Array<{ x: number; y: number }> = [];

  constructor() {
    super({
      activeThreshold: 25,
      restThreshold: 12,
      velocityThreshold: 4,
      minHoldMs: 50,
      debounceFrames: 2
    });
  }

  process(frame: BiomechanicalFrame): FrameResult {
    const rel = {
      x: frame.handLandmarks.middle_mcp.x - frame.handLandmarks.wrist.x,
      y: frame.handLandmarks.middle_mcp.y - frame.handLandmarks.wrist.y
    };
    this.trajectory.push(rel);
    if (this.trajectory.length > 120) {
      this.trajectory.shift();
    }
    const radius = Math.hypot(rel.x, rel.y);
    const { state, velocity } = this.updateState(radius, frame.timestampMs);
    let completeness = 0;
    if (this.trajectory.length >= 10) {
      const angles = this.trajectory.map((point) => Math.atan2(point.y, point.x));
      let total = 0;
      for (let index = 1; index < angles.length; index += 1) {
        let delta = angles[index] - angles[index - 1];
        if (delta > Math.PI) {
          delta -= Math.PI * 2;
        }
        if (delta < -Math.PI) {
          delta += Math.PI * 2;
        }
        total += Math.abs(delta);
      }
      completeness = Math.min(total / (Math.PI * 2), 1);
      if (completeness >= 0.95 && this.trajectory.length > 30) {
        this.forceRep(radius, frame.timestampMs, velocity);
        this.trajectory = [];
      }
    }
    return {
      exerciseName: "wrist_circumduction",
      state,
      repCount: this.repCount,
      primaryMetric: radius,
      displayMetrics: {
        radius_px: radius.toFixed(1),
        circle_completeness: completeness.toFixed(2),
        velocity_px_s: velocity.toFixed(1)
      },
      warnings: []
    };
  }
}

class PronationSupinationEvaluator extends BaseExerciseEvaluator {
  constructor() {
    super({
      activeThreshold: 18,
      restThreshold: 6,
      velocityThreshold: 3,
      minHoldMs: 60,
      debounceFrames: 2
    });
  }

  process(frame: BiomechanicalFrame): FrameResult {
    const primary = frame.pronationSupinationDeg;
    const { state, velocity } = this.updateState(Math.abs(primary), frame.timestampMs);
    const warnings = Math.max(frame.radialDeviationDeg, frame.ulnarDeviationDeg) > 20 ? ["Excess elbow movement"] : [];
    this.registerWarnings(warnings);
    const control = Math.max(0, 1 - Math.abs(velocity) / 180);
    return {
      exerciseName: "pronation_supination",
      state,
      repCount: this.repCount,
      primaryMetric: primary,
      displayMetrics: {
        rotation_deg: primary.toFixed(1),
        control_score: control.toFixed(2),
        velocity_deg_s: velocity.toFixed(1)
      },
      warnings
    };
  }
}

class GripStrengthEvaluator extends BaseExerciseEvaluator {
  constructor() {
    super({
      activeThreshold: 75,
      restThreshold: 30,
      holdThreshold: 85,
      velocityThreshold: 4,
      minHoldMs: 150,
      debounceFrames: 2
    });
  }

  process(frame: BiomechanicalFrame): FrameResult {
    const primary = mean([
      frame.fingerAngles.index.pip + (frame.fingerAngles.index.dip ?? 0),
      frame.fingerAngles.middle.pip + (frame.fingerAngles.middle.dip ?? 0),
      frame.fingerAngles.ring.pip + (frame.fingerAngles.ring.dip ?? 0),
      frame.fingerAngles.pinky.pip + (frame.fingerAngles.pinky.dip ?? 0)
    ]);
    const { state, velocity } = this.updateState(primary, frame.timestampMs);
    return {
      exerciseName: "grip_strength",
      state,
      repCount: this.repCount,
      primaryMetric: primary,
      displayMetrics: {
        closure_completeness: Math.min(primary / 140, 1).toFixed(2),
        hold_quality: Math.max(0, 1 - Math.abs(velocity) / 120).toFixed(2),
        velocity_deg_s: velocity.toFixed(1)
      },
      warnings: []
    };
  }
}

class TipPinchEvaluator extends BaseExerciseEvaluator {
  private readonly contactThreshold = 0.34;
  private readonly releaseThreshold = 0.52;
  private readonly minContactFrames = 2;
  private readonly minReleaseFrames = 2;
  private readonly minContactMs = 40;
  private contactFrames = 0;
  private releaseFrames = 0;
  private inContact = false;
  private contactStartedAt: number | null = null;

  constructor() {
    super();
  }

  process(frame: BiomechanicalFrame): FrameResult {
    const palmScale = mean([
      distance(frame.handLandmarks.wrist, frame.handLandmarks.index_mcp),
      distance(frame.handLandmarks.wrist, frame.handLandmarks.pinky_mcp),
      distance(frame.handLandmarks.index_mcp, frame.handLandmarks.pinky_mcp)
    ]);
    const rawDistance = frame.thumbDistancesPx.index;
    const normalizedDistance = rawDistance / Math.max(palmScale, 1);
    const { velocity } = this.updateState(normalizedDistance, frame.timestampMs);

    if (normalizedDistance <= this.contactThreshold) {
      this.contactFrames += 1;
      this.releaseFrames = 0;
      if (!this.inContact && this.contactFrames >= this.minContactFrames) {
        this.inContact = true;
        this.contactStartedAt = frame.timestampMs;
      }
    } else if (normalizedDistance >= this.releaseThreshold) {
      this.releaseFrames += 1;
      this.contactFrames = 0;
      if (this.inContact && this.releaseFrames >= this.minReleaseFrames) {
        if (
          this.contactStartedAt !== null &&
          frame.timestampMs - this.contactStartedAt >= this.minContactMs
        ) {
          this.forceRep(normalizedDistance, frame.timestampMs, velocity);
        }
        this.inContact = false;
        this.contactStartedAt = null;
      }
    } else {
      this.contactFrames = 0;
      this.releaseFrames = 0;
    }

    const state = this.inContact
      ? frame.timestampMs - (this.contactStartedAt ?? frame.timestampMs) >= 80
        ? "HOLD"
        : "ACTIVE"
      : "REST";

    return {
      exerciseName: "tip_pinch",
      state,
      repCount: this.repCount,
      primaryMetric: normalizedDistance,
      displayMetrics: {
        pinch_distance_px: rawDistance.toFixed(1),
        pinch_ratio: normalizedDistance.toFixed(2),
        pinch_precision: Math.max(
          0,
          Math.min(1, (this.releaseThreshold - normalizedDistance) / this.releaseThreshold)
        ).toFixed(2),
        hold_stability: this.windowStd(20).toFixed(3),
        velocity_ratio_s: velocity.toFixed(2)
      },
      warnings: []
    };
  }

  override buildSummary(name: ExerciseName): SessionSummary {
    return {
      ...super.buildSummary(name),
      contact_threshold_ratio: this.contactThreshold,
      release_threshold_ratio: this.releaseThreshold
    };
  }
}

class RubberBandExtensionEvaluator extends BaseExerciseEvaluator {
  constructor() {
    super({
      activeThreshold: 138,
      restThreshold: 110,
      velocityThreshold: 6,
      minHoldMs: 80,
      debounceFrames: 2
    });
  }

  process(frame: BiomechanicalFrame): FrameResult {
    const primary = frame.fingerSpreadPx;
    const { state, velocity } = this.updateState(primary, frame.timestampMs);
    return {
      exerciseName: "rubber_band_extension",
      state,
      repCount: this.repCount,
      primaryMetric: primary,
      displayMetrics: {
        max_extension_px: primary.toFixed(1),
        controlled_return: Math.max(0, 1 - Math.abs(velocity) / 250).toFixed(2),
        velocity_px_s: velocity.toFixed(1)
      },
      warnings: []
    };
  }
}

class StaticStretchEvaluator extends BaseExerciseEvaluator {
  constructor(private readonly exerciseName: ExerciseName, private readonly metricForFrame: (frame: BiomechanicalFrame) => number) {
    super({
      activeThreshold: 14,
      restThreshold: 6,
      holdThreshold: 18,
      velocityThreshold: 0.75,
      minHoldMs: 1000,
      debounceFrames: 3
    });
  }

  process(frame: BiomechanicalFrame): FrameResult {
    const primary = this.metricForFrame(frame);
    const { state, velocity } = this.updateState(primary, frame.timestampMs);
    const stability = this.windowStd(30);
    const warnings = stability > 4 ? ["Stretch not stable"] : [];
    this.registerWarnings(warnings);
    return {
      exerciseName: this.exerciseName,
      state,
      repCount: this.repCount,
      primaryMetric: primary,
      displayMetrics: {
        hold_metric: primary.toFixed(1),
        hold_stability: stability.toFixed(2),
        velocity_deg_s: velocity.toFixed(1)
      },
      warnings
    };
  }
}

export function createExerciseEvaluator(name: ExerciseName) {
  switch (name) {
    case "tendon_gliding":
    case "hand_arom_tendon_gliding_series":
      return new TendonGlidingEvaluator();
    case "pip_blocking":
    case "hand_arom_pip_blocking":
      return new PIPBlockingEvaluator();
    case "dip_blocking":
    case "hand_arom_dip_blocking":
      return new DIPBlockingEvaluator();
    case "finger_spreading":
    case "hand_prom_finger_extension":
      return new FingerSpreadingEvaluator();
    case "composite_finger_flexion":
    case "seated_finger_composite_flexion_stretch":
    case "hand_towel_scrunching":
      return new CompositeFingerFlexionEvaluator();
    case "thumb_opposition":
    case "seated_thumb_composite_flexion_arom":
      return new ThumbOppositionEvaluator();
    case "thumb_abduction":
    case "thumb_abduction_arom_on_table":
    case "seated_thumb_extension_with_resistance":
    case "thumb_radial_abduction_with_rubber_band_palm_down":
      return new ThumbAbductionEvaluator();
    case "wrist_extension":
    case "seated_wrist_extension_arom":
    case "seated_wrist_extension_with_dumbbell":
      return new WristExtensionEvaluator();
    case "radial_ulnar_deviation":
    case "wrist_arom_radial_and_ulnar_deviation":
    case "seated_wrist_radial_deviation_with_dumbbell":
      return new RadialUlnarDeviationEvaluator();
    case "wrist_circumduction":
    case "wrist_arom_wrist_circumduction":
      return new WristCircumductionEvaluator();
    case "pronation_supination":
    case "seated_forearm_pronation_and_supination_arom":
    case "forearm_pronation_and_supination_with_hammer":
      return new PronationSupinationEvaluator();
    case "grip_strength":
    case "seated_gripping_towel":
    case "putty_squeezes":
      return new GripStrengthEvaluator();
    case "tip_pinch":
    case "tip_pinch_with_putty":
      return new TipPinchEvaluator();
    case "rubber_band_extension":
    case "resisted_finger_extension_and_thumb_abduction":
      return new RubberBandExtensionEvaluator();
    case "wrist_flexion_stretch":
    case "standing_wrist_flexion_stretch":
    case "seated_wrist_flexion_prom_stretch":
      return new StaticStretchEvaluator("wrist_flexion_stretch", (frame) => frame.wristFlexionDeg);
    case "wrist_extension_stretch":
    case "standing_wrist_extension_stretch":
    case "seated_wrist_extension_prom":
      return new StaticStretchEvaluator(
        "wrist_extension_stretch",
        (frame) => frame.wristExtensionDeg
      );
    case "prayer_stretch":
    case "wrist_prayer_stretch_at_table":
      return new StaticStretchEvaluator(
        "prayer_stretch",
        (frame) => Math.max(frame.wristExtensionDeg, frame.wristFlexionDeg) + Math.max(frame.radialDeviationDeg, frame.ulnarDeviationDeg) * 0.5
      );
    case "wrist_flexion":
    case "seated_wrist_flexion_arom":
    case "seated_wrist_flexion_with_dumbbell":
    default:
      return new WristFlexionEvaluator();
  }
}

export function getExerciseOptions() {
  return EXERCISE_META;
}
