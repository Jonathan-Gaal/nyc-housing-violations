// Decorative NYC skyline silhouette for the hero section background.
// Pure CSS/SVG (no external image) so it always renders, has no
// licensing/hotlinking concerns, and matches the brand's blue/slate palette.
// The gradient overlays in page.tsx (not here) are what keep the hero text
// and search bar readable on top of it.
export default function SkylineBackdrop({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1200 260"
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      <g fill="currentColor">
        <rect x="0" y="160" width="60" height="100" />
        <rect x="55" y="120" width="45" height="140" />
        <rect x="95" y="180" width="55" height="80" />
        <rect x="145" y="90" width="40" height="170" />
        <rect x="180" y="60" width="14" height="30" />
        <rect x="180" y="60" width="14" height="200" />
        <rect x="195" y="140" width="60" height="120" />
        <rect x="255" y="170" width="50" height="90" />
        <rect x="300" y="110" width="42" height="150" />
        <rect x="335" y="200" width="45" height="60" />
        {/* Empire-State-ish stepped tower with a spire */}
        <rect x="375" y="150" width="70" height="110" />
        <rect x="390" y="110" width="40" height="40" />
        <rect x="400" y="70" width="20" height="40" />
        <rect x="408" y="30" width="4" height="40" />
        <rect x="440" y="180" width="50" height="80" />
        <rect x="485" y="130" width="55" height="130" />
        <rect x="535" y="170" width="45" height="90" />
        <rect x="575" y="100" width="48" height="160" />
        <rect x="618" y="150" width="55" height="110" />
        {/* Twin towers-esque pair */}
        <rect x="668" y="80" width="35" height="180" />
        <rect x="705" y="80" width="35" height="180" />
        <rect x="745" y="190" width="50" height="70" />
        <rect x="790" y="120" width="45" height="140" />
        <rect x="830" y="160" width="60" height="100" />
        <rect x="885" y="95" width="38" height="165" />
        <rect x="895" y="60" width="18" height="35" />
        <rect x="920" y="175" width="52" height="85" />
        <rect x="965" y="130" width="45" height="130" />
        <rect x="1005" y="185" width="55" height="75" />
        <rect x="1055" y="105" width="40" height="155" />
        <rect x="1090" y="145" width="50" height="115" />
        <rect x="1135" y="170" width="65" height="90" />
      </g>
    </svg>
  );
}
