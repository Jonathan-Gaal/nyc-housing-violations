# NYC Open Data Project — Agent Vulnerabilities & Fixes

Three of the eight project agents carried forward vulnerabilities from the main suite. All fixed.

---

## **Vulnerability #1: Jazz — Missing Incompleteness Check**

**Agent:** jazz.md  
**Severity:** Medium (silent confidence)  
**Root cause:** Fix #6 in main suite added "Incompleteness" as a 5th audit mode; Jazz prompt still references "four failure modes"

**The problem:**
- Jazz audits for poisoning, distraction, confusion, clash
- But doesn't explicitly verify that every declared input in `codebase-map.md` was actually located and read
- Can report "audit is clean" when critical files were skipped
- Downstream agents trust the audit, building against incomplete context

**Fix applied:**
```markdown
6. Audit the existing context for five failure modes and report what you find:
   - **Poisoning** — a claim in the wiki that the code contradicts
   - **Distraction** — detail carried forward that no longer matters
   - **Confusion** — ambiguous or undocumented dependencies
   - **Clash** — two sources of truth that disagree
   - **Incompleteness** — verify every file listed as required in 
     `wiki/context/codebase-map.md` was actually located and read. 
     Flag any declared input you could not find; it is a real gap, 
     not a false alarm.
```

**Impact:** Jazz now distinguishes between "context is poisoned" and "context is incomplete," preventing false confidence.

---

## **Vulnerability #2: Optimus Prime — Ambiguous Rejection Routing**

**Agent:** optimus-prime.md  
**Severity:** High (agent hesitation/inconsistency)  
**Root cause:** Fix #7 in main suite added deterministic routing; Optimus Prime prompt still uses "shockwave or the human" (ambiguous)

**The problem:**
- Optimus Prime can reject for: over-cap, missing oracle, design flaw, or ambiguous requirement
- Current rule: "shockwave or the human fixes it"
- Leaves the agent to decide routing on each rejection
- Same issue gets routed differently on different runs
- Causes retries and inconsistent decisions

**Fix applied:**
```markdown
- **Rejection routing — deterministic, never ambiguous:** 
  Over-file-cap or over-reference-cap → route to Shockwave for re-split. 
  Design flaw (e.g. wrong pattern, inefficient algorithm) or missing oracle → 
  route to human. Ambiguous requirement (Jazz didn't provide it, spec 
  assumes unstated knowledge) → route to human. Do not route to both; 
  pick the first category that applies.
```

**Impact:** Optimus Prime now routes deterministically; no hesitation, no inconsistency.

---

## **Vulnerability #3: Wheeljack — Two Process Gaps**

**Agent:** wheeljack.md  
**Severity:** High (build stalls, retry ambiguity)  
**Root cause:** Fixes #4 and #5 in main suite clarified cycle definition and dependency escalation; Wheeljack prompt is incomplete

### Gap 3a: Cycle Definition (Fix #5)

**Problem:** "Max 2 retry cycles" doesn't define what a cycle is.
- Is the initial run a cycle, or do cycles only count retries?
- Is it 2 attempts or 3?
- When does escalation happen?

**Fix applied:**
```markdown
5. **On a ratchet FAIL**: continue in this same context — do not restart 
   fresh. A cycle = your build + Ratchet's Mode 2 review. You get 
   2 failed cycles max; after the 2nd FAIL, the Orchestrator escalates 
   directly to human without asking. After 2nd FAIL, **stop and wait** — 
   do not start a 3rd cycle.
```

**Impact:** Wheeljack now knows exactly when to stop; escalation is deterministic.

---

### Gap 3b: Dependency Escalation (Fix #4)

**Problem:** "Halt and request a spec update from shockwave" is incomplete.
- No mention of [DEPENDENCY-REQUEST] block
- No mention of logging to log.md
- No mention that Orchestrator re-invokes Shockwave (not Wheeljack)
- No mention that amended spec re-enters at Optimus Prime
- No mention that builder resumes only after approval

Build stalls indefinitely while Wheeljack waits for unspecified next steps.

**Fix applied:**
```markdown
6. **Need a new dependency?** Halt immediately. Log the discovery and 
   justification to `log.md`. Emit a formal `[DEPENDENCY-REQUEST]` block 
   to the Orchestrator with: package name, version, and reason. Do not 
   install it yourself. The Orchestrator will re-invoke Shockwave narrowly 
   on the dependency decision. Shockwave reviews, approves or rejects, and 
   amends the [SPEC] if approved. The amended spec re-enters review at 
   Optimus Prime. Only resume work after Orchestrator confirms amended 
   spec is approved.
```

**Impact:** Wheeljack now has a defined escalation path; no more stalled builds.

---

## **Agents with No Vulnerabilities**

These agents are consistent with the fixed main suite:

- ✅ **teletraan-1.md** — screening logic is isolated, no dependencies on fixes
- ✅ **red-alert.md** — security audit split (Mode 1/2) is independent
- ✅ **ratchet.md** — oracle verification is independent
- ✅ **bumblebee.md** — integration testing is independent
- ✅ **shockwave.md** — includes project-level override of Simplicity > Pattern Purity (per Fix #3), correctly documented

---

## **Summary**

| Agent | Vulnerability | Type | Fix |
|-------|---------------|------|-----|
| Jazz | Missing Incompleteness audit | Process gap | Added 5th audit mode |
| Optimus Prime | Ambiguous rejection routing | Authority ambiguity | Made routing deterministic |
| Wheeljack (a) | Cycle definition undefined | Terminology | Defined 2 cycles = max attempts |
| Wheeljack (b) | Dependency escalation incomplete | Pipeline gap | Detailed full escalation path |
| Teletraan-1 | — | — | ✅ Clean |
| Red-Alert | — | — | ✅ Clean |
| Ratchet | — | — | ✅ Clean |
| Bumblebee | — | — | ✅ Clean |
| Shockwave | — | — | ✅ Clean (override documented) |

---

## **Ready to Deploy**

All eight agents in `/mnt/user-data/outputs/` are now consistent with the fixed main suite spec. No agent will hesitate, loop, or make inconsistent decisions on these dimensions.

Use these agents alongside the fixed AGENT-SUITE-FULL-FIXED.md when you spin up the new `native_ai/` iteration.
