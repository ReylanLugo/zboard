# Brainstorm: zboard-v1

> Brainstorming for this change was conducted interactively with the user in the
> parent Claude Code session (Superpowers brainstorming flow: context exploration,
> one question at a time, approach comparison, section-by-section approval).
> This file records the outcome of that session; every decision below was
> explicitly approved by the user.

## Design Summary

zboard is a Claude Code mod (a plugin of function hooks in TypeScript/TSX that
hot-reloads inside the engine sandbox and reaches the outside world only through
the engine interface `$`). It renders a task board inside Claude Code — in the
terminal pane and in the Desktop Code tab — for the tasks of an OpenSpec change
and for the subagents executing them.

The mod does not merely display work; it deterministically drives a per-task
pipeline (research → plan → tdd → code → review → refactor loop) by spawning
dedicated `board:*` subagents, validating each phase's output with mechanical
gates (JSON contracts, scoped `ptest` runs, allowed-file enforcement), and
committing each finished task. The main Claude session stays informed through
on-demand read tools and short notices for actionable events only.

Data is split by ownership: OpenSpec `tasks.md` (in git) owns plan structure and
done-state; Engram owns execution state (status, phase, loop count, agent runs,
comments, phase artifacts); an append-only event log in `$.state` is the
in-session source, projected purely into the Board that the UI renders.

## Q&A Decisions (interactive session)

| # | Question | Decision |
|---|----------|----------|
| 1 | Where does the board live? | Inside Claude Code as a mod pane (terminal and desktop). Not a web app. |
| 2 | Where do tasks come from? | zboard's own model-callable tools (`board_create_task`, `board_comment`, `board_move`, `board_assign`, …) as the rich model, plus automatic mirroring of native `TaskCreate`/`TaskUpdate` so nothing is lost. |
| 3 | What is the source of truth? | `tasks.md` owns structure and done-state; Engram owns execution state. |
| 4 | What scale? | One Claude Code session orchestrating many subagents. Multi-session/team is a v1 non-goal but must not be precluded. |
| 5 | Which views? | Kanban by status, Swimlanes by agent, Tree+detail — all over the same data, toggled with `[v]`. |
| 6 | How interactive? | Light: comment (delivered to the assigned agent), block/unblock, prioritize. No drag-drop, reassign, or cancel. |
| 7 | Which architecture? | Approach A: hexagonal, append-only event log in `$.state`, pure projection into the Board. |
| 8 | Data model? | Task / AgentRun / Comment / ReviewVerdict and a closed event union; identity is `changeId + label`. |
| 9 | Who drives the pipeline? | The mod, deterministically — not the main Claude. Phase contracts and gates validated by the mod. |
| 10 | Scheduling rules? | Max 3 running tasks, dependency-ordered, no concurrent code/refactor on overlapping allowed files, shared working tree, per-task commit, explicit `/zboard run` start. |
| 11 | How does main Claude see the board? | On-demand read tools plus short notices only for actionable events. |
| 12 | Persistence and recovery? | tasks.md + Engram topic keys + `$.state` + `$.store`; reconcile on external edits; degrade when Engram is down; rehydrate on `session.start` and `PostCompact`. |
| 13 | ODD compatibility? | `/zboard import-odd <feature>` converts a gentle-ai ODD feature into an OpenSpec change after preview and confirmation; never modifies the ODD source. |
| 14 | Model/effort per agent? | Configurable at three levels (global pickers, project file, per-task override); most specific wins. |
| 15 | UI details? | Header with progress, agent count, decisions, tokens; Notion-like task page; keyboard-only navigation; same component tree on both surfaces. |
| 16 | Error handling? | Retry once then `needs_decision`; never invent a PASS; one broken task never takes down the board. |
| 17 | Testing? | `claude plugin test` with TDD; domain near 100% coverage, overall ≥80%; negative/security tests included. |

## Alternatives Considered

### Approach A: Hexagonal event-sourced mod (chosen)
- **How**: Engine events and tool calls are translated into domain events appended
  to a log in `$.state`; a pure `project(events) → Board` fold and a pure
  `pipeline.next(task, event) → Action` state machine decide everything; a thin
  orchestrator executes actions through adapters.
- **Pros**: Pure, fully unit-testable domain; deterministic replay for recovery
  after hot reload and compaction; clean seam for future multi-session sync
  (events are the sync unit); UI is a pure function of the Board.
- **Cons**: More upfront structure; log growth requires snapshot compaction.
- **Outcome**: Adopted.

### Approach B: Mutable board store
- **How**: Keep a single mutable Board object in `$.state` and update it in place
  from each hook.
- **Pros**: Fewer modules; quick to start.
- **Cons**: Hook handlers become entangled with business rules; hard to test
  transitions in isolation; no audit trail for run timelines; recovery and
  future multi-session merge are ad hoc.
- **Why not adopted**: Loses determinism and testability, which the gate-driven
  pipeline depends on.

### Approach C: Viewer mod with model-driven orchestration
- **How**: The mod only renders; the main Claude drives the pipeline through a
  skill/prompt, spawning subagents and updating the board via tools.
- **Pros**: Least mod code; flexible.
- **Cons**: Non-deterministic sequencing; gates can be skipped or "passed" by the
  model; consumes main-session context; concurrency and file-conflict rules are
  unenforceable.
- **Why not adopted**: Violates the principle "never invent a PASS"; the user
  wanted the mod, not the model, to own the pipeline.

## Agreed Approach

Approach A. The domain (`domain/events.ts`, `domain/project.ts`,
`domain/pipeline.ts`) is pure, immutable, and free of `$`. Adapters wrap OpenSpec,
ODD, Engram, and agent spawning. The runtime layer (orchestrator, capture,
inject) maps engine events to domain events and executes actions. Tools expose
the board to the model; the UI renders the projected Board. It won because it is
the only option that makes gates, scheduling, and recovery deterministic and
testable while keeping a path open to multi-session sync.

## Key Decisions

- Defaults: concurrency 3; review loop cap 3; heartbeat amber after 5 minutes
  idle; Engram flush debounce 10 s and always on `PreCompact`.
- Gate failure relaunches the same phase once with the failure reason; a second
  failure sets `needs_decision` and notifies the main session.
- During code/refactor, Edit/Write outside the task's `allowedFiles` is denied;
  3 denies in one phase escalate as "plan too narrow".
- Tests run only through `ptest` via `$.process.run`; exit 70/75/124 never counts
  as a pass.
- Commits use `feat(<change>): <label> <title>`, stage only the task's files, and
  carry no AI attribution; the `tasks.md` checkbox flips only on the exact label
  line after a re-read check.
- Agent defaults: researcher sonnet 5.5/medium, planner opus 5.5/xhigh, tdd
  sonnet 5.5/low, implementer sonnet 5.5/medium, reviewer opus 5.5/high,
  refactorer sonnet 5.5/medium.
- Comments are delivered to agents as delimited data, never as instructions.
- Non-goals v1: web UI, multi-session/team sync, per-task worktrees,
  drag-drop/reassign/cancel, editing plans from the board, real cloud ops.

## Open Questions

- Exact engine semantics for injecting a note into a subagent's next tool result
  (payload shape of the `tool.call` result rewrite) must be confirmed against the
  engine types during implementation.
- Whether `FileChanged` fires for `tasks.md` edits made by other processes in all
  surfaces, or whether the 5 s `$.clock` poll is always required.
- Snapshot threshold N for event-log compaction (to be tuned against the 4 MiB
  `$.store`/state budgets during implementation).
