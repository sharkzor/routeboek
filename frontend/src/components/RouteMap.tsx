import { useMemo } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer } from "react-leaflet";
import type { LatLngBoundsExpression, LatLngExpression } from "leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import type { LegalitySegment, WaterPoint } from "../api/types";

/** Leaflet zoekt zijn marker-iconen standaard naast de CSS; dat werkt niet met Vite. */
const waterIcon = L.divIcon({
  className: "",
  html:
    '<div style="background:#1c7ed6;border:2px solid #fff;border-radius:50%;width:16px;' +
    'height:16px;box-shadow:0 1px 4px rgb(0 0 0 / 40%)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const startIcon = L.divIcon({
  className: "",
  html:
    '<div style="background:#2f9e44;border:2px solid #fff;border-radius:50%;width:18px;' +
    'height:18px;box-shadow:0 1px 4px rgb(0 0 0 / 40%)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

/** Rood voor "hier mag je niet fietsen", oranje voor "let op". */
const SEVERITY_COLOR: Record<LegalitySegment["severity"], string> = {
  forbidden: "#e03131",
  warning: "#f08c00",
};

export default function RouteMap({
  coordinates,
  waterPoints = [],
  legalitySegments = [],
  height = 420,
}: {
  coordinates: [number, number][];
  waterPoints?: WaterPoint[];
  legalitySegments?: LegalitySegment[];
  height?: number | string;
}) {
  const positions = useMemo<LatLngExpression[]>(
    () => coordinates.map(([lat, lng]) => [lat, lng] as LatLngExpression),
    [coordinates],
  );

  const bounds = useMemo<LatLngBoundsExpression | null>(() => {
    if (coordinates.length === 0) return null;
    let minLat = coordinates[0][0];
    let maxLat = coordinates[0][0];
    let minLng = coordinates[0][1];
    let maxLng = coordinates[0][1];
    for (const [lat, lng] of coordinates) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }
    return [
      [minLat, minLng],
      [maxLat, maxLng],
    ];
  }, [coordinates]);

  if (bounds === null) {
    return null;
  }

  return (
    <MapContainer
      bounds={bounds}
      boundsOptions={{ padding: [24, 24] }}
      scrollWheelZoom={false}
      style={{ height, width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      {/* Zodra er meldingen zijn wordt de route grijs, anders vallen de rode
          probleemstukken niet op tegen het clubrood van de routelijn. */}
      <Polyline
        positions={positions}
        pathOptions={
          legalitySegments.length > 0
            ? { color: "#868e96", weight: 4 }
            : { color: "#f4244e", weight: 4 }
        }
      />
      {legalitySegments.map((segment, index) => (
        <Polyline
          key={`${segment.way_id ?? "x"}-${segment.start_km}-${index}`}
          positions={segment.coordinates as LatLngExpression[]}
          pathOptions={{ color: SEVERITY_COLOR[segment.severity], weight: 9, opacity: 0.85 }}
        >
          <Popup>
            <strong>{segment.label}</strong>
            <br />
            Op {segment.start_km.toFixed(1)}-{segment.end_km.toFixed(1)} km ·{" "}
            {Math.round(segment.length_m)} m
            {segment.way_name && (
              <>
                <br />
                {segment.way_name}
              </>
            )}
            {segment.way_id !== null && (
              <>
                <br />
                <a
                  href={`https://www.openstreetmap.org/way/${segment.way_id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Bekijk op OpenStreetMap
                </a>
              </>
            )}
          </Popup>
        </Polyline>
      ))}
      <Marker position={positions[0]} icon={startIcon}>
        <Popup>Start</Popup>
      </Marker>
      {waterPoints.map((point, index) => (
        <Marker key={`${point.lat}-${point.lon}-${index}`} position={[point.lat, point.lon]} icon={waterIcon}>
          <Popup>
            <strong>{point.name ?? "Waterpunt"}</strong>
            <br />
            Op {point.along_route_km.toFixed(1)} km
            {point.opening_hours && (
              <>
                <br />
                {point.opening_hours}
              </>
            )}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
