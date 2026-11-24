"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface PotholeLog {
  id: string | number;
  confidence: number;
  width_cm?: number;
  breadth_cm?: number;
  depth_cm?: number;
  cost: number;
  lat: number;
  lng: number;
  severity: "Critical" | "High" | "Medium";
  time: string;
}

export interface PotholeMapProps {
  historicalLogs: PotholeLog[];
  userLocation: [number, number] | null;
  address: string;
}

const createPotholeIcon = (severity: string) => {
  const color =
    severity === "Critical" ? "#ef4444" : severity === "High" ? "#f97316" : "#eab308";
  return L.divIcon({
    className: "pothole-marker",
    html: `<div style="background-color: ${color}; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px ${color};"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
};

const createUserIcon = () => {
  return L.divIcon({
    className: "user-marker",
    html: `<div style="background-color: #3b82f6; width: 18px; height: 18px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 15px #3b82f6;"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
};

function MapController({
  logs,
  userLoc,
  followMode,
  onUserInteract,
  recenterNonce,
}: {
  logs: PotholeLog[];
  userLoc: [number, number];
  followMode: boolean;
  onUserInteract: () => void;
  recenterNonce: number;
}) {
  const map = useMap();
  const hasInitializedRef = useRef(false);
  const lastLogCountRef = useRef(0);

  useMapEvents({
    dragstart: () => onUserInteract(),
    zoomstart: () => onUserInteract(),
  });

  // Initial lock or explicit Re-center click
  useEffect(() => {
    if (!hasInitializedRef.current || recenterNonce > 0) {
      hasInitializedRef.current = true;
      const target: [number, number] =
        logs.length > 0
          ? [logs[logs.length - 1].lat, logs[logs.length - 1].lng]
          : userLoc;
      map.setView(target, 18, { animate: true });
    }
  }, [recenterNonce, map, userLoc, logs]);

  // Pan only when a NEW pothole is added (never on frame-by-frame updates) and user hasn't dragged away
  useEffect(() => {
    if (logs.length > lastLogCountRef.current && followMode) {
      const latestLog = logs[logs.length - 1];
      map.setView([latestLog.lat, latestLog.lng], map.getZoom(), { animate: true });
    }
    lastLogCountRef.current = logs.length;
  }, [logs, followMode, map]);

  return null;
}

export default function PotholeMap({
  historicalLogs,
  userLocation,
  address,
}: PotholeMapProps) {
  const [followMode, setFollowMode] = useState(true);
  const [recenterNonce, setRecenterNonce] = useState(0);

  if (!userLocation) {
    return (
      <div
        style={{
          height: "100%",
          width: "100%",
          borderRadius: "8px",
          border: "1px solid #334155",
          background: "#1e293b",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
        }}
      >
        <div
          className="spinner"
          style={{
            border: "3px solid #334155",
            borderTop: "3px solid #3b82f6",
            borderRadius: "50%",
            width: "30px",
            height: "30px",
            animation: "spin 1s linear infinite",
            marginBottom: "12px",
          }}
        />
        <p style={{ margin: 0, fontSize: "14px", color: "#94a3b8" }}>
          Connecting to Satellite...
        </p>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        borderRadius: "8px",
        overflow: "hidden",
        border: "1px solid #334155",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ADDRESS BAR FIXED ABOVE MAP */}
      <div
        style={{
          background: "#0f172a",
          padding: "12px 16px",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
          borderBottom: "1px solid #334155",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
          <span style={{ fontSize: "20px" }}>📍</span>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: "11px",
                color: "#94a3b8",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Live PWD Zone
            </div>
            <div
              style={{
                fontSize: "14px",
                fontWeight: "bold",
                color: "#e2e8f0",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {address}
            </div>
          </div>
        </div>

        {!followMode && (
          <button
            type="button"
            onClick={() => {
              setFollowMode(true);
              setRecenterNonce((n) => n + 1);
            }}
            style={{
              background: "#1e293b",
              color: "#e2e8f0",
              border: "1px solid #475569",
              borderRadius: "6px",
              padding: "6px 10px",
              fontSize: "12px",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Re-center
          </button>
        )}
      </div>

      {/* SATELLITE MAP CONTAINER */}
      <div style={{ flex: 1, width: "100%", position: "relative" }}>
        <MapContainer
          center={userLocation}
          zoom={18}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="© Esri, Maxar, Earthstar Geographics"
          />
          <MapController
            logs={historicalLogs}
            userLoc={userLocation}
            followMode={followMode}
            onUserInteract={() => setFollowMode(false)}
            recenterNonce={recenterNonce}
          />

          <Marker position={userLocation} icon={createUserIcon()}>
            <Popup>
              <strong style={{ color: "#0f172a" }}>You are here</strong>
            </Popup>
          </Marker>

          {historicalLogs.map((log) => (
            <Marker
              key={String(log.id)}
              position={[log.lat, log.lng]}
              icon={createPotholeIcon(log.severity)}
            >
              <Popup>
                <div style={{ color: "#0f172a", margin: 0 }}>
                  <strong
                    style={{ display: "block", fontSize: "14px", marginBottom: "4px" }}
                  >
                    Pothole #{log.id}
                  </strong>
                  <span>
                    Severity: <b>{log.severity}</b>
                  </span>
                  <br />
                  {log.cost > 0 && <span>Est. Cost: ₹{log.cost}</span>}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
