import type {
  BiomechanicalFrame,
  FingerAngles,
  HandLandmarks,
  Point3D,
  TrackingFrame
} from "@/lib/types";

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

function mean(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

export function computeBiomechanicalFrame(frame: TrackingFrame): BiomechanicalFrame | null {
  if (!frame.handLandmarks) {
    return null;
  }

  const landmarks = frame.handLandmarks;
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
      {
        x: landmarks.index_mcp.x - landmarks.wrist.x,
        y: landmarks.index_mcp.y - landmarks.wrist.y,
        z: landmarks.index_mcp.z - landmarks.wrist.z
      },
      {
        x: landmarks.pinky_mcp.x - landmarks.wrist.x,
        y: landmarks.pinky_mcp.y - landmarks.wrist.y,
        z: landmarks.pinky_mcp.z - landmarks.wrist.z
      }
    )
  );
  const pronationSupinationDeg =
    (Math.atan2(palmNormal.x, palmNormal.z || 1e-6) * 180) / Math.PI;

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
    wristAngleDeg,
    radialUlnarDeviationDeg,
    pronationSupinationDeg,
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
