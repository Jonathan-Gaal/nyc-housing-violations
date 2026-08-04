# Session State — nyc-open-data-project

Episodic, in-flight ledger. Append-only, newest entry first, ~10 lines per session. Never re-summarize or restructure old entries — fold this edit into the code commit it describes. Durable facts belong in a spec (`specs/`) or the wiki (`.claude/wiki/project-nyc-open-data-project/`), not here.

## [2026-08-04] design | Consumer-facing redesign (`web/`)

- Shipped: branded UI ("HomeCheck NYC") — sticky header, hero + search, colored rating badges (Excellent/Good/Fair/Poor by tier, not just stars), humanized violation age ("2y 7mo open" vs raw days), rent-impairing warning badges, empty/error/loading states designed instead of raw text, fixed light theme (dropped OS dark-mode auto-switch for brand consistency). New `lib/format.ts` (rating tier + humanized duration) with 6 tests.
- 35/35 tests pass, clean lint/typecheck/build, verified live (818 buildings / 10,283 violations for 11106, unchanged from before the redesign — only presentation changed).
- Next: get human feedback on the new look; consider a real logo/favicon and neighborhood name lookup (e.g. "Astoria, Queens" next to the zip) if that's wanted.

## [2026-08-04] build | Functional MVP built and verified (`web/`)

- Shipped: Next.js 16 + TypeScript app in `web/` — SQLite (not Postgres) + Leaflet/OSM (not Mapbox, no API key needed), covers US-1 through US-6. 29 tests (vitest), lint clean, `next build` clean, verified live against the real CSV (818 buildings / 10,283 violations for zip 11106 — API responses match exactly).
- Found & fixed 2 defects in the "verified" reference docs while building: (1) `snippets.md`'s loader used `parseInt()` on NYC block-lot house numbers ("14-31" → 14), corrupting every multi-entrance address — `lib/csvLoader.ts` keeps them as text end-to-end, with a regression test. (2) the CSV isn't pure zip 11106 (also has 11429, 10009 rows) — loader/queries filter by postcode defensively rather than trusting file scope.
- Blocked: nothing. Auth (Phase 2/Firebase), live Socrata refresh, and rent-impairing/age filters (US-7/US-8) are deliberately deferred.
- Next: `npm run dev` in `web/` to view it; `npm test` / `npm run load-data` to re-verify or reload data. Spec 002 for US-7/US-8 filters, or a Phase-2 spec for Firebase auth, whichever the human picks first.

## [2026-08-04] setup | Agent suite spun up for this project

- Shipped: root suite (`.claude/agents/AGENT-SUITE-FULL.md`) upgraded with spec-driven development ported from Ryan's template; project team selected and documented in `CLAUDE.md`; first worked spec written (`specs/001-zip-search-and-buildings-summary.md`).
- Blocked: nothing — no code exists yet.
- Next: shockwave writes `specs/002-*` for US-4/US-5 (violation detail expansion + rating display) or dispatches wheeljack against spec 001, whichever the human picks first.
