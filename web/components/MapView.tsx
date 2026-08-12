"use client";

import { useEffect, useRef } from "react";
import mapboxgl, { type Map as MapboxMap, type Marker as MapboxMarker } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { HeatmapPoint } from "@/lib/queries";

const MIN_RADIUS_PX = 4;
const MAX_RADIUS_SPAN_PX = 16;
const MAX_HUE = 120;
const COLOR_SATURATION = "80%";
const COLOR_LIGHTNESS = "45%";

// Green (few violations) -> red (many violations), scaled by this point's
// weight relative to the largest weight in the current zip. Extracted from
// the pre-Mapbox `colorFor` implementation (specs/009-mapbox-swap.md) —
// behavior is proven identical via MapView.test.ts before the rendering
// engine underneath it changed.
export function computeMarkerColor(weight: number, maxWeight: number): string {
  const ratio = maxWeight > 0 ? Math.min(weight / maxWeight, 1) : 0;
  const hue = MAX_HUE - ratio * MAX_HUE;
  return `hsl(${hue}, ${COLOR_SATURATION}, ${COLOR_LIGHTNESS})`;
}

// Radius scales 4px (lowest weight) to 20px (weight === maxWeight). Guards
// maxWeight === 0 the same way the legacy `maxWeight || 1` divisor did.
export function computeMarkerRadius(weight: number, maxWeight: number): number {
  const safeMaxWeight = maxWeight || 1;
  return MIN_RADIUS_PX + (weight / safeMaxWeight) * MAX_RADIUS_SPAN_PX;
}

function buildPopupHtml(weight: number): string {
  const violationWord = weight === 1 ? "violation" : "violations";
  return `<span class="font-semibold">${weight} open ${violationWord}</span>`;
}

export default function MapView({ points }: { points: HeatmapPoint[] }) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<MapboxMarker[]>([]);

  useEffect(() => {
    if (points.length === 0 || !mapContainerRef.current) {
      return;
    }

    const accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (accessToken) {
      mapboxgl.accessToken = accessToken;
    }

    const maxWeight = Math.max(...points.map((p) => p.weight));
    const center: [number, number] = [points[0].longitude, points[0].latitude];

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center,
      zoom: 15,
    });
    mapRef.current = map;

    for (const point of points) {
      const markerElement = document.createElement("div");
      const radius = computeMarkerRadius(point.weight, maxWeight);
      markerElement.style.width = `${radius * 2}px`;
      markerElement.style.height = `${radius * 2}px`;
      markerElement.style.borderRadius = "50%";
      markerElement.style.backgroundColor = computeMarkerColor(point.weight, maxWeight);
      markerElement.style.opacity = "0.6";
      markerElement.style.border = "1px solid rgba(0,0,0,0.25)";

      const popup = new mapboxgl.Popup({ offset: radius }).setHTML(buildPopupHtml(point.weight));

      const marker = new mapboxgl.Marker({ element: markerElement })
        .setLngLat([point.longitude, point.latitude])
        .setPopup(popup)
        .addTo(map);

      markersRef.current.push(marker);
    }

    return () => {
      for (const marker of markersRef.current) {
        marker.remove();
      }
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [points]);

  if (points.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        No mapped violations for this zip.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 shadow-sm">
      <div ref={mapContainerRef} style={{ height: 440, width: "100%" }} />
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
