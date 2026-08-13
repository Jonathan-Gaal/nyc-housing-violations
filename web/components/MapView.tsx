"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import { latLngBounds, type Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { HeatmapPoint } from "@/lib/queries";
import { computeMarkerColor, computeMarkerRadius } from "@/lib/mapMarkers";

// How far in to fly when a "See on map" button targets a specific building
// — well past the zip-fit zoom so the target building is unambiguous among
// its neighbors.
const FOCUS_ZOOM = 18;

// Caps how far fitBounds is allowed to zoom in for a zip whose buildings are
// tightly clustered (or a zip with only one point, where the bounds are a
// single coordinate) — without this a small/dense zip would zoom in past
// street level instead of still showing the surrounding region.
const ZIP_FIT_MAX_ZOOM = 16;
const ZIP_FIT_PADDING: [number, number] = [32, 32];

export interface MapFocusPoint {
  lat: number;
  lng: number;
}

export default function MapView({
  points,
  focusPoint,
}: {
  points: HeatmapPoint[];
  focusPoint?: MapFocusPoint | null;
}) {
  const mapRef = useRef<LeafletMap | null>(null);

  // A new focusPoint object (even with identical coordinates — see
  // app/page.tsx's onViewOnMap, which always creates a fresh object) always
  // re-triggers this, so clicking "See on map" twice in a row re-flies
  // instead of doing nothing the second time.
  useEffect(() => {
    if (focusPoint && mapRef.current) {
      mapRef.current.flyTo([focusPoint.lat, focusPoint.lng], FOCUS_ZOOM, { duration: 1 });
    }
  }, [focusPoint]);

  // Re-frames the map to the searched zip's own spread of buildings — a
  // dense zip fits tighter, a spread-out one fits wider — instead of a fixed
  // zoom level that's too close for a large zip and too far for a small one.
  // `points` gets a new array reference on every search (app/page.tsx's
  // setPoints), so this reruns on each zip search, not just on mount.
  useEffect(() => {
    if (!mapRef.current || points.length === 0) return;
    const bounds = latLngBounds(points.map((p): [number, number] => [p.latitude, p.longitude]));
    mapRef.current.fitBounds(bounds, { padding: ZIP_FIT_PADDING, maxZoom: ZIP_FIT_MAX_ZOOM });
  }, [points]);

  if (points.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        No mapped violations for this search.
      </div>
    );
  }

  const maxWeight = Math.max(...points.map((p) => p.weight));
  const center: [number, number] = [points[0].latitude, points[0].longitude];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 shadow-sm">
      <MapContainer ref={mapRef} center={center} zoom={15} style={{ height: 440, width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {points.map((p) => (
          <CircleMarker
            key={p.building_id}
            center={[p.latitude, p.longitude]}
            radius={computeMarkerRadius(p.weight, maxWeight)}
            pathOptions={{
              color: computeMarkerColor(p.weight, maxWeight),
              fillColor: computeMarkerColor(p.weight, maxWeight),
              fillOpacity: 0.6,
              weight: 1,
            }}
          >
            <Popup>
              <span className="font-semibold">
                {p.house_number_display} {p.street_name}
              </span>
              <br />
              {p.weight} open violation{p.weight === 1 ? "" : "s"}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50 px-3.5 py-1.5 text-xs text-slate-500">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: computeMarkerColor(0, 1) }}
        />
        Fewer violations
        <span
          className="ml-3 h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: computeMarkerColor(1, 1) }}
        />
        More violations
      </div>
    </div>
  );
}
