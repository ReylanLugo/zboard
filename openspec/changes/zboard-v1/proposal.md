## Why

When one Claude Code session orchestrates many subagents through an OpenSpec plan, there is no shared view of which task each agent is on, which phase it reached, why it is waiting, or whether its tests actually passed. Sequencing, gates and file boundaries live only in the main model's context, so they drift, get skipped, or are lost on compaction. zboard makes that work visible and deterministic: a board inside Claude Code that shows every task and agent, and a mod-driven pipeline that validates each phase mechanically and never reports a pass it did not observe.

## What Changes

- New Claude Code mod `zboard` (plugin of function hooks) with a pane rendered in the terminal and in the Desktop Code tab.
- New deterministic per-task pipeline (research → plan → tdd → code → review → refactor loop) executed by mod-registered `board:*` subagents, with mechanical gates, scoped `ptest` runs, allowed-file enforcement, per-task commits, and `tasks.md` checkbox flips.
- New task capture: zboard model-callable tools plus automatic mirroring of native `TaskCreate`/`TaskUpdate`; comments delivered to the assigned agent as delimited data.
- New persistence split: OpenSpec `tasks.md` (structure, done-state), Engram (execution state, artifacts), `$.state` event log (session), `$.store` (UI prefs); recovery on `session.start` and `PostCompact`.
- New read tools and actionable-only notices for the main Claude session.
- New per-agent model/effort configuration with three precedence levels.
- New `/zboard import-odd <feature>` converting a gentle-ai ODD feature into an OpenSpec change after preview and confirmation.
- Slash commands: `/zboard`, `/zboard run <change>[/<label>]`, `/zboard pause`, `/zboard set`, `/zboard config`, `/zboard import-odd`.

## Capabilities

### New Capabilities
- `task-pipeline`: Per-task phase state machine, phase contracts and gates, scheduler (dependencies, concurrency, file conflicts), allowed-file enforcement, test execution via ptest, per-task commit and checkbox flip, error escalation.
- `board-capture`: Task sources (board tools, native TaskCreate/TaskUpdate mirroring), engine-event capture into domain events, agent run tracking, user interactions (comment, block, prioritize) and comment delivery to agents.
- `board-persistence`: Event log and projection, tasks.md read/reconcile/write rules, Engram mirroring and artifact storage, degradation when Engram is unavailable, recovery after reload and compaction.
- `board-ui`: Pane lifecycle, header, Kanban/Swimlane/Tree views, task detail page, keyboard interaction, parity across terminal and desktop.
- `agent-model-config`: Per-agent model and effort defaults, three-level precedence, validation and fallback, optional auto-escalation, effective-config display.
- `main-session-visibility`: On-demand read tools for the main Claude session and actionable-only notices.
- `odd-import`: Conversion of a gentle-ai ODD feature document into an OpenSpec change with preview, confirmation, and no modification of the source.

### Modified Capabilities
<!-- None: openspec/specs/ is empty; this change introduces all capabilities. -->

## Impact

- New repository content: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.tsx`, `types/index.d.ts`, and modules under `domain/`, `adapters/`, `runtime/`, `tools/`, `ui/`, with `*.test.ts` run by `claude plugin test`.
- Engine APIs used: `$.ui`, `$.agent`, `$.tool`, `$.process`, `$.fs`, `$.store`, `$.state`, `$.clock`; classic events SubagentStart/SubagentStop/TaskCreated/TaskCompleted/PreCompact/PostCompact/FileChanged; `tool.call` interception of Edit/Write/TaskCreate/TaskUpdate.
- External dependencies: OpenSpec CLI (v1.13.1 JSON outputs), `ptest` CLI, `git`, Engram MCP tools (`mem_save`, `mem_search`, `mem_get_observation`); the plugin ships an allow rule for `mcp__engram__*`.
- Writes into user repositories: `tasks.md` checkbox lines, task-scoped commits, `openspec/changes/<feature>/` on ODD import, optional `.zboard/config.json` reads.
- No web UI, cloud services, or model APIs beyond agent spawning through the engine.
