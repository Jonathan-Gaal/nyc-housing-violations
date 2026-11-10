"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import HeaderAuth from "@/components/HeaderAuth";
import ThemeToggle from "@/components/ThemeToggle";

function HouseMarkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-blue-600" aria-hidden="true">
      <path
        d="M3 10.5 12 3l9 7.5M5.5 9v10a1 1 0 001 1H10v-5.5a1 1 0 011-1h2a1 1 0 011 1V20h3.5a1 1 0 001-1V9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Site-wide header, rendered once in the root layout so every page gets the
// home link and account controls.
// z-[1100]: Leaflet's own panes/controls go up to z-index 1000
// (node_modules/leaflet/dist/leaflet.css's .leaflet-top/.leaflet-bottom), so
// a lower z-index lets the map render on top of this sticky header once it
// scrolls underneath.
export default function SiteHeader() {
  // The layout (and so this header) stays mounted across client-side
  // navigations; keying HeaderAuth on the path re-checks the session on each
  // page, so it reflects a sign-in/out that just happened on another page.
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-[1100] border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
      <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2 rounded" aria-label="Open Violation NYC home">
          <HouseMarkIcon />
          <span className="whitespace-nowrap text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Open Violation NYC
          </span>
        </Link>
        <div className="ml-auto flex items-center gap-2 whitespace-nowrap">
          <HeaderAuth key={pathname} />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
