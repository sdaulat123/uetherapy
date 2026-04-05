import type {
  BiomechanicalFrame,
  FingerAngles,
  HandLabel,
  HandLandmarks,
  Point3D,
  TrackingFrame
} from "@/lib/types";

interface HandFrame3D {
  wrist: Point3D;
  forearmVec: Point3D;
  handVec: Point3D;
  lateralVec: Point3D;
  handNormal: Point3D;
}

interface WristMetrics {
  flexion: number;
  extension: number;
  radial: number;
  ulnar: number;
  flexionExtensionDeg: number;
  radialUlnarDeg: number;
  movementType: string;
  neutralReady: boolean;
}

function vector(a: Point3D, b: Point3D) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function magnitude(point: Point3D) {
  return Math.hypot(point.x, point.y, point.z);
}

export function distance(a: Point3D, b: Point3D) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function angleBetweenPoints(a: Point3D, b: Point3D, c: Point3D) {
  const ba = vector(a, b);
  const bc = vector(c, b);
  const denominator = magnitude(ba) * magnitude(bc);
  if (denominator === 0) {
    return 0;
  }
  const cosine =
    (ba.x * bc.x + ba.y * bc.y + ba.z * bc.z) / denominator;
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

function cross(a: Point3D, b: Point3D): Point3D {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function normalize(point: Point3D): Point3D {
  const norm = magnitude(point);
  if (norm === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  return { x: point.x / norm, y: point.y / norm, z: point.z / norm };
}

function projectOntoPlane(vectorToProject: Point3D, planeNormal: Point3D): Point3D {
  const normal = normalize(planeNormal);
  const scale =
    vectorToProject.x * normal.x + vectorToProject.y * normal.y + vectorToProject.z * normal.z;
  return {
    x: vectorToProject.x - normal.x * scale,
    y: vectorToProject.y - normal.y * scale,
    z: vectorToProject.z - normal.z * scale
  };
}

function signedAngleAroundAxis(fromVector: Point3D, toVector: Point3D, axisVector: Point3D) {
  const axis = normalize(axisVector);
  const fromProjected = projectOntoPlane(fromVector, axis);
  const toProjected = projectOntoPlane(toVector, axis);
  const fromNorm = normalize(fromProjected);
  const toNorm = normalize(toProjected);
  if (magnitude(fromNorm) === 0 || magnitude(toNorm) === 0 || magnitude(axis) === 0) {
    return 0;
  }
  const crossValue = cross(fromNorm, toNorm);
  const sine = crossValue.x * axis.x + crossValue.y * axis.y + crossValue.z * axis.z;
  const cosine = Math.max(
    -1,
    Math.min(1, fromNorm.x * toNorm.x + fromNorm.y * toNorm.y + fromNorm.z * toNorm.z)
  );
  return (Math.atan2(sine, cosine) * 180) / Math.PI;
}

function mean(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildHandFrame(worldLandmarks: HandLandmarks): HandFrame3D {
  const wrist = worldLandmarks.wrist;
  const middleMcp = worldLandmarks.middle_mcp;
  const indexMcp = worldLandmarks.index_mcp;
  const pinkyMcp = worldLandmarks.pinky_mcp;
  const forearmVec = normalize({
    x: middleMcp.x - wrist.x,
    y: middleMcp.y - wrist.y,
    z: middleMcp.z - wrist.z
  });
  const handVec = normalize({
    x: middleMcp.x - wrist.x,
    y: middleMcp.y - wrist.y,
    z: middleMcp.z - wrist.z
  });
  const lateralVec = normalize({
    x: indexMcp.x - pinkyMcp.x,
    y: indexMcp.y - pinkyMcp.y,
    z: indexMcp.z - pinkyMcp.z
  });
  let handNormal = normalize(cross(lateralVec, forearmVec));
  if (magnitude(handNormal) === 0) {
    handNormal = { x: 0, y: 0, z: 1 };
  }
  return {
    wrist,
    forearmVec,
    handVec,
    lateralVec,
    handNormal
  };
}

export class WristKinematicsAnalyzer {
  private readonly neutralFramesRequired: number;
  private readonly smoothingWindow: number;
  private neutralBuffers: Record<HandLabel, HandFrame3D[]> = {
    Left: [],
    Right: [],
    Unknown: []
  };
  private neutralFrames: Partial<Record<HandLabel, HandFrame3D>> = {};
  private histories: Record<
    HandLabel,
    { flexion: number[]; extension: number[]; radial: number[]; ulnar: number[] }
  > = {
    Left: { flexion: [], extension: [], radial: [], ulnar: [] },
    Right: { flexion: [], extension: [], radial: [], ulnar: [] },
    Unknown: { flexion: [], extension: [], radial: [], ulnar: [] }
  };

  constructor(smoothingWindow = 7, neutralFramesRequired = 20) {
    this.smoothingWindow = smoothingWindow;
    this.neutralFramesRequired = neutralFramesRequired;
  }

  reset() {
    this.neutralBuffers = { Left: [], Right: [], Unknown: [] };
    this.neutralFrames = {};
    this.histories = {
      Left: { flexion: [], extension: [], radial: [], ulnar: [] },
      Right: { flexion: [], extension: [], radial: [], ulnar: [] },
      Unknown: { flexion: [], extension: [], radial: [], ulnar: [] }
    };
  }

  private averageFrame(frames: HandFrame3D[]): HandFrame3D {
    const averagePoint = (selector: (frame: HandFrame3D) => Point3D): Point3D =>
      normalize({
        x: mean(frames.map((frame) => selector(frame).x)),
        y: mean(frames.map((frame) => selector(frame).y)),
        z: mean(frames.map((frame) => selector(frame).z))
      });

    return {
      wrist: {
        x: mean(frames.map((frame) => frame.wrist.x)),
        y: mean(frames.map((frame) => frame.wrist.y)),
        z: mean(frames.map((frame) => frame.wrist.z))
      },
      forearmVec: averagePoint((frame) => frame.forearmVec),
      handVec: averagePoint((frame) => frame.handVec),
      lateralVec: averagePoint((frame) => frame.lateralVec),
      handNormal: averagePoint((frame) => frame.handNormal)
    };
  }

  private smooth(
    handedness: HandLabel,
    key: "flexion" | "extension" | "radial" | "ulnar",
    value: number
  ) {
    const samples = this.histories[handedness][key];
    samples.push(value);
    if (samples.length > this.smoothingWindow) {
      samples.shift();
    }
    return mean(samples);
  }

  measure(handedness: HandLabel, worldLandmarks: HandLandmarks): WristMetrics {
    const liveFrame = buildHandFrame(worldLandmarks);
    if (!this.neutralFrames[handedness]) {
      if (this.neutralBuffers[handedness].length < this.neutralFramesRequired) {
        this.neutralBuffers[handedness].push(liveFrame);
      }
      if (this.neutralBuffers[handedness].length === this.neutralFramesRequired) {
        this.neutralFrames[handedness] = this.averageFrame(this.neutralBuffers[handedness]);
      }
    }

    const reference = this.neutralFrames[handedness] ?? null;
    let flexion = 0;
    let extension = 0;
    let radial = 0;
    let ulnar = 0;

    if (reference) {
      const handednessSign = handedness === "Right" ? 1 : handedness === "Left" ? -1 : 1;
      const currentNormalSagittal = projectOntoPlane(liveFrame.handNormal, reference.lateralVec);
      const referenceNormalSagittal = projectOntoPlane(reference.handNormal, reference.lateralVec);
      const flexExtSigned = signedAngleAroundAxis(
        referenceNormalSagittal,
        currentNormalSagittal,
        reference.lateralVec
      );

      const currentForearmCoronal = projectOntoPlane(liveFrame.forearmVec, reference.handNormal);
      const referenceForearmCoronal = projectOntoPlane(reference.forearmVec, reference.handNormal);
      const deviationSigned = signedAngleAroundAxis(
        referenceForearmCoronal,
        currentForearmCoronal,
        reference.handNormal
      ) * handednessSign;

      flexion = Math.max(0, flexExtSigned);
      extension = Math.max(0, -flexExtSigned);
      radial = Math.max(0, -deviationSigned);
      ulnar = Math.max(0, deviationSigned);
    }

    const smoothedFlexion = this.smooth(handedness, "flexion", flexion);
    const smoothedExtension = this.smooth(handedness, "extension", extension);
    const smoothedRadial = this.smooth(handedness, "radial", radial);
    const smoothedUlnar = this.smooth(handedness, "ulnar", ulnar);

    const movementCandidates = {
      flexion: smoothedFlexion,
      extension: smoothedExtension,
      radial: smoothedRadial,
      ulnar: smoothedUlnar
    };
    const [movementType, peak] = Object.entries(movementCandidates).sort((a, b) => b[1] - a[1])[0];

    return {
      flexion: smoothedFlexion,
      extension: smoothedExtension,
      radial: smoothedRadial,
      ulnar: smoothedUlnar,
      flexionExtensionDeg: Math.max(smoothedFlexion, smoothedExtension),
      radialUlnarDeg: Math.max(smoothedRadial, smoothedUlnar),
      movementType: peak >= 6 ? movementType : "neutral",
      neutralReady: reference !== null
    };
  }
}

export function computeFingerAngles(landmarks: HandLandmarks): BiomechanicalFrame["fingerAngles"] {
  const wrist = landmarks.wrist;
  return {
    index: {
      mcp: angleBetweenPoints(wrist, landmarks.index_mcp, landmarks.index_pip),
      pip: angleBetweenPoints(landmarks.index_mcp, landmarks.index_pip, landmarks.index_dip),
      dip: angleBetweenPoints(landmarks.index_pip, landmarks.index_dip, landmarks.index_tip)
    },
    middle: {
      mcp: angleBetweenPoints(wrist, landmarks.middle_mcp, landmarks.middle_pip),
      pip: angleBetweenPoints(landmarks.middle_mcp, landmarks.middle_pip, landmarks.middle_dip),
      dip: angleBetweenPoints(landmarks.middle_pip, landmarks.middle_dip, landmarks.middle_tip)
    },
    ring: {
      mcp: angleBetweenPoints(wrist, landmarks.ring_mcp, landmarks.ring_pip),
      pip: angleBetweenPoints(landmarks.ring_mcp, landmarks.ring_pip, landmarks.ring_dip),
      dip: angleBetweenPoints(landmarks.ring_pip, landmarks.ring_dip, landmarks.ring_tip)
    },
    pinky: {
      mcp: angleBetweenPoints(wrist, landmarks.pinky_mcp, landmarks.pinky_pip),
      pip: angleBetweenPoints(landmarks.pinky_mcp, landmarks.pinky_pip, landmarks.pinky_dip),
      dip: angleBetweenPoints(landmarks.pinky_pip, landmarks.pinky_dip, landmarks.pinky_tip)
    },
    thumb: {
      mcp: angleBetweenPoints(landmarks.thumb_cmc, landmarks.thumb_mcp, landmarks.thumb_ip),
      pip: 0,
      ip: angleBetweenPoints(landmarks.thumb_mcp, landmarks.thumb_ip, landmarks.thumb_tip)
    }
  };
}

export function computeBiomechanicalFrame(
  frame: TrackingFrame,
  wristAnalyzer?: WristKinematicsAnalyzer
): BiomechanicalFrame | null {
  if (!frame.handLandmarks) {
    return null;
  }

  const landmarks = frame.handLandmarks;
  const worldLandmarks = frame.handWorldLandmarks ?? frame.handLandmarks;
  const elbowPoint =
    frame.elbowPoint ??
    ({
      x: landmarks.wrist.x,
      y: Math.max(0, landmarks.wrist.y - frame.imageHeight * 0.25),
      z: landmarks.wrist.z
    } satisfies Point3D);

  const wristAngleDeg = angleBetweenPoints(elbowPoint, landmarks.wrist, landmarks.middle_mcp);
  const forearm = {
    x: landmarks.wrist.x - elbowPoint.x,
    y: landmarks.wrist.y - elbowPoint.y,
    z: 0
  };
  const hand = {
    x: landmarks.middle_mcp.x - landmarks.wrist.x,
    y: landmarks.middle_mcp.y - landmarks.wrist.y,
    z: 0
  };
  const forearmMag = Math.hypot(forearm.x, forearm.y);
  const handMag = Math.hypot(hand.x, hand.y);
  const radialUlnarDeviationDeg =
    forearmMag === 0 || handMag === 0
      ? 0
      : (Math.asin(
          Math.max(
            -1,
            Math.min(1, (forearm.x * hand.y - forearm.y * hand.x) / (forearmMag * handMag))
          )
        ) *
          180) /
        Math.PI;

  const palmNormal = normalize(
    cross(
      vector(landmarks.index_mcp, landmarks.wrist),
      vector(landmarks.pinky_mcp, landmarks.wrist)
    )
  );
  const pronationSupinationDeg =
    (Math.atan2(palmNormal.x, palmNormal.z || 1e-6) * 180) / Math.PI;
  const wristMetrics = wristAnalyzer?.measure(frame.handedness, worldLandmarks) ?? {
    flexion: 0,
    extension: 0,
    radial: 0,
    ulnar: 0,
    flexionExtensionDeg: wristAngleDeg,
    radialUlnarDeg: Math.abs(radialUlnarDeviationDeg),
    movementType: "neutral",
    neutralReady: false
  };

  const fingertips = [
    landmarks.thumb_tip,
    landmarks.index_tip,
    landmarks.middle_tip,
    landmarks.ring_tip,
    landmarks.pinky_tip
  ];
  const distances: number[] = [];
  for (let index = 0; index < fingertips.length; index += 1) {
    for (let inner = index + 1; inner < fingertips.length; inner += 1) {
      distances.push(distance(fingertips[index], fingertips[inner]));
    }
  }

  return {
    timestampMs: frame.timestampMs,
    handedness: frame.handedness,
    handLandmarks: landmarks,
    handWorldLandmarks: worldLandmarks,
    elbowPoint: frame.elbowPoint,
    wristAngleDeg,
    radialUlnarDeviationDeg,
    pronationSupinationDeg,
    wristFlexionDeg: wristMetrics.flexion,
    wristExtensionDeg: wristMetrics.extension,
    radialDeviationDeg: wristMetrics.radial,
    ulnarDeviationDeg: wristMetrics.ulnar,
    movementType: wristMetrics.movementType,
    neutralReady: wristMetrics.neutralReady,
    fingerSpreadPx: mean(distances),
    thumbDistancesPx: {
      index: distance(landmarks.thumb_tip, landmarks.index_tip),
      middle: distance(landmarks.thumb_tip, landmarks.middle_tip),
      ring: distance(landmarks.thumb_tip, landmarks.ring_tip),
      pinky: distance(landmarks.thumb_tip, landmarks.pinky_tip)
    },
    fingerAngles: computeFingerAngles(landmarks)
  };
}

export function normalizedLandmarksToPixels(
  landmarks: Array<{ x: number; y: number; z: number }>,
  width: number,
  height: number
): HandLandmarks {
  return {
    wrist: { x: landmarks[0].x * width, y: landmarks[0].y * height, z: landmarks[0].z * width },
    thumb_cmc: { x: landmarks[1].x * width, y: landmarks[1].y * height, z: landmarks[1].z * width },
    thumb_mcp: { x: landmarks[2].x * width, y: landmarks[2].y * height, z: landmarks[2].z * width },
    thumb_ip: { x: landmarks[3].x * width, y: landmarks[3].y * height, z: landmarks[3].z * width },
    thumb_tip: { x: landmarks[4].x * width, y: landmarks[4].y * height, z: landmarks[4].z * width },
    index_mcp: { x: landmarks[5].x * width, y: landmarks[5].y * height, z: landmarks[5].z * width },
    index_pip: { x: landmarks[6].x * width, y: landmarks[6].y * height, z: landmarks[6].z * width },
    index_dip: { x: landmarks[7].x * width, y: landmarks[7].y * height, z: landmarks[7].z * width },
    index_tip: { x: landmarks[8].x * width, y: landmarks[8].y * height, z: landmarks[8].z * width },
    middle_mcp: { x: landmarks[9].x * width, y: landmarks[9].y * height, z: landmarks[9].z * width },
    middle_pip: { x: landmarks[10].x * width, y: landmarks[10].y * height, z: landmarks[10].z * width },
    middle_dip: { x: landmarks[11].x * width, y: landmarks[11].y * height, z: landmarks[11].z * width },
    middle_tip: { x: landmarks[12].x * width, y: landmarks[12].y * height, z: landmarks[12].z * width },
    ring_mcp: { x: landmarks[13].x * width, y: landmarks[13].y * height, z: landmarks[13].z * width },
    ring_pip: { x: landmarks[14].x * width, y: landmarks[14].y * height, z: landmarks[14].z * width },
    ring_dip: { x: landmarks[15].x * width, y: landmarks[15].y * height, z: landmarks[15].z * width },
    ring_tip: { x: landmarks[16].x * width, y: landmarks[16].y * height, z: landmarks[16].z * width },
    pinky_mcp: { x: landmarks[17].x * width, y: landmarks[17].y * height, z: landmarks[17].z * width },
    pinky_pip: { x: landmarks[18].x * width, y: landmarks[18].y * height, z: landmarks[18].z * width },
    pinky_dip: { x: landmarks[19].x * width, y: landmarks[19].y * height, z: landmarks[19].z * width },
    pinky_tip: { x: landmarks[20].x * width, y: landmarks[20].y * height, z: landmarks[20].z * width }
  };
}

export function normalizedLandmarksToWorld(
  landmarks: Array<{ x: number; y: number; z: number }>
): HandLandmarks {
  return {
    wrist: { x: landmarks[0].x, y: landmarks[0].y, z: landmarks[0].z },
    thumb_cmc: { x: landmarks[1].x, y: landmarks[1].y, z: landmarks[1].z },
    thumb_mcp: { x: landmarks[2].x, y: landmarks[2].y, z: landmarks[2].z },
    thumb_ip: { x: landmarks[3].x, y: landmarks[3].y, z: landmarks[3].z },
    thumb_tip: { x: landmarks[4].x, y: landmarks[4].y, z: landmarks[4].z },
    index_mcp: { x: landmarks[5].x, y: landmarks[5].y, z: landmarks[5].z },
    index_pip: { x: landmarks[6].x, y: landmarks[6].y, z: landmarks[6].z },
    index_dip: { x: landmarks[7].x, y: landmarks[7].y, z: landmarks[7].z },
    index_tip: { x: landmarks[8].x, y: landmarks[8].y, z: landmarks[8].z },
    middle_mcp: { x: landmarks[9].x, y: landmarks[9].y, z: landmarks[9].z },
    middle_pip: { x: landmarks[10].x, y: landmarks[10].y, z: landmarks[10].z },
    middle_dip: { x: landmarks[11].x, y: landmarks[11].y, z: landmarks[11].z },
    middle_tip: { x: landmarks[12].x, y: landmarks[12].y, z: landmarks[12].z },
    ring_mcp: { x: landmarks[13].x, y: landmarks[13].y, z: landmarks[13].z },
    ring_pip: { x: landmarks[14].x, y: landmarks[14].y, z: landmarks[14].z },
    ring_dip: { x: landmarks[15].x, y: landmarks[15].y, z: landmarks[15].z },
    ring_tip: { x: landmarks[16].x, y: landmarks[16].y, z: landmarks[16].z },
    pinky_mcp: { x: landmarks[17].x, y: landmarks[17].y, z: landmarks[17].z },
    pinky_pip: { x: landmarks[18].x, y: landmarks[18].y, z: landmarks[18].z },
    pinky_dip: { x: landmarks[19].x, y: landmarks[19].y, z: landmarks[19].z },
    pinky_tip: { x: landmarks[20].x, y: landmarks[20].y, z: landmarks[20].z }
  };
}
