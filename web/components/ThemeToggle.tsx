"use client";

import { useState } from "react";

const THEME_STORAGE_KEY = "theme";

function SunIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M10 15a5 5 0 100-10 5 5 0 000 10zM10 0a1 1 0 011 1v1a1 1 0 11-2 0V1a1 1 0 011-1zM10 17a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM20 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM3 10a1 1 0 01-1 1H1a1 1 0 110-2h1a1 1 0 011 1zM17.071 2.929a1 1 0 010 1.414l-.707.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM5.05 15.657a1 1 0 010 1.414l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 0zM17.071 17.071a1 1 0 01-1.414 0l-.707-.707a1 1 0 111.414-1.414l.707.707a1 1 0 010 1.414zM5.05 4.343a1 1 0 01-1.414 0l-.707-.707a1 1 0 011.414-1.414l.707.707a1 1 0 010 1.414z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
    </svg>
  );
}

// Class-based (not prefers-color-scheme) so the toggle always wins over OS
// setting — mirrors the theme-init script in app/layout.tsx, which reads
// the same localStorage key before first paint to avoid a light-mode flash.
export default function ThemeToggle() {
  // Lazy initializer (not an effect) reads the class the blocking
  // theme-init script (app/layout.tsx) already applied pre-hydration —
  // avoids the react-hooks/set-state-in-effect violation a useEffect+
  // setState sync would trigger. Guarded for SSR, where `document` doesn't
  // exist; the server-rendered icon may briefly mismatch the client's for a
  // returning dark-mode user, which suppressHydrationWarning below accepts,
  // same tradeoff as app/layout.tsx's own suppressHydrationWarning.
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  );

  function toggle() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      suppressHydrationWarning
      className="ml-2 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-slate-300 text-slate-500 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
