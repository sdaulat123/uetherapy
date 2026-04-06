"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import {
  DrawingUtils,
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker
} from "@mediapipe/tasks-vision";

import {
  computeBiomechanicalFrame,
  normalizedLandmarksToPixels,
  normalizedLandmarksToWorld,
  WristKinematicsAnalyzer
} from "@/lib/biomechanics";
import { createExerciseEvaluator, getExerciseOptions } from "@/lib/exercises";
import type {
  ExerciseName,
  FrameResult,
  HandLabel,
  SessionSummary,
  TrackingFrame
} from "@/lib/types";

const EXERCISE_OPTIONS = getExerciseOptions();
const EXERCISE_GROUPS = EXERCISE_OPTIONS.reduce<Record<string, typeof EXERCISE_OPTIONS>>(
  (groups, option) => {
    groups[option.group] ??= [];
    groups[option.group].push(option);
    return groups;
  },
  {}
);

interface DetectorBundle {
  hand: HandLandmarker;
  pose: PoseLandmarker;
}

type HandSlot = "hand_0" | "hand_1";
type HandResultMap = Partial<Record<HandSlot, FrameResult>>;
type HandSummaryMap = Partial<Record<HandSlot, SessionSummary>>;

function createEvaluatorMap(exercise: ExerciseName) {
  return {
    hand_0: createExerciseEvaluator(exercise),
    hand_1: createExerciseEvaluator(exercise)
  };
}

function mirrorLandmarksForDisplay<T extends { x: number; y: number; z?: number }>(
  landmarks: T[]
) {
  return landmarks.map((landmark) => ({
    ...landmark,
    x: 1 - landmark.x
  }));
}

export function MotionDashboard() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<DetectorBundle | null>(null);
  const evaluatorRef = useRef(createEvaluatorMap("seated_wrist_flexion_arom"));
  const wristAnalyzerRef = useRef(new WristKinematicsAnalyzer());
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastHudUpdateRef = useRef(0);

  const [exercise, setExercise] = useState<ExerciseName>("seated_wrist_flexion_arom");
  const [status, setStatus] = useState("Initializing browser tracker...");
  const [isRunning, setIsRunning] = useState(false);
  const [frameResults, setFrameResults] = useState<HandResultMap>({});
  const [sessionSummaries, setSessionSummaries] = useState<HandSummaryMap>({});
  const [permissionError, setPermissionError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function setup() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        const hand = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
          },
          runningMode: "VIDEO",
          numHands: 2
        });
        const pose = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
          },
          runningMode: "VIDEO",
          numPoses: 1
        });
        if (!isMounted) {
          hand.close();
          pose.close();
          return;
        }
        detectorRef.current = { hand, pose };
        setStatus("Requesting camera access...");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setPermissionError(null);
        setStatus("Camera live. Begin movement when ready.");
        setIsRunning(true);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to initialize tracking.";
        setPermissionError(message);
        setStatus("Tracker unavailable.");
      }
    }

    setup();

    return () => {
      isMounted = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      detectorRef.current?.hand.close();
      detectorRef.current?.pose.close();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    evaluatorRef.current = createEvaluatorMap(exercise);
    wristAnalyzerRef.current.reset();
    setFrameResults({});
    setSessionSummaries({});
    setStatus("Exercise switched. Neutral baseline recalibrating.");
  }, [exercise]);

  useEffect(() => {
    if (!isRunning || !videoRef.current || !canvasRef.current || !detectorRef.current) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    if (!context) {
      setStatus("Canvas context unavailable.");
      return;
    }

    const drawer = new DrawingUtils(context);

    const renderLoop = () => {
      const detectors = detectorRef.current;
      if (!detectors || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(renderLoop);
        return;
      }

      const timestampMs = performance.now();
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.scale(-1, 1);
      context.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
      context.restore();

        const handResult = detectors.hand.detectForVideo(video, timestampMs);
        const poseResult = detectors.pose.detectForVideo(video, timestampMs);

      const nextResults: HandResultMap = {};
      const nextSummaries: HandSummaryMap = {};
      const detectedHands = handResult.landmarks.length;
      const elbowPointValue =
        poseResult.landmarks.length > 0
          ? {
              x: poseResult.landmarks[0][14].x * canvas.width,
              y: poseResult.landmarks[0][14].y * canvas.height,
              z: poseResult.landmarks[0][14].z * canvas.width
            }
          : null;

      if (detectedHands > 0) {
        handResult.landmarks.forEach((landmarks, index) => {
          const slot = handSlots[index] ?? "hand_1";
          const handedness =
            (handResult.handednesses?.[index]?.[0]?.categoryName as HandLabel | undefined) ??
            "Unknown";
          const mirroredLandmarks = mirrorLandmarksForDisplay(landmarks);
          drawer.drawConnectors(mirroredLandmarks, HandLandmarker.HAND_CONNECTIONS, {
            color: handedness === "Left" ? "#43d9b1" : "#ffbd73",
            lineWidth: 3
          });
          drawer.drawLandmarks(mirroredLandmarks, {
            color: "#0b2f27",
            fillColor: handedness === "Left" ? "#fdf4dc" : "#e6f1ff",
            radius: 4
          });

          const trackingFrame: TrackingFrame = {
            timestampMs,
            handedness,
            handLandmarks: normalizedLandmarksToPixels(landmarks, canvas.width, canvas.height),
            handWorldLandmarks: handResult.worldLandmarks?.[index]
              ? normalizedLandmarksToWorld(handResult.worldLandmarks[index])
              : null,
            elbowPoint: elbowPointValue,
            imageWidth: canvas.width,
            imageHeight: canvas.height
          };

          const biomechanicalFrame = computeBiomechanicalFrame(
            trackingFrame,
            wristAnalyzerRef.current
          );
          if (!biomechanicalFrame) {
            return;
          }
          const result = evaluatorRef.current[slot].process(biomechanicalFrame);
          const summary = evaluatorRef.current[slot].buildSummary(exercise);
          result.handedness = handedness;
          summary.handedness = handedness;
          nextResults[slot] = result;
          nextSummaries[slot] = summary;
        });

        drawHud(context, nextResults, nextSummaries);
        if (timestampMs - lastHudUpdateRef.current > 80) {
          lastHudUpdateRef.current = timestampMs;
          startTransition(() => {
            setFrameResults(nextResults);
            setSessionSummaries(nextSummaries);
            const neutralPending = Object.values(nextResults).some(
              (result) => result?.displayMetrics?.neutral_ready === "no"
            );
            setStatus(
              neutralPending
                ? "Collecting neutral wrist baseline. Hold both hands comfortably."
                : `Tracking live for ${detectedHands} hand${detectedHands > 1 ? "s" : ""}.`
            );
          });
        }
      } else {
        drawIdleHud(context);
        if (timestampMs - lastHudUpdateRef.current > 160) {
          lastHudUpdateRef.current = timestampMs;
          startTransition(() => {
            setStatus("Hand not visible. Center the working hand in frame.");
            setFrameResults({});
            setSessionSummaries({});
          });
        }
      }

      rafRef.current = requestAnimationFrame(renderLoop);
    };

    rafRef.current = requestAnimationFrame(renderLoop);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [exercise, isRunning]);

  function exportSession() {
    const summary = {
      exercise,
      hands: {
        hand_0: evaluatorRef.current.hand_0.buildSummary(exercise),
        hand_1: evaluatorRef.current.hand_1.buildSummary(exercise)
      }
    };
    const blob = new Blob([JSON.stringify(summary, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${exercise}_session.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main style={styles.page}>
      <section style={styles.grid}>
        <article style={styles.viewportCard}>
          <div style={styles.videoShell}>
            <video ref={videoRef} playsInline muted style={styles.video} />
            <canvas ref={canvasRef} style={styles.canvas} />
          </div>
          {permissionError ? <p style={styles.errorText}>{permissionError}</p> : null}
        </article>

        <aside style={styles.sidebar}>
          <section style={styles.panel}>
            <h2 style={styles.sectionTitle}>Exercise Mode</h2>
            <p style={styles.sectionCopy}>
              All requested rehabilitation exercises are available in the browser runtime through a
              shared biomechanics and state-machine layer.
            </p>
            <label style={styles.fieldLabel} htmlFor="exercise-select">
              Active exercise
            </label>
            <select
              id="exercise-select"
              value={exercise}
              onChange={(event) => setExercise(event.target.value as ExerciseName)}
              style={styles.select}
            >
              {Object.entries(EXERCISE_GROUPS).map(([group, options]) => (
                <optgroup key={group} label={group}>
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p style={styles.exerciseDescription}>
              {EXERCISE_OPTIONS.find((option) => option.id === exercise)?.description}
            </p>
            <div style={styles.buttonRow}>
              <button style={styles.primaryButton} onClick={exportSession} type="button">
                Export JSON
              </button>
              <button
                style={styles.secondaryButton}
                onClick={() => {
                  evaluatorRef.current = createEvaluatorMap(exercise);
                  wristAnalyzerRef.current.reset();
                  setFrameResults({});
                  setSessionSummaries({});
                  setStatus("Session reset. Neutral baseline recalibrating.");
                }}
                type="button"
              >
                Reset Session
              </button>
            </div>
          </section>

          {Object.keys(frameResults).length ? (
            <>
              <section style={styles.metricsGrid}>
                <MetricCard
                  label="Reps"
                  value={`${frameResults.hand_0?.repCount ?? 0} / ${frameResults.hand_1?.repCount ?? 0}`}
                  accent="var(--accent)"
                />
                <MetricCard
                  label="Hands"
                  value={Object.keys(frameResults).length}
                  accent="#d6885b"
                />
                <MetricCard
                  label="Primary"
                  value={`H1 ${frameResults.hand_0 ? Number(frameResults.hand_0.primaryMetric).toFixed(1) : "-"} | H2 ${frameResults.hand_1 ? Number(frameResults.hand_1.primaryMetric).toFixed(1) : "-"}`}
                  accent="#0f5a46"
                />
                <MetricCard
                  label="ROM"
                  value={`H1 ${sessionSummaries.hand_0 ? sessionSummaries.hand_0.rom.toFixed(1) : "0.0"} | H2 ${sessionSummaries.hand_1 ? sessionSummaries.hand_1.rom.toFixed(1) : "0.0"}`}
                  accent="#5949a8"
                />
              </section>

              <section style={styles.panel}>
                <h2 style={styles.sectionTitle}>Live Metrics</h2>
                <div style={styles.handPanels}>
                  {handSlots.map((hand) =>
                    frameResults[hand] ? (
                      <div key={hand} style={styles.handPanel}>
                        <h3 style={styles.handPanelTitle}>
                          {(frameResults[hand]?.handedness ?? "Unknown")} ({hand === "hand_0" ? "Hand 1" : "Hand 2"}): {frameResults[hand]?.state}
                        </h3>
                        <div style={styles.metricList}>
                          {Object.entries(frameResults[hand]!.displayMetrics).map(([key, value]) => (
                            <div key={`${hand}-${key}`} style={styles.metricRow}>
                              <span style={styles.metricLabel}>{key.replaceAll("_", " ")}</span>
                              <span style={styles.metricValue}>{String(value)}</span>
                            </div>
                          ))}
                        </div>
                        {frameResults[hand]!.warnings.length ? (
                          <div style={styles.warningStack}>
                            {frameResults[hand]!.warnings.map((warning) => (
                              <div key={`${hand}-${warning}`} style={styles.warningCard}>
                                {warning}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null
                  )}
                </div>
              </section>
            </>
          ) : null}

          {Object.keys(sessionSummaries).length ? (
            <section style={styles.panel}>
              <h2 style={styles.sectionTitle}>Session Output</h2>
              <pre style={styles.jsonPreview}>
                {JSON.stringify({ exercise, hands: sessionSummaries }, null, 2)}
              </pre>
            </section>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

function MetricCard({
  label,
  value,
  accent
}: {
  label: string;
  value: string | number;
  accent: string;
}) {
  return (
    <div style={{ ...styles.metricCard, borderTopColor: accent }}>
      <span style={styles.metricCardLabel}>{label}</span>
      <strong style={styles.metricCardValue}>{value}</strong>
    </div>
  );
}

function drawHud(
  context: CanvasRenderingContext2D,
  results: HandResultMap,
  summaries: HandSummaryMap
) {
  (Object.entries(results) as Array<[HandSlot, FrameResult]>).forEach(([hand, result], panelIndex) => {
    const summary = summaries[hand];
    const left = 20 + panelIndex * 330;
    context.fillStyle = "rgba(17, 21, 18, 0.72)";
    context.fillRect(left, 20, 310, 170);
    context.fillStyle = "#f5efe3";
    context.font = '600 18px var(--font-sans), sans-serif';
    context.fillText(
      `${result.handedness ?? "Unknown"} ${panelIndex + 1} ${result.exerciseName.replaceAll("_", " ")}`,
      left + 16,
      50
    );
    context.font = '400 14px var(--font-mono), monospace';
    const lines = [
      `State: ${result.state}`,
      `Reps: ${result.repCount}`,
      `Primary: ${result.primaryMetric.toFixed(1)}`,
      `ROM: ${summary ? summary.rom.toFixed(1) : "0.0"}`,
      `Avg velocity: ${summary ? summary.avg_velocity.toFixed(1) : "0.0"}`
    ];
    lines.forEach((line, index) => {
      context.fillText(line, left + 16, 82 + index * 24);
    });
    if (result.warnings.length > 0) {
      context.fillStyle = "#ffb08f";
      context.fillText(result.warnings[0], left + 16, 82 + lines.length * 24);
    }
  });
}

function drawIdleHud(context: CanvasRenderingContext2D) {
  context.fillStyle = "rgba(17, 21, 18, 0.6)";
  context.fillRect(20, 20, 340, 88);
  context.fillStyle = "#f5efe3";
  context.font = '600 16px var(--font-sans), sans-serif';
  context.fillText("Place one or both hands inside the camera frame.", 32, 56);
  context.font = '400 13px var(--font-mono), monospace';
  context.fillText("Lighting and contrast materially affect hand tracking.", 32, 82);
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: "40px 32px 56px"
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.4fr) minmax(360px, 0.9fr)",
    gap: 24
  },
  viewportCard: {
    border: "1px solid var(--line)",
    borderRadius: 32,
    background: "var(--panel)",
    boxShadow: "var(--shadow)",
    padding: 22,
    backdropFilter: "blur(10px)"
  },
  sectionTitle: {
    margin: 0,
    fontSize: 22
  },
  sectionCopy: {
    margin: "8px 0 0",
    color: "var(--muted)",
    lineHeight: 1.5
  },
  videoShell: {
    position: "relative",
    width: "100%",
    aspectRatio: "16 / 10",
    borderRadius: 28,
    overflow: "hidden",
    background: "#141310"
  },
  video: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: "scaleX(-1)"
  },
  canvas: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%"
  },
  errorText: {
    color: "var(--warning)",
    marginTop: 14
  },
  sidebar: {
    display: "grid",
    gap: 18
  },
  panel: {
    border: "1px solid var(--line)",
    borderRadius: 26,
    background: "var(--panel)",
    padding: 20,
    boxShadow: "var(--shadow)"
  },
  fieldLabel: {
    display: "block",
    fontSize: 13,
    color: "var(--muted)",
    margin: "18px 0 8px"
  },
  select: {
    width: "100%",
    borderRadius: 18,
    border: "1px solid var(--line)",
    background: "var(--panel-strong)",
    padding: "14px 16px"
  },
  exerciseDescription: {
    margin: "12px 0 0",
    color: "var(--muted)",
    lineHeight: 1.5
  },
  buttonRow: {
    display: "flex",
    gap: 12,
    marginTop: 18,
    flexWrap: "wrap"
  },
  primaryButton: {
    border: 0,
    borderRadius: 999,
    padding: "13px 18px",
    background: "var(--accent)",
    color: "#fffaf3",
    cursor: "pointer"
  },
  secondaryButton: {
    borderRadius: 999,
    padding: "13px 18px",
    background: "transparent",
    border: "1px solid var(--line)",
    color: "var(--ink)",
    cursor: "pointer"
  },
  metricsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 14
  },
  metricCard: {
    background: "var(--panel)",
    borderRadius: 22,
    padding: 18,
    border: "1px solid var(--line)",
    borderTop: "5px solid var(--accent)",
    boxShadow: "var(--shadow)"
  },
  metricCardLabel: {
    display: "block",
    color: "var(--muted)",
    marginBottom: 10,
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: "0.08em"
  },
  metricCardValue: {
    fontSize: 28
  },
  metricList: {
    display: "grid",
    gap: 10
  },
  metricRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    borderBottom: "1px solid var(--line)",
    paddingBottom: 10
  },
  metricLabel: {
    color: "var(--muted)",
    textTransform: "capitalize"
  },
  metricValue: {
    fontFamily: 'var(--font-mono), "IBM Plex Mono", monospace'
  },
  warningStack: {
    display: "grid",
    gap: 10,
    marginTop: 14
  },
  handPanels: {
    display: "grid",
    gap: 14
  },
  handPanel: {
    borderRadius: 18,
    border: "1px solid var(--line)",
    padding: 14,
    background: "rgba(255,255,255,0.35)"
  },
  handPanelTitle: {
    margin: "0 0 12px",
    fontSize: 16
  },
  warningCard: {
    borderRadius: 18,
    background: "rgba(184, 92, 56, 0.12)",
    color: "var(--warning)",
    padding: 12
  },
  jsonPreview: {
    margin: "12px 0 0",
    padding: 16,
    borderRadius: 20,
    background: "#151513",
    color: "#e9e2d6",
    fontFamily: 'var(--font-mono), "IBM Plex Mono", monospace',
    fontSize: 12,
    overflowX: "auto"
  },
};
  const handSlots: HandSlot[] = ["hand_0", "hand_1"];
