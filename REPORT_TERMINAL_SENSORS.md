# REPORT_TERMINAL_SENSORS — pty-manager / tmux-manager / coding-agent-adapters / pty-state-capture
Date: 2026-08-06 · all four repos clean and pushed
(placed in pty-manager; identical copy is the family report)

## 1. Inventory

| package | version | src files | shape |
|---|---|---|---|
| `pty-manager` | 1.12.1 | 15 | PTY lifecycle; `BunCompatiblePTYManager extends EventEmitter` (`src/bun-compat.ts:90`) |
| `tmux-manager` | 0.1.3 | 14 | **the richest state detector** — two EventEmitter layers |
| `coding-agent-adapters` | 0.17.0 | 11 | per-CLI pattern definitions; **not** an EventEmitter |
| `pty-state-capture` | 0.2.1 | 18 | **already an event log** — capture, classify, replay |

### tmux-manager — states and transitions detected today
Session-level states (`src/types.ts:36-39`): `busy` … `error`.
External stall classification (`src/types.ts:129`):
`'waiting_for_input' | 'still_working' | 'task_complete' | 'error'`, with `prompt?` and
`suggestedResponse?` for auto-response.

**42 emit sites, ~17 distinct transitions.** Session layer (`src/tmux-session.ts`):
`status_changed` (`:333,492,1017,1148`), `task_complete` (`:334,493,1149`), `tool_running`
(`:356,733`), `stall_detected` (`:393`), `blocking_prompt` (`:444,446,837,852,911,920`),
`ready` (`:456,537`), `output` (`:595,650`), `exit` (`:687,781,1180`), `message` (`:945`),
`question` (`:948`), `auth_required`/`login_required` (`:1333-1334`).
Manager layer (`src/tmux-manager.ts:144-221`) re-emits each with the session handle attached:
`session_started` (`:144`), `session_ready` (`:165`), `login_required` (`:169`),
`auth_required` (`:173`), `message` (`:189`), `question` (`:193`), `session_stopped` (`:198`),
`session_error` (`:202`), `session_status_changed` (`:206`), `task_complete` (`:210`),
`tool_running` (`:214`), `stall_detected` (`:221`).

Blocking-prompt, stall, settle/completion and auto-response are **all present and wired**.

### coding-agent-adapters — per-CLI coverage
Six adapters: `aider-adapter.ts`, `claude-adapter.ts`, `codex-adapter.ts`,
`gemini-adapter.ts`, `hermes-adapter.ts`, `opencode-adapter.ts`, over
`base-coding-adapter.ts`, plus `approval-presets.ts`.

**Brittleness — better than feared.** Patterns are **data-driven, not hardcoded**:
`src/pattern-loader.ts` + a `src/data/` directory. Detection is externalized configuration, so
a CLI's output change is a data edit, not a code change. This package emits nothing itself
(no `EventEmitter`, no `.emit(`) — it is a *pattern provider* consumed by the managers. That
is the right layering for a sensor: the vocabulary is data, the emission is elsewhere.

## 2. pty-state-capture — **both raw and structured, and it already replays**

Public surface (`src/index.ts:1-36`):
`PTYStateCaptureManager` (`capture-manager.ts`), `SessionStateCapture` (`session-capture.ts`),
`classifyState` + `DEFAULT_STATE_RULES` + `mergeRules` (`state-rules.ts`),
`TurnExtractor` (`turn-extractor.ts`), `VTFrame` (`vt-frame.ts`),
`replayRawJsonl` + `replayTurns` (`replay.ts`),
`diffTranscripts` + `jaccardSimilarity` (`session-diff.ts`),
`normalizeForMatching` + `stripAnsiPreserveText` (`normalize.ts`),
plus `jsonl-writer.ts` and `transcript-builder.ts`.

> **It captures both.** Raw scrollback via `VTFrame` + a JSONL writer, *and* structured states
> via `classifyState`. Critically, `replayRawJsonl` / `replayTurns` mean **the fold-from-a-log
> pattern is already implemented here** — this is the only package in the family (and one of
> very few across all ten repos) that already treats terminal history as a replayable log.
> `session-diff.ts` additionally gives run-to-run comparison for free, which is directly
> useful to the eval-divergence work.

## 3. Emitter design — one seam, and it already exists

**The seam is `tmux-manager/src/tmux-manager.ts:144-221`.**

Every session-level transition is *already* funnelled through this block, which exists solely
to re-emit `TmuxSession` events with the session handle attached. It is a ~15-case
re-emission table in one file, in one contiguous region. Attaching an emitter means one
insertion per case, or one wrapper around the re-emit helper — and no change to detection,
parsing, or PTY behavior.

```
TmuxSession (42 emits, per-session)
        │
        ▼
TmuxManager :144-221   ←── ATTACH HERE: handle is in scope, every event passes through
        │
        ▼
  existing consumers
```

Record shape maps directly onto the sensed-log contract
(`hauntjs/docs/MEMORY-AND-FOLD.md:127-139`):
- **lifecycle** ← `session_started`, `session_ready`, `session_stopped`, `session_error`, `exit`
- **observation** ← `status_changed`, `blocking_prompt`, `stall_detected`, `tool_running`,
  `task_complete`, `question`, `auth_required`
- **belief** ← never emitted; derived in the fold. Note `StallClassification` (`types.ts:129`)
  is *already* an external classifier verdict, so it must be recorded as an observation
  carrying `basis: classifier`, **not** promoted to truth at write time.

**Output digest.** `output` (`tmux-session.ts:595,650`) is the high-volume stream and must not
be emitted raw. Use `pty-state-capture`'s `normalize.ts` + run-length compaction to produce
"stderr active t0–t1, N lines, K signatures" — which is exactly haunt's preprocessor rule
(`MEMORY-AND-FOLD.md:163-164`: "may compress **what it saw**, may never decide **what it
meant**"). `classifyState` output is a *nomination*, not a conclusion.

**Effort: low-to-moderate.** The transitions, the seam, the JSONL writer, the normalizer and
the replayer all exist. The work is (a) a record type, (b) ~15 emitter insertions at one site,
(c) wiring `pty-state-capture`'s writer as the sink, (d) identity stamping (see §5).

## 4. Heartbeats — **not implemented, but cheap here**
No heartbeat exists in any of the four packages. `TmuxSession` already runs a stall-detection
timer (it emits `stall_detected` with a `stallDurationMs`, `tmux-session.ts:393`), so a
periodic tick is **already running** — a heartbeat is an additional emission on an existing
timer, not a new subsystem. This is the cheapest heartbeat surface in the family, and it is
what makes silence interpretable (`MEMORY-AND-FOLD.md:181-182`).

## 5. Identity available at the seam — **partial; this is the gap**
At `tmux-manager.ts:144-221` the session handle is in scope, giving session id and session
status. **Which agent** is inferable from the `coding-agent-adapters` adapter in use (one of
six). **Which task / which repo / which branch is NOT available** — the manager has no notion
of either; `parallax` holds the task/thread identity (`gateway-service.ts:26,447`), and the
repo/branch would have to come from the session's cwd.

> Recommendation: make the caller stamp `{agent, task, repo, branch}` at session-spawn time
> and carry it on the session handle. This is a small additive change and it is the difference
> between a stream of anonymous terminal events and an attributable one. Do not defer it —
> retrofitting identity onto an already-accumulating log is the expensive version.
