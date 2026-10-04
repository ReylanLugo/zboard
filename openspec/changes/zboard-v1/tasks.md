## 1. Scaffold and test harness

- [x] 1.1 Create branch `feat/zboard-v1`, the plugin manifest with userConfig pickers, `hooks/hooks.json`, `tsconfig.json`, `.gitignore` and a minimal `hooks/register.tsx`; run the harness spikes (import extensions, `session.start` in tests, native `$.state`, test filter) and `claude plugin validate`
- [x] 1.2 Add the in-memory test world (`hooks/testing/world.ts`) that answers fs, process, agents, tools, commands, panes, session, state and classic events beneath the plugin, with its self-test

## 2. Domain model and event log

- [x] 2.1 Define domain types and events and the pure `project` fold for task lifecycle events (ChangeLoaded reconcile, TaskCreated/Updated/Removed/Restored, TaskStatusChanged, comments, RunControl, MirrorState, ConfigWarnings, ModError)
- [x] 2.2 Extend `project` for agent and phase events (PhaseStarted, AgentActivity, AgentStopped, PhaseCompleted, ReviewVerdictRecorded, GuardDenied) and the `taskOfAgent`/`activeRun` lookups
- [x] 2.3 Add the append-only log with snapshot-plus-tail compaction (threshold 500), the equivalence property test and the state-size spike

## 3. Phase gates and pipeline state machine

- [x] 3.1 Add JSON artifact extraction, repo-path normalization and the research, plan and review gates
- [x] 3.2 Add the tdd, code/refactor (green) and read-only touched-files gates over ptest results and touched paths
- [x] 3.3 Add the pure `pipeline.next(task, input)` returning advance, spawn (retry), loop, escalate or done, with the review loop cap of 3

## 4. Scheduler

- [x] 4.1 Add the pure scheduler: runnable selection (status, dependencies, scope, priority, concurrency 3) and the code/refactor allowed-file conflict with its wait reason

## 5. Adapters

- [x] 5.1 Add the pure `tasks.md` parser (sections, labels, continuation lines, `BLOCKED on`, explicit and section-barrier dependencies) and the byte-preserving checkbox flip
- [x] 5.2 Add the OpenSpec IO adapter: change-name validation, change loading and the re-read-then-flip write
- [x] 5.3 Add the ptest adapter: per-file `ptest <file>` runs via `$.process.run`, exit classification, one retry for 70/75/124 and timeouts, end line and failure parsing
- [x] 5.4 Add the git adapter: porcelain snapshot with blob hashes, touched-path diff, task-scoped `commit --only` with post-commit verification
- [x] 5.5 Add the Engram adapter: topic keys, artifact truncation, debounced mirror with rev/updatedAt and pending flag, topic fetch (read-format spike) and the `tool.check` allow for zboard's own Engram calls
- [x] 5.6 Add model/effort configuration: model table, defaults, three-level precedence with sources, invalid-value fallback, malformed project config, auto-escalation
- [x] 5.7 Add the agents adapter and prompts: six `zboard:*` types, hidden from the model via `agent.offer`, per-role serialized re-register-then-spawn with model and effort (effort spike), phase prompts
- [x] 5.8 Add the ODD adapter: feature-name validation, ODD document parsing with unparsed lines, OpenSpec change generation and preview text

## 6. Runtime

- [x] 6.1 Add the state-backed log store, artifact store, hook error isolation (`ModError`) and the read tools `board_status`, `board_task`, `board_artifact`, `board_agent`; remove the Task 1.1 probe code
- [x] 6.2 Add `/zboard` argument parsing with the open, `run <change>[/<label>]` and `pause` subcommands, and the orchestrator start: tick, pending phases, spawn with resolved model/effort, spawn deny to blocked, config warnings
- [x] 6.3 Add engine capture: SubagentStart/SubagentStop runs, tool-call activity, `turn.complete` tokens, unknown agents ignored, and the agent-stop bus
- [x] 6.4 Add phase completion: gate evaluation on SubagentStop with touched-file snapshots and scoped ptest, artifacts, retry once, escalate, loop, duplicate-stop guard, per-task error isolation, pause semantics
- [x] 6.5 Add task close: task-scoped commit, verified flip of the `tasks.md` line, failure to `needs_decision`, change completion
- [x] 6.6 Add native `TaskCreate`/`TaskUpdate` mirroring without altering the native result
- [x] 6.7 Add the allowed-file guard: read-only phase denies, tdd/code/refactor allow-lists with lexical and real-path placement, third deny escalates "plan too narrow"
- [x] 6.8 Add the `tasks.md` watcher (5 s poll plus FileChanged via SessionStart watchPaths, spike), Engram mirror wiring with PreCompact flush, and recovery on `session.start`/`PostCompact` with interrupted-run relaunch and pane auto-open

## 7. Board tools, comments and notices

- [x] 7.1 Add input validation, shared interactions (comment, block/unblock, prioritize, move, assign) and the tools `board_create_task`, `board_comment`, `board_move`, `board_assign`
- [x] 7.2 Add comment escaping and delivery: spawn-prompt delivery, running-agent delivery through the next tool result (context spike), `CommentDelivered`
- [ ] 7.3 Add actionable-only main-session notices (needs_decision, escalation, change completion with the `ptest --full` reminder)

## 8. Slash commands

- [ ] 8.1 Add `/zboard set <label> <agent> <model> <effort>` and `/zboard config` with effective values and sources
- [ ] 8.2 Add `/zboard import-odd <feature>` with newest-source selection, preview, confirmation by digest, refusal on existing target and Engram history

## 9. UI parts

- [ ] 9.1 Add pure UI formatting: header line, progress bar, phase stepper, token and elapsed formats, heartbeat, filters
- [ ] 9.2 Add UI state with `$.store` preferences, UI actions, and the Card and AgentChip parts

## 10. Views

- [ ] 10.1 Add the pane render, header, empty state, Kanban view and the keyboard toolbar (comment input, block, priority, view cycle, filter cycle) on terminal and desktop
- [ ] 10.2 Add the Swimlane view by agent with heartbeats and the queue with wait reasons
- [ ] 10.3 Add the Tree view and the task detail pane (acceptance, phases with gates, run timeline, comment thread, `a` full artifact, Esc back)

## 11. Integration, security and docs

- [ ] 11.1 Complete `register.tsx` wiring and add the end-to-end pipeline and Review Focus integration tests
- [ ] 11.2 Write the README, then run `claude plugin validate`, the type check and the full `claude plugin test` suite
