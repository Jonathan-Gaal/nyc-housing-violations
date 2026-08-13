"use client";

import { useEffect, useRef, useState } from "react";

// Fixed, evenly-spread spawn slots (fractions of canvas size) — "controlled
// randomness": each spawn picks a random slot different from the last one,
// rather than a fully random pixel position, so landlords don't cluster or
// spawn off in a corner.
const SPAWN_SLOTS = [
  { x: 0.15, y: 0.35 },
  { x: 0.35, y: 0.22 },
  { x: 0.55, y: 0.4 },
  { x: 0.75, y: 0.28 },
  { x: 0.25, y: 0.55 },
  { x: 0.65, y: 0.58 },
  { x: 0.45, y: 0.42 },
  { x: 0.85, y: 0.48 },
];

const LANDLORD_SIZE = 56;
const LANDLORD_LIFETIME_MS = 3200;
const RESPAWN_DELAY_MS = 400;

// The plain spinner shows first; the game only takes over after this long,
// so a quick (already-seeded) search never sees the game flash by.
const GAME_DELAY_MS = 5000;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 1 -> 0
  color: string;
}

interface Landlord {
  x: number;
  y: number;
  spawnedAt: number;
  poppedAt: number | null;
}

// Deterministic-looking skyline: same seed every mount so buildings don't
// flicker/reshuffle each frame, generated once rather than baked-in image
// assets.
function makeSkyline(width: number, count: number) {
  const buildings: { x: number; width: number; height: number }[] = [];
  let x = 0;
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed % 1000) / 1000;
  };
  while (x < width + 40) {
    const w = 40 + rand() * 50;
    const h = 60 + rand() * 140;
    buildings.push({ x, width: w, height: h });
    x += w + 4;
    if (buildings.length > count) break;
  }
  return buildings;
}

function drawPixelPerson(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  bodyColor: string,
  hat: "cap" | "tophat"
) {
  const s = size / 10;
  ctx.fillStyle = "#f0c9a0"; // head
  ctx.fillRect(x - s * 1.5, y - s * 8, s * 3, s * 3);
  ctx.fillStyle = bodyColor; // torso
  ctx.fillRect(x - s * 2, y - s * 5, s * 4, s * 4);
  ctx.fillStyle = "#1e293b"; // legs
  ctx.fillRect(x - s * 2, y - s * 1, s * 1.6, s * 3);
  ctx.fillRect(x + s * 0.4, y - s * 1, s * 1.6, s * 3);

  if (hat === "cap") {
    ctx.fillStyle = "#2563eb";
    ctx.fillRect(x - s * 1.8, y - s * 9, s * 3.6, s * 1.4);
  } else {
    ctx.fillStyle = "#111827";
    ctx.fillRect(x - s * 1.6, y - s * 10.5, s * 3.2, s * 1.6);
    ctx.fillRect(x - s * 2.2, y - s * 9, s * 4.4, s * 0.8);
    ctx.fillStyle = "#facc15"; // gold dollar-sign accent
    ctx.font = `${s * 1.4}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText("$", x, y - s * 5.5);
  }
}

function LoadingSpinner() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <div className="h-14 w-14 animate-spin rounded-full border-4 border-slate-400/40 border-t-slate-700" />
      <p className="font-mono text-sm font-medium text-slate-700">Loading…</p>
    </div>
  );
}

function LoadingGameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hits, setHits] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context2d = canvas.getContext("2d");
    if (!context2d) return;
    const ctx: CanvasRenderingContext2D = context2d;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let skyline = makeSkyline(width, 14);

    function resize() {
      if (!canvas) return;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
      skyline = makeSkyline(width, 14);
    }
    resize();
    window.addEventListener("resize", resize);

    const mouse = { x: width / 2, y: height / 2 };
    const particles: Particle[] = [];
    let lastSlotIndex = -1;

    function spawnLandlord(now: number): Landlord {
      let slotIndex = Math.floor(Math.random() * SPAWN_SLOTS.length);
      if (slotIndex === lastSlotIndex) {
        slotIndex = (slotIndex + 1) % SPAWN_SLOTS.length;
      }
      lastSlotIndex = slotIndex;
      const slot = SPAWN_SLOTS[slotIndex];
      return { x: slot.x * width, y: slot.y * height, spawnedAt: now, poppedAt: null };
    }

    let landlord = spawnLandlord(performance.now());

    function handleMouseMove(e: MouseEvent) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    }

    function handleClick(e: MouseEvent) {
      const clickX = e.clientX;
      const clickY = e.clientY;
      const now = performance.now();

      // Muzzle-flash burst at the click point regardless of hit/miss —
      // keeps every click feel responsive.
      for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * 2 * i) / 8;
        particles.push({
          x: clickX,
          y: clickY,
          vx: Math.cos(angle) * 2.5,
          vy: Math.sin(angle) * 2.5,
          life: 1,
          color: "#fbbf24",
        });
      }

      if (landlord.poppedAt === null) {
        const dx = clickX - landlord.x;
        const dy = clickY - (landlord.y - LANDLORD_SIZE / 2);
        if (Math.sqrt(dx * dx + dy * dy) < LANDLORD_SIZE) {
          landlord.poppedAt = now;
          setHits((h) => h + 1);
          // Comedic coin-burst instead of anything violent.
          for (let i = 0; i < 12; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1.5 + Math.random() * 3;
            particles.push({
              x: landlord.x,
              y: landlord.y - LANDLORD_SIZE / 2,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed - 2,
              life: 1,
              color: "#facc15",
            });
          }
        }
      }
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("click", handleClick);

    let rafId: number;
    function frame() {
      const now = performance.now();

      if (landlord.poppedAt !== null && now - landlord.poppedAt > RESPAWN_DELAY_MS) {
        landlord = spawnLandlord(now);
      } else if (landlord.poppedAt === null && now - landlord.spawnedAt > LANDLORD_LIFETIME_MS) {
        landlord = spawnLandlord(now);
      }

      ctx.clearRect(0, 0, width, height);
      // No opaque background fill here, on purpose — the wrapping div's
      // translucent/blurred backdrop is the only "atmosphere" layer, so the
      // page underneath stays faintly visible instead of a solid takeover.

      // Skyline silhouette, translucent, with a few lit windows per building.
      for (const b of skyline) {
        ctx.fillStyle = "rgba(100, 116, 139, 0.4)";
        ctx.fillRect(b.x, height - b.height, b.width, b.height);
        ctx.fillStyle = "rgba(250, 204, 21, 0.35)";
        const cols = Math.max(1, Math.floor(b.width / 14));
        const rows = Math.max(1, Math.floor(b.height / 18));
        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
            if ((c + r) % 3 === 0) {
              ctx.fillRect(b.x + 4 + c * 14, height - b.height + 6 + r * 18, 6, 6);
            }
          }
        }
      }

      // Landlord (pixel figure with a top hat + $ accent), skipped while
      // popped/respawning.
      if (landlord.poppedAt === null) {
        drawPixelPerson(ctx, landlord.x, landlord.y, LANDLORD_SIZE, "#4c1d95", "tophat");
      }

      // Particles (muzzle flashes + coin bursts).
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.12; // gravity
        p.life -= 0.03;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
        ctx.globalAlpha = 1;
      }

      // Tenant follows the mouse — the player's on-screen "cursor".
      drawPixelPerson(ctx, mouse.x, mouse.y, LANDLORD_SIZE, "#0e7490", "cap");

      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("click", handleClick);
    };
  }, []);

  return (
    <div className="relative h-full" style={{ cursor: "none" }}>
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-10 flex flex-col items-center gap-1 text-center">
        <p className="animate-pulse font-mono text-lg font-bold tracking-wide text-amber-600 sm:text-2xl">
          This is taking a while… get the deadbeat landlord
        </p>
        <p className="font-mono text-xs text-slate-600 sm:text-sm">Evicted: {hits}</p>
      </div>
    </div>
  );
}

export default function LoadingGame() {
  const [showGame, setShowGame] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowGame(true), GAME_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    // z-[1200]: above the sticky header's z-[1100] (app/page.tsx, itself
    // raised above Leaflet's z-index-1000 controls) so the loading overlay
    // still covers the whole page, header included, while a search is in
    // flight.
    <div className="fixed inset-0 z-[1200] bg-slate-400/25 backdrop-blur-sm">
      {/* Both layers share this same backdrop and cross-fade in place, so
          the game taking over doesn't feel like an abrupt screen change. */}
      <div
        className={`absolute inset-0 transition-opacity duration-700 ${
          showGame ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <LoadingSpinner />
      </div>
      <div
        className={`absolute inset-0 transition-opacity duration-700 ${
          showGame ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {showGame && <LoadingGameCanvas />}
      </div>
    </div>
  );
}
