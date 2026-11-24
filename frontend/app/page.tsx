"use client";
/* eslint-disable @next/next/no-img-element */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/supabase/AuthProvider";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { PotholeLog } from "./PotholeMap";

const PotholeMap = dynamic(() => import("./PotholeMap"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: "300px",
        background: "#1e293b",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "8px",
        color: "#94a3b8",
      }}
    >
      Loading Map...
    </div>
  ),
});

const supabase = getSupabaseClient();

const ENV_BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "")
  .trim()
  .replace(/\/+$/, "");

const getBackendHttpBase = () => {
  if (ENV_BACKEND_URL) return ENV_BACKEND_URL;
  if (typeof window === "undefined") return "";
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return "http://127.0.0.1:8000";
  }
  return "";
};

const getBackendWsBase = () => {
  if (ENV_BACKEND_URL) {
    return ENV_BACKEND_URL.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
  }
  if (typeof window === "undefined") return "";
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return "ws://127.0.0.1:8000";
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
};

const FALLBACK_LOCATION: [number, number] = [28.9731, 77.6833];
const FALLBACK_ADDRESS = "MIET, NH58, Meerut (GPS Offline)";

type SidebarView = "live" | "history" | "uploads" | "reports";

interface ReportState {
  status: "idle" | "processing" | "ready" | "skipped" | "error" | "timeout";
  url?: string | null;
  totalCost?: number;
  potholeCount?: number;
  emailSent?: boolean;
  reason?: string;
}

interface RawDetection {
  id: string | number | null;
  confidence: number;
  width_cm?: number;
  breadth_cm?: number;
  depth_cm?: number;
  estimated_cost?: number;
}

const NAV_ITEMS: { key: SidebarView; label: string; icon: string }[] = [
  { key: "live", label: "Live Detection", icon: "◉" },
  { key: "history", label: "History", icon: "🕒" },
  { key: "uploads", label: "Video Uploads", icon: "☁" },
  { key: "reports", label: "PDFs / Reports", icon: "📄" },
];

const classifySeverity = (conf: number): "Critical" | "High" | "Medium" => {
  if (conf >= 0.85) return "Critical";
  if (conf >= 0.75) return "High";
  return "Medium";
};

const approxDistanceMeters = (a: [number, number], b: [number, number]) => {
  const dLat = (a[0] - b[0]) * 111_320;
  const dLng = (a[1] - b[1]) * 111_320 * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
};

export default function DashboardPage() {
  const { status, user, session, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "signed-out" || status === "unauthorized-domain") {
      router.replace("/login");
    }
  }, [status, router]);

  const wsRef = useRef<WebSocket | null>(null);
  const deviceVideoRef = useRef<HTMLVideoElement | null>(null);
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollGenerationRef = useRef(0);
  const pollReportStatusRef = useRef<
    (sessionId: string, attempt?: number, generation?: number) => Promise<void>
  >(() => Promise.resolve());

  // Refs to prevent stale closures in WS callbacks & cleanups
  const isWaitingForBackendRef = useRef(false);
  const lastFrameSentAtRef = useRef(0);
  const isStreamingDroneRef = useRef(false);
  const isStreamingDeviceRef = useRef(false);
  const currentSessionIdRef = useRef<string | null>(null);
  const detectionCountRef = useRef(0);
  const sessionCostRef = useRef(0);

  // Live GPS refs & state
  const latestCoordsRef = useRef<[number, number]>(FALLBACK_LOCATION);
  const lastGeocodedCoordsRef = useRef<[number, number] | null>(null);
  const liveAddressRef = useRef<string>("Locating system coordinates...");
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [liveAddress, setLiveAddress] = useState<string>("Locating system coordinates...");

  const [ipCamUrl, setIpCamUrl] = useState("http://192.168.1.3:8080/video");
  const [isStreamingDrone, setIsStreamingDrone] = useState(false);
  const [isStreamingDevice, setIsStreamingDevice] = useState(false);
  const [droneImageSrc, setDroneImageSrc] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeView, setActiveView] = useState<SidebarView>("live");

  const [historicalLogs, setHistoricalLogs] = useState<PotholeLog[]>([]);
  const [detectionCount, setDetectionCount] = useState(0);
  const [sessionCost, setSessionCost] = useState(0);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState("");
  const fileUploadRef = useRef<HTMLInputElement | null>(null);
  const [showCompletionModal, setShowCompletionModal] = useState(false);

  const [reportState, setReportState] = useState<ReportState>({ status: "idle" });

  // Derive severity counts cleanly instead of calling setState inside another state updater
  const { criticalCount, highCount, mediumCount } = useMemo(() => {
    let critical = 0;
    let high = 0;
    let medium = 0;
    for (const log of historicalLogs) {
      if (log.severity === "Critical") critical++;
      else if (log.severity === "High") high++;
      else medium++;
    }
    return { criticalCount: critical, highCount: high, mediumCount: medium };
  }, [historicalLogs]);

  // Continuous live GPS tracking with throttled reverse geocoding
  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateAddress = async (lat: number, lon: number) => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`
        );
        if (!res.ok) return;
        const data = await res.json();
        const displayParts =
          typeof data?.display_name === "string"
            ? data.display_name.split(",").map((s: string) => s.trim()).filter(Boolean)
            : [];
        const streetName =
          data?.address?.road ||
          data?.address?.neighbourhood ||
          data?.address?.residential ||
          data?.address?.suburb ||
          displayParts[0] ||
          `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
        const city =
          data?.address?.city ||
          data?.address?.state_district ||
          data?.address?.town ||
          "";

        let finalAddress = streetName;
        if (city) {
          if (streetName.trim().toLowerCase() === city.trim().toLowerCase()) {
            finalAddress = displayParts.slice(0, 2).join(", ") || streetName;
          } else {
            finalAddress = `${streetName}, ${city}`;
          }
        }
        liveAddressRef.current = finalAddress;
        setLiveAddress(finalAddress);
      } catch {
        if (liveAddressRef.current === "Locating system coordinates...") {
          const coordsLabel = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
          liveAddressRef.current = coordsLabel;
          setLiveAddress(coordsLabel);
        }
      }
    };

    if (!navigator.geolocation) {
      latestCoordsRef.current = FALLBACK_LOCATION;
      liveAddressRef.current = FALLBACK_ADDRESS;
      setTimeout(() => {
        setUserLocation(FALLBACK_LOCATION);
        setLiveAddress(FALLBACK_ADDRESS);
      }, 0);
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const nextCoords: [number, number] = [
          position.coords.latitude,
          position.coords.longitude,
        ];
        latestCoordsRef.current = nextCoords;
        setUserLocation(nextCoords);

        const prev = lastGeocodedCoordsRef.current;
        if (!prev || approxDistanceMeters(prev, nextCoords) >= 50) {
          lastGeocodedCoordsRef.current = nextCoords;
          void updateAddress(nextCoords[0], nextCoords[1]);
        }
      },
      (error) => {
        console.warn("Location unavailable. Using MIET fallback:", error.message);
        if (!lastGeocodedCoordsRef.current) {
          latestCoordsRef.current = FALLBACK_LOCATION;
          liveAddressRef.current = FALLBACK_ADDRESS;
          setUserLocation(FALLBACK_LOCATION);
          setLiveAddress(FALLBACK_ADDRESS);
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  useEffect(() => {
    if (!sessionStarted) return;
    const timer = setInterval(() => setSessionSeconds((prev) => prev + 1), 1000);
    return () => clearInterval(timer);
  }, [sessionStarted]);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? session?.access_token ?? null;
  }, [session]);

  const cancelReportPolling = useCallback(() => {
    pollGenerationRef.current += 1;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const pollReportStatus = useCallback(
    async (sessionId: string, attempt = 0, generation?: number) => {
      const activeGen =
        generation !== undefined ? generation : (pollGenerationRef.current += 1);

      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }

      if (attempt === 0) {
        setReportState({ status: "processing" });
      }

      try {
        const token = await getAccessToken();
        const headers: HeadersInit = token
          ? { Authorization: `Bearer ${token}` }
          : {};
        const res = await fetch(
          `${getBackendHttpBase()}/api/v1/reports/${encodeURIComponent(sessionId)}/status`,
          { headers }
        );

        if (activeGen !== pollGenerationRef.current) return;

        if (res.status === 401 || res.status === 403) {
          setReportState({
            status: "error",
            reason: "Session expired. Please sign in again.",
          });
          return;
        }

        if (res.status === 404) {
          if (attempt < 15) {
            pollTimerRef.current = setTimeout(
              () => void pollReportStatusRef.current(sessionId, attempt + 1, activeGen),
              1500
            );
          } else {
            setReportState({
              status: "error",
              reason: "Report status not found on server.",
            });
          }
          return;
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        if (activeGen !== pollGenerationRef.current) return;

        if (data.status === "ready") {
          setReportState({
            status: "ready",
            url: data.pdf_url,
            totalCost: data.total_cost,
            potholeCount: data.pothole_count,
            emailSent: data.email_sent,
          });
          return;
        }
        if (data.status === "skipped") {
          setReportState({
            status: "skipped",
            potholeCount: data.pothole_count ?? 0,
            totalCost: data.total_cost ?? 0,
            reason: data.reason || "No potholes detected in this session.",
          });
          return;
        }
        if (data.status === "error") {
          setReportState({
            status: "error",
            reason: data.error || "Report generation failed.",
          });
          return;
        }

        if (attempt < 20) {
          pollTimerRef.current = setTimeout(
            () => void pollReportStatusRef.current(sessionId, attempt + 1, activeGen),
            1500
          );
        } else {
          setReportState({ status: "timeout" });
        }
      } catch (e) {
        console.error("Report status poll failed:", e);
        if (activeGen !== pollGenerationRef.current) return;
        if (attempt < 20) {
          pollTimerRef.current = setTimeout(
            () => void pollReportStatusRef.current(sessionId, attempt + 1, activeGen),
            1500
          );
        } else {
          setReportState({
            status: "error",
            reason: "Unable to reach backend for report status.",
          });
        }
      }
    },
    [getAccessToken]
  );
  useEffect(() => {
    pollReportStatusRef.current = pollReportStatus;
  }, [pollReportStatus]);

  const stopDroneStream = useCallback(
    (triggerReport = true) => {
      const wasStreaming = isStreamingDroneRef.current;
      const sid = currentSessionIdRef.current;

      isStreamingDroneRef.current = false;
      setIsStreamingDrone(false);

      if (wsRef.current) {
        const sock = wsRef.current;
        wsRef.current = null;
        sock.onclose = null;
        sock.onerror = null;
        sock.close();
      }
      setDroneImageSrc(null);

      if (triggerReport && wasStreaming && sid) {
        currentSessionIdRef.current = null;
        void pollReportStatus(sid);
      }
    },
    [pollReportStatus]
  );

  const stopDeviceCamera = useCallback(
    (triggerReport = true) => {
      const wasStreaming = isStreamingDeviceRef.current;
      const sid = currentSessionIdRef.current;

      isStreamingDeviceRef.current = false;
      isWaitingForBackendRef.current = false;
      setIsStreamingDevice(false);

      if (streamIntervalRef.current) {
        clearInterval(streamIntervalRef.current);
        streamIntervalRef.current = null;
      }

      if (wsRef.current) {
        const sock = wsRef.current;
        wsRef.current = null;
        sock.onclose = null;
        sock.onerror = null;
        sock.close();
      }

      if (deviceVideoRef.current && deviceVideoRef.current.srcObject) {
        const mediaStream = deviceVideoRef.current.srcObject as MediaStream;
        mediaStream.getTracks().forEach((track) => track.stop());
        deviceVideoRef.current.srcObject = null;
      }

      setDroneImageSrc(null);

      if (triggerReport && wasStreaming && sid) {
        currentSessionIdRef.current = null;
        void pollReportStatus(sid);
      }
    },
    [pollReportStatus]
  );

  useEffect(() => {
    return () => {
      cancelReportPolling();
      stopDroneStream(false);
      stopDeviceCamera(false);
    };
  }, [cancelReportPolling, stopDroneStream, stopDeviceCamera]);

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const clearSessionMetrics = () => {
    cancelReportPolling();
    setStreamError(null);
    setSessionSeconds(0);
    setHistoricalLogs([]);
    setDetectionCount(0);
    setSessionCost(0);
    detectionCountRef.current = 0;
    sessionCostRef.current = 0;
    currentSessionIdRef.current = null;
    setReportState({ status: "idle" });
  };

  const saveSessionToHistory = async (
    potholes: number,
    cost: number,
    addressText: string
  ) => {
    if (potholes <= 0) return;
    try {
      const { error } = await supabase.from("session_history").insert([
        {
          location_address: addressText || FALLBACK_ADDRESS,
          total_potholes: potholes,
          estimated_cost: cost,
          session_date: new Date().toISOString(),
        },
      ]);
      if (error) {
        console.error("Database save failed:", error);
      }
    } catch (err) {
      console.error("Supabase Error:", err);
    }
  };

  const handleSocketMessage = (event: MessageEvent) => {
    isWaitingForBackendRef.current = false;

    let data: {
      error?: string;
      session_id?: string;
      image?: string;
      detections?: RawDetection[];
      session_total_maintenance_cost?: number;
      session_unique_potholes?: number;
    };

    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (data.error) {
      setStreamError(data.error);
      stopDroneStream(false);
      stopDeviceCamera(false);
      setSessionStarted(false);
      return;
    }

    if (data.session_id) {
      currentSessionIdRef.current = data.session_id;
    }
    if (data.image) {
      setDroneImageSrc(data.image);
    }

    const incomingDetections = data.detections || [];
    if (incomingDetections.length > 0) {
      const [liveLat, liveLng] = latestCoordsRef.current;

      setHistoricalLogs((prevLogs) => {
        const newLogs = [...prevLogs];

        for (const det of incomingDetections) {
          if (det.id === null || det.id === undefined) continue;
          const severity = classifySeverity(det.confidence);
          const existingIndex = newLogs.findIndex((l) => l.id === det.id);

          if (existingIndex !== -1) {
            // Keep highest-confidence sighting dimensions/cost (matching backend best-sighting logic)
            if (det.confidence >= newLogs[existingIndex].confidence) {
              newLogs[existingIndex] = {
                ...newLogs[existingIndex],
                confidence: det.confidence,
                width_cm: det.width_cm,
                breadth_cm: det.breadth_cm,
                depth_cm: det.depth_cm,
                cost: det.estimated_cost ?? newLogs[existingIndex].cost,
                severity,
              };
            }
          } else {
            // Slight jitter if stationary so markers don't stack invisibly on top of each other
            const offset = newLogs.length * 0.000015;
            newLogs.push({
              id: det.id,
              confidence: det.confidence,
              width_cm: det.width_cm,
              breadth_cm: det.breadth_cm,
              depth_cm: det.depth_cm,
              cost: det.estimated_cost ?? 0,
              lat: liveLat + offset,
              lng: liveLng + offset,
              severity,
              time: new Date().toLocaleTimeString(),
            });
          }
        }

        return newLogs;
      });
    }

    if (typeof data.session_total_maintenance_cost === "number") {
      sessionCostRef.current = data.session_total_maintenance_cost;
      setSessionCost(data.session_total_maintenance_cost);
    }
    if (typeof data.session_unique_potholes === "number") {
      detectionCountRef.current = data.session_unique_potholes;
      setDetectionCount(data.session_unique_potholes);
    }
  };

  // PULL Model: IP/USB Camera Stream
  const startDroneStream = async () => {
    stopDeviceCamera(false);
    stopDroneStream(false);
    clearSessionMetrics();

    const token = await getAccessToken();
    const qs = token ? `?token=${encodeURIComponent(token)}` : "";
    const socket = new WebSocket(`${getBackendWsBase()}/ws/drone-stream${qs}`);
    wsRef.current = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ camera_url: ipCamUrl.trim() }));
      isStreamingDroneRef.current = true;
      setIsStreamingDrone(true);
      setSessionStarted(true);
    };

    socket.onmessage = handleSocketMessage;

    socket.onerror = () => {
      setStreamError("Failed to connect to IP camera WebSocket stream.");
      stopDroneStream(false);
      setSessionStarted(false);
    };

    socket.onclose = (ev) => {
      if (ev.code === 1008 && ev.reason) {
        setStreamError(ev.reason);
      }
      stopDroneStream(true);
      setSessionStarted(false);
    };
  };

  // PUSH Model: Device Browser Camera (Backpressure + Aspect-Ratio Preserved)
  const startDeviceCamera = async () => {
    stopDroneStream(false);
    stopDeviceCamera(false);
    clearSessionMetrics();

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });

      if (deviceVideoRef.current) {
        deviceVideoRef.current.srcObject = mediaStream;
        deviceVideoRef.current.play().catch((e) => console.error("[Cam] Play error:", e));
      }

      const token = await getAccessToken();
      const qs = token ? `?token=${encodeURIComponent(token)}` : "";
      const socket = new WebSocket(`${getBackendWsBase()}/ws/device-stream${qs}`);
      wsRef.current = socket;

      socket.onopen = () => {
        isStreamingDeviceRef.current = true;
        isWaitingForBackendRef.current = false;
        setIsStreamingDevice(true);
        setSessionStarted(true);

        streamIntervalRef.current = setInterval(() => {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

          // Backpressure: wait for previous backend response (with 5s safety watchdog)
          const now = Date.now();
          if (isWaitingForBackendRef.current && now - lastFrameSentAtRef.current < 5000) {
            return;
          }

          const video = deviceVideoRef.current;
          const canvas = hiddenCanvasRef.current;
          if (!video || !canvas || video.readyState < 2) return;

          const srcW = video.videoWidth || 640;
          const srcH = video.videoHeight || 480;
          const targetW = Math.min(640, srcW);
          const targetH = Math.max(1, Math.round(targetW * (srcH / srcW)));

          const context = canvas.getContext("2d");
          if (!context) return;

          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
          }
          context.drawImage(video, 0, 0, targetW, targetH);

          const base64Frame = canvas.toDataURL("image/jpeg", 0.6);
          if (base64Frame.length > 100) {
            isWaitingForBackendRef.current = true;
            lastFrameSentAtRef.current = now;
            wsRef.current.send(JSON.stringify({ frame: base64Frame }));
          }
        }, 180);
      };

      socket.onmessage = handleSocketMessage;

      socket.onerror = () => {
        setStreamError("Device camera WebSocket connection failed.");
        stopDeviceCamera(false);
        setSessionStarted(false);
      };

      socket.onclose = (ev) => {
        if (ev.code === 1008 && ev.reason) {
          setStreamError(ev.reason);
        }
        stopDeviceCamera(true);
        setSessionStarted(false);
      };
    } catch (err) {
      setStreamError("Camera access denied or no camera found on this device.");
      console.error("[Cam] Error:", err);
    }
  };

  const handleBulkUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";

    stopDroneStream(false);
    stopDeviceCamera(false);
    clearSessionMetrics();
    setSessionStarted(false);

    setIsUploading(true);
    setUploadProgressText("Uploading and analyzing video... This may take a minute.");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const token = await getAccessToken();
      const headers: HeadersInit = token
        ? { Authorization: `Bearer ${token}` }
        : {};

      const res = await fetch(`${getBackendHttpBase()}/api/v1/analyze-video`, {
        method: "POST",
        headers,
        body: formData,
      });

      const contentType = res.headers.get("content-type") || "";
      const data = contentType.includes("application/json") ? await res.json() : null;

      if (!res.ok) {
        const msg =
          data?.detail ||
          (res.status === 413
            ? "Video file is too large (max 200 MB)."
            : `Upload failed with status ${res.status}.`);
        setStreamError(msg);
        return;
      }

      setUploadProgressText("Upload complete! Processing results...");

      const totalPotholes = Number(data?.total_potholes ?? 0);
      const totalCost = Number(data?.estimated_cost_inr ?? 0);

      detectionCountRef.current = totalPotholes;
      sessionCostRef.current = totalCost;
      setDetectionCount(totalPotholes);
      setSessionCost(totalCost);

      const [baseLat, baseLng] = latestCoordsRef.current;
      const batchLogs: PotholeLog[] = (data?.pothole_dimensions || []).map(
        (p: RawDetection, index: number) => ({
          id: p.id ?? `B${index + 1}`,
          confidence: p.confidence,
          width_cm: p.width_cm,
          breadth_cm: p.breadth_cm,
          depth_cm: p.depth_cm,
          cost: p.estimated_cost ?? 0,
          lat: baseLat + index * 0.00004,
          lng: baseLng + index * 0.00004,
          severity: classifySeverity(p.confidence),
          time: new Date().toLocaleTimeString(),
        })
      );
      setHistoricalLogs(batchLogs);
      setShowCompletionModal(true);

      if (data?.session_id) {
        currentSessionIdRef.current = data.session_id;
        void pollReportStatus(data.session_id);
      }

      void saveSessionToHistory(totalPotholes, totalCost, liveAddressRef.current);
    } catch (error) {
      console.error("Batch upload failed:", error);
      setStreamError("Upload failed. Ensure the backend server is running and reachable.");
    } finally {
      setIsUploading(false);
    }
  };

  const endSession = async () => {
    const finalCount = detectionCountRef.current;
    const finalCost = sessionCostRef.current;
    const finalAddress = liveAddressRef.current;

    stopDroneStream(true);
    stopDeviceCamera(true);
    setSessionStarted(false);
    setSessionSeconds(0);

    await saveSessionToHistory(finalCount, finalCost, finalAddress);
  };

  const resetSession = () => {
    stopDroneStream(false);
    stopDeviceCamera(false);
    setSessionStarted(false);
    clearSessionMetrics();
    if (fileUploadRef.current) {
      fileUploadRef.current.value = "";
    }
  };

  const handleLogout = async () => {
    cancelReportPolling();
    stopDroneStream(false);
    stopDeviceCamera(false);
    await signOut();
    router.replace("/login");
  };

  if (status !== "authorized") {
    return <div className="login-loading">Loading RoadGuard AI...</div>;
  }

  const operatorLabel = user?.email ? user.email.split("@")[0] : "Operator";
  const operatorInitial = operatorLabel.charAt(0).toUpperCase();
  const isAnyStreamActive = isStreamingDrone || isStreamingDevice;

  return (
    <main className="app">
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="brand-row">
          <div className="brand">
            <div className="brand-logo">{"🛡️"}</div>
            <div className="brand-text">
              <h1>
                RoadGuard <span>AI</span>
              </h1>
              <p>Pothole Detection System</p>
            </div>
          </div>
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed((v) => !v)}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? "›" : "‹"}
          </button>
        </div>

        <nav className="navigation">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              className={`nav-item ${activeView === item.key ? "active" : ""}`}
              onClick={() => setActiveView(item.key)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}

          <div className="nav-divider" />

          <button className="nav-item logout" onClick={handleLogout}>
            <span className="nav-icon">{"→"}</span>
            <span className="nav-label">Log Out</span>
          </button>
        </nav>

        <div className="system-card">
          <div
            className="status-dot"
            style={{ background: isAnyStreamActive ? "#1a7d43" : "#8b9990" }}
          />
          <div className="system-card-text">
            <p>System Status</p>
            <span>{isAnyStreamActive ? "Session Active" : "Ready for Detection"}</span>
          </div>
        </div>

        <div className="operator-card">
          <div className="operator-avatar">{operatorInitial}</div>
          <div className="operator-text">
            <strong>{operatorLabel}</strong>
            <span>{user?.email}</span>
          </div>
        </div>
      </aside>

      <section className="content">
        {streamError && (
          <div
            className="login-error"
            style={{
              marginTop: 0,
              marginBottom: 16,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span>{streamError}</span>
            <button
              type="button"
              onClick={() => setStreamError(null)}
              style={{
                background: "transparent",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                fontWeight: 700,
              }}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        {activeView === "live" && (
          <LiveDetectionView
            isAnyStreamActive={isAnyStreamActive}
            isStreamingDevice={isStreamingDevice}
            sessionSeconds={sessionSeconds}
            formatTime={formatTime}
            ipCamUrl={ipCamUrl}
            setIpCamUrl={setIpCamUrl}
            droneImageSrc={droneImageSrc}
            startDroneStream={startDroneStream}
            startDeviceCamera={startDeviceCamera}
            endSession={endSession}
            handleBulkUpload={handleBulkUpload}
            detectionCount={detectionCount}
            criticalCount={criticalCount}
            highCount={highCount}
            mediumCount={mediumCount}
            historicalLogs={historicalLogs}
            sessionCost={sessionCost}
            reportState={reportState}
            resetSession={resetSession}
            deviceVideoRef={deviceVideoRef}
            hiddenCanvasRef={hiddenCanvasRef}
            isUploading={isUploading}
            uploadProgressText={uploadProgressText}
            fileUploadRef={fileUploadRef}
            userLocation={userLocation}
            liveAddress={liveAddress}
          />
        )}

        {activeView === "uploads" && (
          <VideoUploadsView
            handleBulkUpload={handleBulkUpload}
            isUploading={isUploading}
            uploadProgressText={uploadProgressText}
          />
        )}

        {activeView === "reports" && (
          <ReportsView
            reportState={reportState}
            sessionCost={sessionCost}
            detectionCount={detectionCount}
          />
        )}

        {activeView === "history" && (
          <HistoryView
            historicalLogs={historicalLogs}
            isAnyStreamActive={isAnyStreamActive}
          />
        )}

        {/* Custom Completion Modal */}
        {showCompletionModal && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0,0,0,0.75)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
              backdropFilter: "blur(4px)",
            }}
          >
            <div
              style={{
                background: "#1e293b",
                padding: "30px",
                borderRadius: "12px",
                textAlign: "center",
                color: "white",
                width: "350px",
                boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                animation: "popIn 0.3s ease-out",
              }}
            >
              <div style={{ fontSize: "48px", marginBottom: "15px" }}>✅</div>
              <h2 style={{ margin: "0 0 10px 0", color: "#4ade80" }}>
                Batch Analysis Complete
              </h2>
              <div
                style={{
                  background: "#0f172a",
                  padding: "15px",
                  borderRadius: "8px",
                  marginBottom: "20px",
                }}
              >
                <p style={{ margin: "5px 0", color: "#94a3b8" }}>
                  Total Potholes:{" "}
                  <strong style={{ color: "white", fontSize: "1.1rem" }}>
                    {detectionCount}
                  </strong>
                </p>
                <p style={{ margin: "5px 0", color: "#94a3b8" }}>
                  Maintenance Cost:{" "}
                  <strong style={{ color: "#fbbf24", fontSize: "1.1rem" }}>
                    ₹{sessionCost.toLocaleString("en-IN")}
                  </strong>
                </p>
              </div>
              <button
                onClick={() => {
                  setShowCompletionModal(false);
                  setActiveView("live");
                }}
                style={{
                  background: "#1a7d43",
                  color: "white",
                  border: "none",
                  padding: "12px 20px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: "bold",
                  width: "100%",
                  fontSize: "1rem",
                }}
              >
                View Report Dashboard
              </button>
              <style>{`@keyframes popIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }`}</style>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function LiveDetectionView(props: {
  isUploading: boolean;
  uploadProgressText: string;
  fileUploadRef: React.RefObject<HTMLInputElement | null>;
  isAnyStreamActive: boolean;
  isStreamingDevice: boolean;
  sessionSeconds: number;
  formatTime: (s: number) => string;
  ipCamUrl: string;
  setIpCamUrl: (v: string) => void;
  droneImageSrc: string | null;
  startDroneStream: () => void;
  startDeviceCamera: () => void;
  endSession: () => void;
  handleBulkUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  detectionCount: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  historicalLogs: PotholeLog[];
  sessionCost: number;
  reportState: ReportState;
  resetSession: () => void;
  deviceVideoRef: React.RefObject<HTMLVideoElement | null>;
  hiddenCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  userLocation: [number, number] | null;
  liveAddress: string;
}) {
  const {
    isUploading,
    uploadProgressText,
    fileUploadRef,
    isAnyStreamActive,
    isStreamingDevice,
    sessionSeconds,
    formatTime,
    ipCamUrl,
    setIpCamUrl,
    droneImageSrc,
    startDroneStream,
    startDeviceCamera,
    endSession,
    handleBulkUpload,
    detectionCount,
    criticalCount,
    highCount,
    mediumCount,
    historicalLogs,
    sessionCost,
    reportState,
    resetSession,
    deviceVideoRef,
    hiddenCanvasRef,
    userLocation,
    liveAddress,
  } = props;

  return (
    <>
      <video
        ref={deviceVideoRef}
        autoPlay
        playsInline
        muted
        onLoadedMetadata={(e) => {
          e.currentTarget.play().catch(console.error);
        }}
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          opacity: 0,
          zIndex: -100,
          pointerEvents: "none",
        }}
      />
      <canvas
        ref={hiddenCanvasRef}
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          opacity: 0,
          zIndex: -100,
          pointerEvents: "none",
        }}
      />

      <header className="topbar">
        <div>
          <div className="page-title-row">
            <h2>Live Detection</h2>
            <span className="live-status">
              <span />
              {isAnyStreamActive ? "Session Active" : "System Ready"}
            </span>
          </div>
          <p className="subtitle">AI-powered real-time road condition monitoring</p>
        </div>

        <div className="top-actions">
          <div className="time-box">
            <strong>Session {formatTime(sessionSeconds)}</strong>
            <span>Inspection Session</span>
          </div>
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="panel camera-card">
          <div className="card-header">
            <div>
              <h3>Live Camera Feed</h3>
              <p>{isStreamingDevice ? "Using Local Device Camera" : "Using IP/Drone Stream"}</p>
            </div>
            <div className={isAnyStreamActive ? "recording active-recording" : "recording"}>
              <span />
              {isAnyStreamActive ? "STREAMING" : "OFFLINE"}
            </div>
          </div>

          <div className="camera-screen" style={{ position: "relative", overflow: "hidden" }}>
            {isUploading ? (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: "#1e293b",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 50,
                  borderRadius: "8px",
                  padding: "16px",
                  textAlign: "center",
                }}
              >
                <div
                  className="spinner"
                  style={{
                    border: "4px solid #334155",
                    borderTop: "4px solid #1a7d43",
                    borderRadius: "50%",
                    width: "40px",
                    height: "40px",
                    animation: "spin 1s linear infinite",
                  }}
                />
                <p style={{ color: "white", marginTop: "15px", fontWeight: "bold" }}>
                  {uploadProgressText}
                </p>
                <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
              </div>
            ) : isAnyStreamActive && droneImageSrc ? (
              <img src={droneImageSrc} alt="Live road feed" className="road-video" />
            ) : (
              <div className="camera-placeholder">
                <div className="camera-icon">{"📹"}</div>
                <h3>Camera / Video Feed</h3>
                <p>Enter a reachable RTSP/HTTP stream URL or use your local device camera</p>
                <div
                  style={{
                    margin: "12px 0",
                    width: "80%",
                    maxWidth: "360px",
                    display: "flex",
                    gap: "10px",
                    flexDirection: "column",
                  }}
                >
                  <input
                    type="text"
                    className="ip-input"
                    value={ipCamUrl}
                    onChange={(e) => setIpCamUrl(e.target.value)}
                    placeholder="http://192.168.1.100:8080/video or 0"
                  />
                </div>
              </div>
            )}
          </div>

          <input
            type="file"
            accept="video/*"
            ref={fileUploadRef}
            style={{ display: "none" }}
            onChange={handleBulkUpload}
          />

          <div className="session-controls-row" style={{ flexWrap: "wrap", gap: "10px" }}>
            <button
              className="btn btn-primary"
              onClick={startDroneStream}
              disabled={isAnyStreamActive || isUploading}
            >
              {"📹"} Start IP/USB Cam
            </button>
            <button
              className="btn btn-secondary"
              onClick={startDeviceCamera}
              disabled={isAnyStreamActive || isUploading}
              style={{ backgroundColor: "#2d3748", color: "white" }}
            >
              {"📱"} Use Device Camera
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => fileUploadRef.current?.click()}
              disabled={isAnyStreamActive || isUploading}
              style={{ backgroundColor: "#1a7d43", color: "white" }}
            >
              {"📂"} Upload Video
            </button>
            <button
              className="btn btn-danger"
              onClick={endSession}
              disabled={!isAnyStreamActive}
            >
              {"■"} End Session
            </button>
          </div>
        </section>

        <section className="panel detections-card">
          <div className="summary-strip">
            <div className="severity critical">
              <strong>{criticalCount}</strong>
              <p>Critical</p>
            </div>
            <div className="severity high">
              <strong>{highCount}</strong>
              <p>High</p>
            </div>
            <div className="severity medium">
              <strong>{mediumCount}</strong>
              <p>Medium</p>
            </div>
          </div>

          <div className="card-header">
            <div>
              <h3>Active Detection Logs</h3>
              <p>Live PWD metrics</p>
            </div>
            <span className="detection-count">Total: {detectionCount}</span>
          </div>

          {historicalLogs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">{"◉"}</div>
              <h3>No Potholes Detected</h3>
              <p>AI is currently monitoring the road video.</p>
            </div>
          ) : (
            <div className="detection-list" style={{ maxHeight: 340, overflowY: "auto" }}>
              {historicalLogs.map((log) => (
                <div className="detection-item" key={String(log.id)}>
                  <div className="detection-info">
                    <strong>Pothole #{log.id}</strong>
                    <span>{log.time}</span>
                  </div>
                  <div className="detection-details">
                    <span className={`severity ${log.severity.toLowerCase()}`}>
                      {log.severity}
                    </span>
                    {log.width_cm !== undefined && (
                      <span>
                        {log.width_cm}×{log.breadth_cm}×{log.depth_cm} cm
                      </span>
                    )}
                    {isAnyStreamActive ? (
                      <span>cost pending</span>
                    ) : (
                      <span>₹{log.cost}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="panel cost-card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <h3>Estimated Repair Cost</h3>
            <p>Based on detected width, breadth & depth</p>
          </div>
          <span className="cost-icon">{"₹"}</span>
        </div>

        {isAnyStreamActive ? (
          <div className="empty-state">
            <div className="empty-icon">{"🔒"}</div>
            <h3>Cost hidden while live</h3>
            <p>Maintenance cost will appear once the session ends.</p>
          </div>
        ) : historicalLogs.length > 0 ? (
          <>
            <div className="cost-value">₹{sessionCost.toLocaleString("en-IN")}</div>
            <div className="cost-footer">
              <span>Total estimated cost -- current session</span>
              <span>{detectionCount} potholes</span>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">{"₹"}</div>
            <h3>No session data yet</h3>
            <p>Start and end a session (or upload a video) to see maintenance cost here.</p>
          </div>
        )}
      </section>

      <ReportPanel
        reportState={reportState}
        sessionCost={sessionCost}
        detectionCount={detectionCount}
        isAnyStreamActive={isAnyStreamActive}
      />

      {/* LIVE MAP CONTAINER */}
      <div
        style={{
          height: "400px",
          marginTop: "16px",
          borderRadius: "8px",
          overflow: "hidden",
        }}
      >
        <PotholeMap
          historicalLogs={historicalLogs}
          userLocation={userLocation}
          address={liveAddress}
        />
      </div>

      <section className="panel session-card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <h3>Session Controls</h3>
            <p>Reset active session state</p>
          </div>
        </div>
        <div className="session-actions">
          <button className="btn" onClick={resetSession}>
            {"↻"} Reset Session
          </button>
        </div>
      </section>
    </>
  );
}

function ReportPanel({
  reportState,
  sessionCost,
  detectionCount,
  isAnyStreamActive,
}: {
  reportState: ReportState;
  sessionCost: number;
  detectionCount: number;
  isAnyStreamActive: boolean;
}) {
  if (isAnyStreamActive || reportState.status === "idle") return null;

  return (
    <section className="panel cost-card" style={{ marginTop: 16 }}>
      <div className="card-header">
        <div>
          <h3>PDF Report & Email Alert</h3>
          <p>Per-pothole image, dimensions & cost</p>
        </div>
        <span className="cost-icon">{"📄"}</span>
      </div>

      {reportState.status === "processing" && (
        <div className="empty-state">
          <div className="empty-icon">{"⏳"}</div>
          <h3>Generating report...</h3>
          <p>Building the PDF, uploading to cloud storage, and emailing summary.</p>
        </div>
      )}

      {reportState.status === "skipped" && (
        <div className="empty-state">
          <div className="empty-icon">{"✓"}</div>
          <h3>No report needed</h3>
          <p>{reportState.reason || "No potholes were detected in this session."}</p>
        </div>
      )}

      {reportState.status === "ready" && (
        <div style={{ padding: "12px 16px 16px" }}>
          <div className="cost-footer" style={{ margin: "0 0 12px", border: "none" }}>
            <span>{reportState.potholeCount ?? detectionCount} potholes documented</span>
            <span>
              ₹{(reportState.totalCost ?? sessionCost).toLocaleString("en-IN")} total
            </span>
          </div>
          {reportState.url ? (
            <a
              href={reportState.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary"
            >
              {"⬇"} Open PDF Report
            </a>
          ) : (
            <p style={{ fontSize: 12.5, color: "var(--rg-ink-muted)" }}>
              PDF generated on server (Supabase storage not configured — no cloud link).
            </p>
          )}
          <p style={{ marginTop: 10, fontSize: 11.5, color: "var(--rg-ink-faint)" }}>
            {"📧"}{" "}
            {reportState.emailSent
              ? "Summary email with PDF attachment has been dispatched to operator & admin."
              : "PDF ready (SMTP email delivery skipped or not configured on server)."}
          </p>
        </div>
      )}

      {reportState.status === "error" && (
        <div className="empty-state">
          <div className="empty-icon">{"⚠️"}</div>
          <h3>Report generation failed</h3>
          <p>{reportState.reason || "Check backend logs for details."}</p>
        </div>
      )}

      {reportState.status === "timeout" && (
        <div className="empty-state">
          <div className="empty-icon">{"⌛"}</div>
          <h3>Still working...</h3>
          <p>Report is taking longer than expected. Check backend logs.</p>
        </div>
      )}
    </section>
  );
}

function VideoUploadsView({
  handleBulkUpload,
  isUploading,
  uploadProgressText,
}: {
  handleBulkUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isUploading: boolean;
  uploadProgressText: string;
}) {
  return (
    <>
      <header className="topbar">
        <div>
          <div className="page-title-row">
            <h2>Video Uploads</h2>
          </div>
          <p className="subtitle">Upload a recorded road survey video for batch analysis</p>
        </div>
      </header>

      <section className="panel" style={{ padding: 24 }}>
        <p style={{ marginTop: 0, fontSize: 13, color: "var(--rg-ink-muted)" }}>
          Supports MP4, MOV, AVI, MKV, and WebM recordings up to 200 MB. Uploading stops any active
          live stream automatically.
        </p>

        {isUploading ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "16px",
              borderRadius: "8px",
              background: "var(--rg-surface-tint)",
              border: "1px solid var(--rg-border)",
            }}
          >
            <div
              style={{
                border: "3px solid var(--rg-border)",
                borderTop: "3px solid var(--rg-green-600)",
                borderRadius: "50%",
                width: "24px",
                height: "24px",
                animation: "spin 1s linear infinite",
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 600 }}>{uploadProgressText}</span>
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          </div>
        ) : (
          <label className="btn btn-primary" style={{ cursor: "pointer" }}>
            {"☁"} Upload Video for Analysis
            <input type="file" accept="video/*" hidden onChange={handleBulkUpload} />
          </label>
        )}
      </section>
    </>
  );
}

function ReportsView({
  reportState,
  sessionCost,
  detectionCount,
}: {
  reportState: ReportState;
  sessionCost: number;
  detectionCount: number;
}) {
  return (
    <>
      <header className="topbar">
        <div>
          <div className="page-title-row">
            <h2>PDFs / Reports</h2>
          </div>
          <p className="subtitle">Latest generated inspection report</p>
        </div>
      </header>

      {reportState.status === "idle" ? (
        <div className="not-available">
          <h3>No report generated yet</h3>
          <p>
            Run a live detection session or upload a video to automatically generate a PDF report.
          </p>
        </div>
      ) : (
        <ReportPanel
          reportState={reportState}
          sessionCost={sessionCost}
          detectionCount={detectionCount}
          isAnyStreamActive={false}
        />
      )}
    </>
  );
}

function HistoryView({
  historicalLogs,
  isAnyStreamActive,
}: {
  historicalLogs: PotholeLog[];
  isAnyStreamActive: boolean;
}) {
  return (
    <>
      <header className="topbar">
        <div>
          <div className="page-title-row">
            <h2>History</h2>
          </div>
          <p className="subtitle">Detections logged during the current inspection</p>
        </div>
      </header>

      <section className="panel detections-card">
        <div className="card-header">
          <div>
            <h3>Current Session Log</h3>
            <p>Verified pothole detections</p>
          </div>
        </div>
        {historicalLogs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">{"◉"}</div>
            <h3>No defects logged yet</h3>
          </div>
        ) : (
          <div className="detection-list" style={{ maxHeight: 420, overflowY: "auto" }}>
            {historicalLogs.map((log) => (
              <div className="detection-item" key={String(log.id)}>
                <div className="detection-info">
                  <strong>Pothole #{log.id}</strong>
                  <span>
                    Detected at {log.time} — {log.lat.toFixed(5)}, {log.lng.toFixed(5)}
                  </span>
                </div>
                <div className="detection-details">
                  <span className={`severity ${log.severity.toLowerCase()}`}>
                    {log.severity}
                  </span>
                  {isAnyStreamActive ? <span>cost pending</span> : <span>₹{log.cost}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
