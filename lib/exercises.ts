import type { BiomechanicalFrame, ExerciseName, FrameResult, SessionSummary } from "@/lib/types";

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
    if (this.candidateState !== this.state && this.candidateFrames >= this.config.debounceFrames) {
      const previous = this.state;
      this.state = this.candidateState;
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

    return { state: this.state, repCompleted };
  }
}

abstract class BaseExerciseEvaluator {
  protected readonly stateMachine: ExerciseStateMachine;
  protected readonly measureHistory: number[] = [];
  protected readonly velocityHistory: number[] = [];
  protected readonly warningHistory: string[] = [];
  protected readonly repSamples: RepSample[] = [];
  protected readonly completedReps: SessionSummary["rep_details"] = [];
  protected repCount = 0;
  private previousValue = 0;
  private previousTimestampMs: number | null = null;

  constructor(stateConfig: StateMachineConfig) {
    this.stateMachine = new ExerciseStateMachine(stateConfig);
  }

  protected updateState(primaryMetric: number, timestampMs: number) {
    const dtSeconds =
      this.previousTimestampMs === null ? 0 : (timestampMs - this.previousTimestampMs) / 1000;
    const velocity = dtSeconds > 0 ? (primaryMetric - this.previousValue) / dtSeconds : 0;
    this.previousValue = primaryMetric;
    this.previousTimestampMs = timestampMs;
    this.measureHistory.push(primaryMetric);
    this.velocityHistory.push(velocity);

    const transition = this.stateMachine.update(primaryMetric, velocity, timestampMs);
    if (transition.state === "ACTIVE" || transition.state === "HOLD") {
      this.repSamples.push({ timestampMs, value: primaryMetric, velocity });
    }
    if (transition.repCompleted) {
      this.closeRep();
    }
    return { state: transition.state, velocity };
  }

  private closeRep() {
    if (this.repSamples.length < 2) {
      this.repSamples.length = 0;
      return;
    }
    const values = this.repSamples.map((sample) => sample.value);
    const avgVelocity =
      this.repSamples.reduce((sum, sample) => sum + Math.abs(sample.velocity), 0) /
      this.repSamples.length;
    const first = this.repSamples[0];
    const last = this.repSamples[this.repSamples.length - 1];
    this.completedReps.push({
      duration_s: (last.timestampMs - first.timestampMs) / 1000,
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
      accelerations.push(this.velocityHistory[index] - this.velocityHistory[index - 1]);
    }
    if (accelerations.length < 2) {
      return 0;
    }
    const mean =
      accelerations.reduce((sum, value) => sum + value, 0) / accelerations.length;
    return (
      accelerations.reduce((sum, value) => sum + (value - mean) ** 2, 0) / accelerations.length
    );
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

export class WristFlexionEvaluator extends BaseExerciseEvaluator {
  private baselineElbowY: number | null = null;

  constructor() {
    super({
      activeThreshold: 36,
      restThreshold: 14,
      holdThreshold: 44,
      velocityThreshold: 6,
      minHoldMs: 150,
      debounceFrames: 3
    });
  }

  process(frame: BiomechanicalFrame): FrameResult {
    const { state, velocity } = this.updateState(frame.wristAngleDeg, frame.timestampMs);
    const warnings: string[] = [];
    const pseudoElbowMotion = Math.abs(frame.radialUlnarDeviationDeg);
    if (pseudoElbowMotion > 25) {
      warnings.push("Excess elbow movement");
    }
    this.registerWarnings(warnings);
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

export class ThumbOppositionEvaluator extends BaseExerciseEvaluator {
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
    const targetEntry = Object.entries(frame.thumbDistancesPx).sort((a, b) => a[1] - b[1])[0];
    const [finger, distancePx] = targetEntry as [string, number];
    const { state, velocity } = this.updateState(distancePx, frame.timestampMs);
    if (state === "REST" && this.repSamples.length === 0 && distancePx <= 28) {
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
    const summary = super.buildSummary(name);
    return {
      ...summary,
      success_rate: this.repCount > 0 ? this.successfulContacts / this.repCount : 0,
      precision_threshold_px: 28
    };
  }
}

export function createExerciseEvaluator(name: ExerciseName) {
  if (name === "thumb_opposition") {
    return new ThumbOppositionEvaluator();
  }
  return new WristFlexionEvaluator();
}
