## Context

zboard is a Claude Code mod: a plugin of function hooks written in TypeScript/TSX
(`export const register: Register = (on, options) => {...}`, types from
`'claude-code'`). The module hot-reloads in the running session and executes in a
sandbox with no DOM and no Node APIs; every side effect goes through the engine
interface `$` (`$.ui`, `$.agent`, `$.tool`, `$.process`, `$.fs`, `$.store`,
`$.state`, `$.clock`, `$.model`). Engine build referenced: 2.1.289.

Current state: the repository holds only the OpenSpec scaffold. The user runs
OpenSpec changes (and, historically, gentle-ai v4 ODD features) by having one
main Claude session orchestrate many subagents. There is no visibility into
which agent works on which task, phase gates live only in the model's context,
and test results are reported by the model rather than observed.

Constraints (verified against engine types and external tools):

- `$.agent.spawn({prompt, subagentType, description})` returns `{model, agentId}`
  or `{deny}`; `$.agent.register(AgentSpec)` registers `<plugin>:<name>` types
  with `model` and `effort` (low|medium|high|xhigh|max); the `agent.offer` hook
  can hide a type from the model.
- `$.tool.register` declares model-callable tools served by a `tool.call` hook on
  `mcp__<plugin>__<name>`, registered in `session.start`. `$.tool.call` invokes
  MCP tools and passes permission checks.
- `$.process.run(argv, {cwd, env, stdin, timeoutMs})` has no shell, default 30 s
  timeout (max 10 min), and a 4 MiB output cap.
- `$.fs` has no watch: change detection uses the classic `FileChanged` event or
  `$.clock` polling.
- `$.store` is a cross-session JSON KV with a 4 MiB total cap and no
  transactions; `$.state` is per-session, versioned, and survives hot reload.
- Classic events: SubagentStart, SubagentStop (with `agent_transcript_path`),
  TaskCreated, TaskCompleted, PreCompact, PostCompact, FileChanged. Every tool
  call inside a subagent carries `agentId`. Native TaskCreate/TaskUpdate are
  interceptable through `tool.call` matchers.
- Panes: `$.ui.open({id,title})`, drawn by `ui.render` on
  `{component:'Pane', requestId:id}`; user-opened panes seat at any width,
  unasked panes seat only from 144 columns.
- OpenSpec CLI v1.13.1: `instructions apply --json` exposes `tasks[].id` as a
  sequential index, not the `1.1` label; the label is a description prefix and
  sections are absent. `tasks.md` uses `## 1. Section` and `- [ ] 1.1 Text`,
  with indented continuation lines and inline free text such as `BLOCKED on …`.
- Engram: `mem_save` upserts on project+scope+topic_key; 50,000-char cap per
  observation (truncates); 15-minute dedupe window on normalized content hash.
- Repository rules: all tests via `ptest`; conventional commits with no AI
  attribution; never `git add -A`.

Stakeholders: the user (operator of the board), the main Claude session
(orchestrator consumer), `board:*` subagents (workers).

## Goals / Non-Goals

**Goals:**

- Show every task of an OpenSpec change, its phase, its agents, and its blockers
  in a pane that works identically in the terminal and the Desktop Code tab.
- Drive each task through research → plan → tdd → code → review (→ refactor
  loop) deterministically, with gates the mod validates mechanically.
- Never record a pass that was not observed; unknown or ambiguous means not
  passed.
- Survive hot reload, compaction, and session restart without losing execution
  state or corrupting `tasks.md`.
- Keep the domain pure and immutable so it is near-fully unit-tested.
- Keep the main session informed with minimal context cost.

**Non-Goals:**

- Web UI or any surface outside Claude Code.
- Multi-session or team synchronization (not precluded: events are the future
  sync unit).
- Per-task git worktrees.
- Drag-drop, reassign, or cancel from the board; editing plans from the board.
- Real cloud operations, database migrations, or model APIs other than engine
  agent spawning.

## Decisions

### D1. Surface: mod pane, not a web app

The board is a pane (`id: zboard`) rendered through `ui.render`. Same component
tree for `terminal` and `desktop`. `/zboard` opens it on user action; auto-open on
an active change uses the unasked path and therefore only seats from 144 columns.
*Alternative:* local web app — rejected: requires a server and a browser, and
breaks the "product runtime needs no extra services" constraint.

### D2. Architecture: hexagonal, event-sourced (approach A)

```
engine events / tool calls
        │
 runtime/capture.ts ──► domain events ──► $.state log (append-only)
                                              │
                         domain/project.ts (pure fold) ──► Board ──► ui/*
                                              │
                         domain/pipeline.ts (pure next) ──► Action
                                              │
                         runtime/orchestrator.ts ──► adapters/* ──► $
```

Module tree:

| Path | Responsibility |
|------|----------------|
| `hooks/register.tsx` | Wiring only: subscribes hooks, builds adapters, no logic. |
| `domain/events.ts` | Discriminated union of domain events. |
| `domain/project.ts` | Pure fold `project(events) → Board`. |
| `domain/pipeline.ts` | Pure state machine `next(task, event) → Action`. |
| `domain/scheduler.ts` | Pure selection of runnable tasks (deps, concurrency, file conflicts). |
| `adapters/openspec.ts` | `tasks.md` parse/flip, OpenSpec CLI JSON calls. |
| `adapters/odd.ts` | ODD feature document parser and OpenSpec generator. |
| `adapters/engram.ts` | Debounced upsert, artifact store, search/get. |
| `adapters/agents.ts` | Registers `board:*` agent types, spawns per phase. |
| `adapters/ptest.ts` | Runs scoped `ptest` and classifies the end line/exit code. |
| `adapters/git.ts` | Task-scoped staging and commit. |
| `runtime/orchestrator.ts` | Executes Actions; owns timers and concurrency slots. |
| `runtime/capture.ts` | Engine events and tool calls → domain events. |
| `runtime/inject.ts` | Comment delivery into spawn prompts or next tool results. |
| `runtime/guard.ts` | Edit/Write allowed-file enforcement. |
| `tools/board-tools.ts` | Model-callable board tools (write and read). |
| `ui/Pane.tsx`, `ui/KanbanView.tsx`, `ui/SwimlaneView.tsx`, `ui/TreeView.tsx`, `ui/parts/*` | Rendering only (Card, AgentChip, Stepper, ProgressBar). |
| `types/index.d.ts` | `PluginState` contract for `$.state`. |

Rules: `domain/` never imports `$` or adapters; all domain values are immutable
(new objects on every change); adapters expose small typed ports so runtime tests
can substitute the harness engine.

*Alternatives:* mutable board store (B) — rejected for entangled rules and no
replay; viewer-only mod with model-driven orchestration (C) — rejected because
gates and concurrency become unenforceable and the model could invent passes.

### D3. Data model

```ts
type TaskStatus = 'backlog'|'ready'|'running'|'review'|'needs_decision'|'blocked'|'done'
type Phase = 'research'|'plan'|'tdd'|'code'|'review'|'refactor'
interface Task {
  id: string            // OpenSpec label, e.g. "2.1"
  changeId: string
  title: string; section: string
  dependsOn: string[]   // labels
  status: TaskStatus; phase: Phase | null; loop: number
  priority: number
  allowedFiles: string[]
  agents: AgentRun[]; comments: Comment[]
  source: 'openspec'|'native'|'board'
}
interface AgentRun {
  agentId: string; agentType: string; phase: Phase; taskId: string
  model: string; effort?: string
  startedAt: number; endedAt?: number; lastActivityAt: number
  currentTool?: string; tokens: number
  outcome?: 'ok'|'gate_failed'|'denied'|'error'|'interrupted'
  artifactKey?: string; transcriptPath?: string
}
interface Comment { id: string; author: 'user'|'main'|string; text: string; at: number; deliveredTo?: string }
interface ReviewVerdict { verdict: 'approve'|'changes'
  findings: { severity: 'high'|'medium'|'low'; file: string; line?: number; issue: string }[] }
```

Task identity is `changeId + label`, never the OpenSpec JSON index (which is a
sequential position and shifts when tasks are inserted). `priority` supports the
"prioritize" interaction; it orders runnable tasks only.

Events: `ChangeLoaded`, `TaskCreated`, `TaskUpdated`, `PhaseStarted`,
`AgentActivity`, `PhaseCompleted{gate: pass|fail, reason?}`,
`ReviewVerdictRecorded`, `CommentAdded`, `CommentDelivered`,
`TaskStatusChanged{from,to,reason}`, `ModError`. Each event carries `seq`, `at`,
and `changeId`.

Log compaction: after N events (initially 500) the log stores
`{snapshot: Board, tail: Event[]}`; `project(snapshot, tail)` equals
`project(fullLog)`, which is a tested property.

### D4. Pipeline state machine (mod-driven)

```
ready → research → plan → tdd(RED) → code(GREEN) → review ─approve→ done
                                                    └changes→ refactor → review (loop+1)
loop reaches cap (3) with changes → needs_decision
```

`pipeline.next(task, event)` returns one of `spawn(phase)`, `advance(phase)`,
`loop`, `escalate(reason)`, `done`. The orchestrator only executes them.

Phase contracts (output is a JSON artifact validated by the mod):

| Phase | Agent | Output contract | Gate |
|-------|-------|-----------------|------|
| research | `board:researcher` (read-only) | findings with `path:line` evidence, risks, existing tests | ≥1 evidenced finding and valid JSON |
| plan | `board:planner` (read-only) | `{approach, allowedFiles[], testCases[], edgeCases[], risks}`; minimal change without removing robustness | `allowedFiles` non-empty, every path normalized and inside the repo; `testCases` non-empty |
| tdd | `board:tdd` | tests written | scoped `ptest` on the task's test files FAILS, and only because of the new tests |
| code | `board:implementer` | implementation | scoped `ptest` GREEN; only `allowedFiles` and the task's tests touched |
| review | `board:reviewer` (read-only) | `ReviewVerdict` JSON | valid verdict; `changes` requires ≥1 finding |
| refactor | `board:refactorer` | fixes for review findings only | scoped `ptest` GREEN |

Gate failure → relaunch the same phase once with the failure reason injected;
second failure → `needs_decision` and a notice to the main session. Each phase
artifact is stored in Engram and injected into the next phase's prompt.

"Only because of the new tests" (tdd gate) is determined by running the task's
test files: failures must be confined to test cases added in this phase, and
pre-existing tests in those files must not newly fail. Anything ambiguous fails
the gate.

*Alternative:* let the main Claude advance phases — rejected (non-deterministic,
can skip gates, costs main-session context).

### D5. Scheduler

Pure function over the Board: a task is runnable when its status is `ready`, all
`dependsOn` are `done`, it is not paused or blocked, and the running count is
below the concurrency limit (default 3). Two tasks whose plans share any
`allowedFiles` entry never run `code` or `refactor` concurrently; the second
waits and the board shows the wait reason (e.g. `⏸ waits 1.2 for auth.ts`).
Ordering: priority, then label order. All tasks share one working tree (no
worktrees). The pipeline starts only via `/zboard run <change>` or
`/zboard run <change>/<label>`; `/zboard pause` lets in-flight phases finish and
launches none.

### D6. Allowed-file guard

A `tool.call` hook on Edit/Write (and other file-mutating tools) resolves the
calling `agentId` to its AgentRun. For `code`/`refactor` runs, the target path
is normalized (resolving `..`, symlink-free comparison against the repo root) and
denied with a clear message unless it is in `allowedFiles` or is one of the
task's test files. Three denies in one phase escalate to `needs_decision`
("plan too narrow"). Read-only phases deny all mutating tools.

### D7. Test execution and commit

Gates call `ptest <task test files>` through `$.process.run` with an explicit
`timeoutMs` (≤10 min), never a raw runner. Exit 0 = pass, 1 = fail; exit
70/75/124 → retry once without code changes, repeat → `needs_decision` with
ptest's end line. Any other or missing result = not passed.

On task close: stage exactly the task's touched files (`git add -- <paths>`,
never `-A`), commit `feat(<change>): <label> <title>` with no AI attribution,
then flip `- [ ] <label>` to `- [x] <label>` in `tasks.md` only after re-reading
the file and confirming the line is byte-identical to what was read. A commit
failure (including a mutating hook) leaves the task unchecked and sets
`needs_decision`.

### D8. Task capture and interactions

Sources: board tools (`board_create_task`, `board_comment`, `board_move`,
`board_assign`, …), native `TaskCreate`/`TaskUpdate` intercepted via `tool.call`
and mirrored as `source: native` tasks, and OpenSpec `tasks.md` (`source:
openspec`). Classic SubagentStart/SubagentStop open and close AgentRuns; every
tool call with an `agentId` updates `lastActivityAt`, `currentTool`, and tokens.

Comment delivery (`runtime/inject.ts`): if the assigned agent has not spawned,
the comment is appended to its spawn prompt; if it is running, it is appended as
a delimited note to the result of that agent's next tool call. The note is
wrapped in explicit delimiters and labelled as untrusted data
(`<zboard-comment author=… id=…>…</zboard-comment>`, with delimiter sequences in
the text escaped). Delivery emits `CommentDelivered{to}`. Block/unblock and
prioritize emit `TaskStatusChanged`/`TaskUpdated`.

### D9. Persistence split

| Store | Owns | Keys |
|-------|------|------|
| `tasks.md` (git) | structure, done-state | label lines |
| Engram | execution state, artifacts | `zboard/<project>/<change>/<task>`, `zboard/<project>/<change>/<task>/<phase>[-N]`, `zboard/<project>/<change>/index` |
| `$.state` | event log + projection cache | `PluginState` |
| `$.store` | UI prefs (view, filter) | `zboard/prefs` |

Engram writes go through `$.tool.call` on `mcp__engram__mem_save` with the
plugin shipping an allow rule. Upserts are debounced (10 s) and always flushed on
`PreCompact`. Payloads carry `rev` and `updatedAt` so identical content never
falls into the 15-minute dedupe window. Artifacts over 50,000 characters are
truncated with an explicit marker plus the transcript path. If Engram is
unavailable, the board keeps running on `$.state`, the header shows
`⚠ mirror pending`, and the next flush retries; the pipeline never blocks on
Engram.

External `tasks.md` edits are detected via `FileChanged` or a 5 s `$.clock`
poll and produce `ChangeLoaded` for reconciliation.

Recovery (on `session.start` and `PostCompact`): read `tasks.md` and the Engram
index/tasks, rebuild via `project()`, and mark every phase whose agent is absent
from `$.agent.list()` as `interrupted`, then relaunch it with its partial
artifact.

### D10. Main-session visibility

Read tools: `board_status`, `board_task(taskId)`, `board_artifact(taskId,
phase)`, `board_agent(agentId)` (includes transcript path). Notices are injected
only for `needs_decision`, gate-failure escalation, and change completion. The
main session can comment through `board_comment`.

### D11. Agent model/effort configuration

Six agent types registered as `zboard:<name>` (shown as `board:*`) with defaults:
researcher sonnet 5.5/medium, planner opus 5.5/xhigh, tdd sonnet 5.5/low,
implementer sonnet 5.5/medium, reviewer opus 5.5/high, refactorer sonnet
5.5/medium. Precedence, most specific wins: per-task override
(`/zboard set <label> <agent> <model> <effort>`) > project `.zboard/config.json`
> global userConfig pickers > defaults. Invalid model or effort → default plus a
header warning; effort is ignored for models without effort support. Optional
auto-escalation (off by default) raises refactorer effort one step on loop 3.
`/zboard config` shows the effective value and its source per agent.

### D12. ODD import

`/zboard import-odd <feature>` reads `odd/tasks/<feature>.md` and its Engram
mirror `odd/<feature>/tasks` (newest wins), then generates
`openspec/changes/<feature>/`: `proposal.md` from Objective/Problem/Why/Scope,
`tasks.md` mapping `T<n>` → `1.<n>` preserving `[x]`, `design.md` from
Constraints/Acceptance. Route/Commit per task are stored in Engram as history.
It shows a preview and writes only after confirmation, refuses to overwrite an
existing change directory, and never modifies the ODD source.

### D13. UI

Header: `zboard · <change> ▓▓▓░░ 7/12 · 3 agents · ⚠ 1 decision · 182k tok [v] Kanban`
(plus `⚠ mirror pending`, config warnings, and ModError count when present).
Views: Kanban (Ready/Running/Review/Decision/Done; card shows stepper
`R✓ P✓ T✓ C● Rv○ ↺1`, agent chip with model/effort, current tool, elapsed,
tokens), Swimlanes by agent (heartbeat 🟢 / 🟠 idle >5 min / 🔴 error; queue
with wait reasons), Tree+detail (change → sections → tasks; task page with
acceptance status, phases with gate results and artifact summary, run timeline,
comment thread with "delivered to <agent>"). Keys: arrows, enter, `c`, `b`, `p`,
`v`, `f`, `a`, `esc`.

### D14. Error isolation

Every hook body is wrapped; an exception is recorded as `ModError` (with hook
name and task id when known) and shown in the header. One broken task never
takes down the board or the other tasks' pipelines.

## Risks / Trade-offs

- [Shared working tree lets concurrent tasks interfere] → allowed-file guard,
  no concurrent code/refactor on overlapping files, task-scoped staging.
- [Scoped ptest may miss cross-task regressions] → each gate is iteration
  evidence only; the change is complete only after an integrated `ptest --full`
  run outside the per-task pipeline (operator responsibility, surfaced on change
  completion notice).
- [Engram dedupe or truncation hides state] → `rev`/`updatedAt` in payloads;
  explicit truncation marker plus transcript path.
- [Event log growth vs. state budgets] → snapshot + tail compaction with a
  tested equivalence property.
- [Comment text used for prompt injection] → delimited, escaped, labelled as
  data; never concatenated into instructions.
- [Planner proposes paths outside the repo or traversal] → plan gate rejects;
  guard re-validates every write.
- [tasks.md edited concurrently by the user] → byte-identical re-read check
  before flipping; mismatch → no write and `needs_decision`.
- [Spawned agents consume cost unexpectedly] → explicit start command only,
  concurrency cap, per-model token totals in the header.
- [Engine API gaps (note injection shape, FileChanged coverage)] → isolated in
  `runtime/inject.ts` and the poll fallback; confirmed early in implementation.

## Migration Plan

Greenfield plugin; no data migration. Install by adding the plugin to Claude
Code; validate with `claude plugin validate`. Rollback is uninstalling the
plugin: `tasks.md` and git history remain valid on their own, and Engram
observations under `zboard/*` are inert.

## Open Questions

- Exact `tool.call` result-rewrite shape for appending a delimited note to a
  subagent's next tool result.
- Whether `FileChanged` covers edits from external processes on every surface,
  or the 5 s poll must always run.
- Initial snapshot threshold N (500 proposed) to be tuned against state budgets.
