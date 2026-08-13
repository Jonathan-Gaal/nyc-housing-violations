"use client";

import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { HeatmapPoint } from "@/lib/queries";
import { computeMarkerColor, computeMarkerRadius } from "@/lib/mapMarkers";

export default function MapView({ points }: { points: HeatmapPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        No mapped violations for this zip.
      </div>
    );
  }

  const maxWeight = Math.max(...points.map((p) => p.weight));
  const center: [number, number] = [points[0].latitude, points[0].longitude];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 shadow-sm">
      <MapContainer center={center} zoom={15} style={{ height: 440, width: "100%" }}>
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
      <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500">
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
