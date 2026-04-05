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
  SessionSummary,
  TrackingFrame
} from "@/lib/types";

const EXERCISE_OPTIONS = getExerciseOptions();

interface DetectorBundle {
  hand: HandLandmarker;
  pose: PoseLandmarker;
}

export function MotionDashboard() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<DetectorBundle | null>(null);
  const evaluatorRef = useRef(createExerciseEvaluator("wrist_flexion"));
  const wristAnalyzerRef = useRef(new WristKinematicsAnalyzer());
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastHudUpdateRef = useRef(0);

  const [exercise, setExercise] = useState<ExerciseName>("wrist_flexion");
  const [status, setStatus] = useState("Initializing browser tracker...");
  const [isRunning, setIsRunning] = useState(false);
  const [frameResult, setFrameResult] = useState<FrameResult | null>(null);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
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
          numHands: 1
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
    evaluatorRef.current = createExerciseEvaluator(exercise);
    wristAnalyzerRef.current.reset();
    setFrameResult(null);
    setSessionSummary(null);
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

      let trackingFrame: TrackingFrame = {
        timestampMs,
        handLandmarks: null,
        elbowPoint: null,
        imageWidth: canvas.width,
        imageHeight: canvas.height
      };

      if (handResult.landmarks.length > 0) {
        const landmarks = handResult.landmarks[0];
        trackingFrame = {
          ...trackingFrame,
          handLandmarks: normalizedLandmarksToPixels(landmarks, canvas.width, canvas.height),
          handWorldLandmarks: handResult.worldLandmarks?.[0]
            ? normalizedLandmarksToWorld(handResult.worldLandmarks[0])
            : null
        };
        drawer.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
          color: "#43d9b1",
          lineWidth: 3
        });
        drawer.drawLandmarks(landmarks, {
          color: "#0b2f27",
          fillColor: "#fdf4dc",
          radius: 4
        });
      }

      if (poseResult.landmarks.length > 0) {
        const elbow = poseResult.landmarks[0][14];
        trackingFrame.elbowPoint = {
          x: elbow.x * canvas.width,
          y: elbow.y * canvas.height,
          z: elbow.z * canvas.width
        };
      }

      const biomechanicalFrame = computeBiomechanicalFrame(
        trackingFrame,
        wristAnalyzerRef.current
      );
      if (biomechanicalFrame) {
        const result = evaluatorRef.current.process(biomechanicalFrame);
        const summary = evaluatorRef.current.buildSummary(exercise);
        drawHud(context, result, summary);

        if (timestampMs - lastHudUpdateRef.current > 80) {
          lastHudUpdateRef.current = timestampMs;
          startTransition(() => {
            setFrameResult(result);
            setSessionSummary(summary);
            setStatus(
              biomechanicalFrame.neutralReady
                ? "Tracking live."
                : "Collecting neutral wrist baseline. Hold a comfortable neutral pose."
            );
          });
        }
      } else {
        drawIdleHud(context);
        if (timestampMs - lastHudUpdateRef.current > 160) {
          lastHudUpdateRef.current = timestampMs;
          startTransition(() => {
            setStatus("Hand not visible. Center the working hand in frame.");
            setFrameResult(null);
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
    const summary = evaluatorRef.current.buildSummary(exercise);
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
      <section style={styles.hero}>
        <div>
          <p style={styles.kicker}>Upper-Extremity Rehabilitation</p>
          <h1 style={styles.headline}>Browser-native motion tracking for therapy sessions.</h1>
          <p style={styles.lede}>
            This Vercel version runs hand tracking in the browser, computes biomechanical signals
            client-side, and exports structured session data without a local Python runtime.
          </p>
        </div>
        <div style={styles.heroBadge}>
          <span style={styles.heroBadgeLabel}>Deployable Route</span>
          <strong style={styles.heroBadgeValue}>Next.js + MediaPipe Vision</strong>
        </div>
      </section>

      <section style={styles.grid}>
        <article style={styles.viewportCard}>
          <div style={styles.viewportHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Realtime Capture</h2>
              <p style={styles.sectionCopy}>{status}</p>
            </div>
            <span style={styles.livePill}>{isRunning ? "Camera Live" : "Offline"}</span>
          </div>
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
              {EXERCISE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
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
                  evaluatorRef.current = createExerciseEvaluator(exercise);
                  wristAnalyzerRef.current.reset();
                  setFrameResult(null);
                  setSessionSummary(null);
                  setStatus("Session reset. Neutral baseline recalibrating.");
                }}
                type="button"
              >
                Reset Session
              </button>
            </div>
          </section>

          <section style={styles.metricsGrid}>
            <MetricCard
              label="Reps"
              value={frameResult?.repCount ?? 0}
              accent="var(--accent)"
            />
            <MetricCard
              label="State"
              value={frameResult?.state ?? "WAITING"}
              accent="#d6885b"
            />
            <MetricCard
              label="Primary"
              value={
                frameResult ? `${Number(frameResult.primaryMetric).toFixed(1)}` : "No signal"
              }
              accent="#0f5a46"
            />
            <MetricCard
              label="ROM"
              value={sessionSummary ? sessionSummary.rom.toFixed(1) : "0.0"}
              accent="#5949a8"
            />
          </section>

          <section style={styles.panel}>
            <h2 style={styles.sectionTitle}>Live Metrics</h2>
            <div style={styles.metricList}>
              {frameResult
                ? Object.entries(frameResult.displayMetrics).map(([key, value]) => (
                    <div key={key} style={styles.metricRow}>
                      <span style={styles.metricLabel}>{key.replaceAll("_", " ")}</span>
                      <span style={styles.metricValue}>{String(value)}</span>
                    </div>
                  ))
                : <p style={styles.sectionCopy}>Metrics appear once a hand is detected.</p>}
            </div>
            {frameResult?.warnings.length ? (
              <div style={styles.warningStack}>
                {frameResult.warnings.map((warning) => (
                  <div key={warning} style={styles.warningCard}>
                    {warning}
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section style={styles.panel}>
            <h2 style={styles.sectionTitle}>Session Output</h2>
            <pre style={styles.jsonPreview}>
              {sessionSummary
                ? JSON.stringify(sessionSummary, null, 2)
                : '{\n  "status": "waiting"\n}'}
            </pre>
          </section>
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
  result: FrameResult,
  summary: SessionSummary
) {
  context.fillStyle = "rgba(17, 21, 18, 0.72)";
  context.fillRect(20, 20, 310, 170);
  context.fillStyle = "#f5efe3";
  context.font = '600 18px var(--font-sans), sans-serif';
  context.fillText(result.exerciseName.replaceAll("_", " "), 36, 50);
  context.font = '400 14px var(--font-mono), monospace';
  const lines = [
    `State: ${result.state}`,
    `Reps: ${result.repCount}`,
    `Primary: ${result.primaryMetric.toFixed(1)}`,
    `ROM: ${summary.rom.toFixed(1)}`,
    `Avg velocity: ${summary.avg_velocity.toFixed(1)}`
  ];
  lines.forEach((line, index) => {
    context.fillText(line, 36, 82 + index * 24);
  });
  if (result.warnings.length > 0) {
    context.fillStyle = "#ffb08f";
    context.fillText(result.warnings[0], 36, 82 + lines.length * 24);
  }
}

function drawIdleHud(context: CanvasRenderingContext2D) {
  context.fillStyle = "rgba(17, 21, 18, 0.6)";
  context.fillRect(20, 20, 340, 88);
  context.fillStyle = "#f5efe3";
  context.font = '600 16px var(--font-sans), sans-serif';
  context.fillText("Place one hand inside the camera frame.", 32, 56);
  context.font = '400 13px var(--font-mono), monospace';
  context.fillText("Lighting and contrast materially affect hand tracking.", 32, 82);
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: "40px 32px 56px"
  },
  hero: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.6fr) minmax(260px, 0.8fr)",
    gap: 24,
    alignItems: "end",
    marginBottom: 28
  },
  kicker: {
    margin: 0,
    color: "var(--accent-strong)",
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    fontSize: 12
  },
  headline: {
    margin: "10px 0 12px",
    fontSize: "clamp(2.6rem, 4vw, 4.6rem)",
    lineHeight: 0.95,
    maxWidth: 820
  },
  lede: {
    margin: 0,
    maxWidth: 760,
    color: "var(--muted)",
    fontSize: 18,
    lineHeight: 1.5
  },
  heroBadge: {
    border: "1px solid var(--line)",
    borderRadius: 28,
    background: "linear-gradient(180deg, rgba(255,255,255,0.88), rgba(249,241,228,0.88))",
    padding: 22,
    boxShadow: "var(--shadow)"
  },
  heroBadgeLabel: {
    display: "block",
    marginBottom: 10,
    color: "var(--muted)",
    fontSize: 12,
    letterSpacing: "0.14em",
    textTransform: "uppercase"
  },
  heroBadgeValue: {
    fontSize: 24
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
  viewportHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "start",
    marginBottom: 18
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
  livePill: {
    borderRadius: 999,
    padding: "10px 14px",
    background: "rgba(29,127,100,0.12)",
    color: "var(--accent-strong)",
    fontSize: 13,
    fontWeight: 600
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
