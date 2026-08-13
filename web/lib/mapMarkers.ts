const MIN_RADIUS_PX = 4;
const MAX_RADIUS_SPAN_PX = 16;
const MAX_HUE = 120;
const COLOR_SATURATION = "80%";
const COLOR_LIGHTNESS = "45%";

// Green (few violations) -> red (many violations), scaled by this point's
// weight relative to the largest weight in the current zip. Kept out of
// MapView.tsx (which imports Leaflet/DOM-touching modules) so it can be
// unit-tested without a browser environment.
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
