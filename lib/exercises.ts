import type {
  BiomechanicalFrame,
  ExerciseName,
  ExerciseOption,
  FrameResult,
  SessionSummary
} from "@/lib/types";

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
    id: "tendon_gliding",
    label: "Tendon Gliding",
    description: "Sequence detection for open, hook, flat, and fist positions."
  },
  {
    id: "pip_blocking",
    label: "PIP Blocking",
    description: "Tracks isolated PIP flexion while penalizing MCP and DIP compensation."
  },
  {
    id: "dip_blocking",
    label: "DIP Blocking",
    description: "Tracks isolated DIP flexion with compensation monitoring."
  },
  {
    id: "finger_spreading",
    label: "Finger Spreading",
    description: "Measures fingertip spread and spread symmetry across the hand."
  },
  {
    id: "composite_finger_flexion",
    label: "Composite Finger Flexion",
    description: "Aggregates all finger joint flexion into a single total flexion score."
  },
  {
    id: "thumb_opposition",
    label: "Thumb Opposition",
    description: "Detects thumb-to-finger contact with precision and success-rate metrics."
  },
  {
    id: "thumb_abduction",
    label: "Thumb Abduction",
    description: "Measures radial thumb displacement relative to the index-wrist base."
  },
  {
    id: "wrist_flexion",
    label: "Wrist Flexion",
    description: "Realtime wrist angle tracking with repetition gating and form warnings."
  },
  {
    id: "wrist_extension",
    label: "Wrist Extension",
    description: "Extension tracking using inverted wrist-angle thresholding."
  },
  {
    id: "radial_ulnar_deviation",
    label: "Radial/Ulnar Deviation",
    description: "Lateral hand deviation relative to the forearm axis."
  },
  {
    id: "wrist_circumduction",
    label: "Wrist Circumduction",
    description: "Tracks circular hand trajectory completeness and smoothness."
  },
  {
    id: "pronation_supination",
    label: "Pronation/Supination",
    description: "Uses palm orientation to estimate forearm rotation control."
  },
  {
    id: "grip_strength",
    label: "Grip",
    description: "Measures finger curl closure completeness and hold quality."
  },
  {
    id: "tip_pinch",
    label: "Tip Pinch",
    description: "Thumb-index pinch precision with hold stability."
  },
  {
    id: "rubber_band_extension",
    label: "Rubber Band Extension",
    description: "Finger extension tracking with controlled return scoring."
  },
  {
    id: "wrist_flexion_stretch",
    label: "Wrist Flexion Stretch",
    description: "Static hold detection with stability monitoring."
  },
  {
    id: "wrist_extension_stretch",
    label: "Wrist Extension Stretch",
    description: "Static extension hold detection with stability scoring."
  },
  {
    id: "prayer_stretch",
    label: "Prayer Stretch",
    description: "Static prayer-position stretch with hold stability monitoring."
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

  protected updateState(primaryMetric: number, timestampMs: number) {
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

    const transition = this.stateMachine.update(primaryMetric, velocity, timestampMs);
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
      activeThreshold: 70,
      restThreshold: 35,
      velocityThreshold: 5,
      minHoldMs: 50,
      debounceFrames: 2
    });
  }

  process(frame: BiomechanicalFrame): FrameResult {
    const primary = frame.fingerAngles.index.pip;
    const { state, velocity } = this.updateState(primary, frame.timestampMs);
    const otherAngles = [frame.fingerAngles.index.mcp, frame.fingerAngles.index.dip ?? 0];
    const warnings = otherAngles.some((value) => value > 18) ? ["Compensatory finger motion"] : [];
    this.registerWarnings(warnings);
    return {
      exerciseName: "pip_blocking",
      state,
      repCount: this.repCount,
      primaryMetric: primary,
      displayMetrics: {
        pip_angle_deg: primary.toFixed(1),
        isolation_score: blockIsolationScore(primary, otherAngles).toFixed(2),
        velocity_deg_s: velocity.toFixed(1)
      },
      warnings
    };
  }
}

class DIPBlockingEvaluator extends BaseExerciseEvaluator {
  constructor() {
    super({
      activeThreshold: 55,
      restThreshold: 25,
      velocityThreshold: 4,
      minHoldMs: 50,
      debounceFrames: 2
    });
  }

  process(frame: BiomechanicalFrame): FrameResult {
    const primary = frame.fingerAngles.index.dip ?? 0;
    const { state, velocity } = this.updateState(primary, frame.timestampMs);
    const otherAngles = [frame.fingerAngles.index.mcp, frame.fingerAngles.index.pip];
    const warnings = otherAngles.some((value) => value > 18) ? ["Compensatory finger motion"] : [];
    this.registerWarnings(warnings);
    return {
      exerciseName: "dip_blocking",
      state,
      repCount: this.repCount,
      primaryMetric: primary,
      displayMetrics: {
        dip_angle_deg: primary.toFixed(1),
        isolation_score: blockIsolationScore(primary, otherAngles).toFixed(2),
        velocity_deg_s: velocity.toFixed(1)
      },
      warnings
    };
  }
}

class FingerSpreadingEvaluator extends BaseExerciseEvaluator {
  constructor() {
    super({
      activeThreshold: 145,
      restThreshold: 115,
      velocityThreshold: 8,
      minHoldMs: 50,
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
      activeThreshold: 500,
      restThreshold: 250,
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
      activeThreshold: -28,
      restThreshold: -42,
      holdThreshold: -28,
      velocityThreshold: 2,
      minHoldMs: 120,
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
      activeThreshold: 105,
      restThreshold: 75,
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
      activeThreshold: 36,
      restThreshold: 14,
      holdThreshold: 44,
      velocityThreshold: 6,
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
    const { state, velocity } = this.updateState(frame.wristAngleDeg, frame.timestampMs);
    const warnings = this.buildWarnings(frame);
    return {
      exerciseName: "wrist_flexion",
      state,
      repCount: this.repCount,
      primaryMetric: frame.wristAngleDeg,
      displayMetrics: {
        wrist_angle_deg: frame.wristAngleDeg.toFixed(1),
        velocity_deg_s: velocity.toFixed(1),
        deviation_deg: frame.radialUlnarDeviationDeg.toFixed(1)
      },
      warnings
    };
  }
}

class WristExtensionEvaluator extends WristFlexionEvaluator {
  constructor() {
    super(false);
  }

  override process(frame: BiomechanicalFrame): FrameResult {
    const extensionMetric = Math.max(0, 180 - frame.wristAngleDeg);
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
        deviation_deg: frame.radialUlnarDeviationDeg.toFixed(1)
      },
      warnings
    };
  }
}

class RadialUlnarDeviationEvaluator extends BaseExerciseEvaluator {
  constructor() {
    super({
      activeThreshold: 12,
      restThreshold: 5,
      velocityThreshold: 2,
      minHoldMs: 80,
      debounceFrames: 2
    });
  }

  process(frame: BiomechanicalFrame): FrameResult {
    const primary = frame.radialUlnarDeviationDeg;
    const { state, velocity } = this.updateState(Math.abs(primary), frame.timestampMs);
    const warnings = Math.abs(frame.wristAngleDeg) > 85 ? ["Excess elbow movement"] : [];
    this.registerWarnings(warnings);
    return {
      exerciseName: "radial_ulnar_deviation",
      state,
      repCount: this.repCount,
      primaryMetric: primary,
      displayMetrics: {
        deviation_deg: primary.toFixed(1),
        asymmetry_score: Math.abs(primary).toFixed(1),
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
      activeThreshold: 30,
      restThreshold: 12,
      velocityThreshold: 3,
      minHoldMs: 60,
      debounceFrames: 2
    });
  }

  process(frame: BiomechanicalFrame): FrameResult {
    const primary = frame.pronationSupinationDeg;
    const { state, velocity } = this.updateState(Math.abs(primary), frame.timestampMs);
    const warnings = Math.abs(frame.radialUlnarDeviationDeg) > 25 ? ["Excess elbow movement"] : [];
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
      activeThreshold: 70,
      restThreshold: 35,
      holdThreshold: 82,
      velocityThreshold: 4,
      minHoldMs: 150,
      debounceFrames: 2
    });
  }

  process(frame: BiomechanicalFrame): FrameResult {
    const primary = mean([
      frame.fingerAngles.index.pip,
      frame.fingerAngles.middle.pip,
      frame.fingerAngles.ring.pip,
      frame.fingerAngles.pinky.pip
    ]);
    const { state, velocity } = this.updateState(primary, frame.timestampMs);
    return {
      exerciseName: "grip_strength",
      state,
      repCount: this.repCount,
      primaryMetric: primary,
      displayMetrics: {
        closure_completeness: Math.min(primary / 90, 1).toFixed(2),
        hold_quality: Math.max(0, 1 - Math.abs(velocity) / 120).toFixed(2),
        velocity_deg_s: velocity.toFixed(1)
      },
      warnings: []
    };
  }
}

class TipPinchEvaluator extends BaseExerciseEvaluator {
  constructor() {
    super({
      activeThreshold: -26,
      restThreshold: -44,
      holdThreshold: -24,
      velocityThreshold: 2,
      minHoldMs: 120,
      debounceFrames: 2,
      invertMetric: true
    });
  }

  process(frame: BiomechanicalFrame): FrameResult {
    const primary = frame.thumbDistancesPx.index;
    const { state, velocity } = this.updateState(primary, frame.timestampMs);
    return {
      exerciseName: "tip_pinch",
      state,
      repCount: this.repCount,
      primaryMetric: primary,
      displayMetrics: {
        pinch_distance_px: primary.toFixed(1),
        pinch_precision: Math.max(0, 1 - primary / 52).toFixed(2),
        hold_stability: this.windowStd(20).toFixed(2),
        velocity_px_s: velocity.toFixed(1)
      },
      warnings: []
    };
  }
}

class RubberBandExtensionEvaluator extends BaseExerciseEvaluator {
  constructor() {
    super({
      activeThreshold: 150,
      restThreshold: 115,
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
      activeThreshold: 32,
      restThreshold: 12,
      holdThreshold: 36,
      velocityThreshold: 1,
      minHoldMs: 800,
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
      return new TendonGlidingEvaluator();
    case "pip_blocking":
      return new PIPBlockingEvaluator();
    case "dip_blocking":
      return new DIPBlockingEvaluator();
    case "finger_spreading":
      return new FingerSpreadingEvaluator();
    case "composite_finger_flexion":
      return new CompositeFingerFlexionEvaluator();
    case "thumb_opposition":
      return new ThumbOppositionEvaluator();
    case "thumb_abduction":
      return new ThumbAbductionEvaluator();
    case "wrist_extension":
      return new WristExtensionEvaluator();
    case "radial_ulnar_deviation":
      return new RadialUlnarDeviationEvaluator();
    case "wrist_circumduction":
      return new WristCircumductionEvaluator();
    case "pronation_supination":
      return new PronationSupinationEvaluator();
    case "grip_strength":
      return new GripStrengthEvaluator();
    case "tip_pinch":
      return new TipPinchEvaluator();
    case "rubber_band_extension":
      return new RubberBandExtensionEvaluator();
    case "wrist_flexion_stretch":
      return new StaticStretchEvaluator("wrist_flexion_stretch", (frame) => frame.wristAngleDeg);
    case "wrist_extension_stretch":
      return new StaticStretchEvaluator(
        "wrist_extension_stretch",
        (frame) => Math.max(0, 180 - frame.wristAngleDeg)
      );
    case "prayer_stretch":
      return new StaticStretchEvaluator(
        "prayer_stretch",
        (frame) => Math.abs(frame.wristAngleDeg) + Math.abs(frame.radialUlnarDeviationDeg) * 0.5
      );
    case "wrist_flexion":
    default:
      return new WristFlexionEvaluator();
  }
}

export function getExerciseOptions() {
  return EXERCISE_META;
}
