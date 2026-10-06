## 1. Plan domain

- [x] 1.1 Plan types and the kebab-case change-name rule in `hooks/plan/types.ts` [req: Change-name validation]
- [x] 1.2 Lifecycle: stage derivation, list grouping, next artifact, re-judge scope and action gates in `hooks/plan/lifecycle.ts` [req: Stage derivation; Archive preconditions; Verify only after execution; Run gated by readiness; Verify pass rule and verify.md; Targeted re-judge]
- [x] 1.3 Plan events, the pure fold and the compacted plan log in `hooks/plan/{plan-events,plan-project,plan-log}.ts` [req: Plan state persistence and recovery; Diff proposals; One active plan agent per change]

## 2. Ports, CLI and artifacts

- [x] 2.1 Grow `Io` with `fs.list` and `state.plan`, the `zboard.plan` contract key, viewer UI state, and the plan store with `isolatePlan` [req: Plan state persistence and recovery; Error display and isolation]
- [x] 2.2 OpenSpec CLI adapter over recorded `--json` fixtures plus the scripted OpenSpec test world [req: List changes by group; Create a change; Archive through the CLI; Change-name validation]
- [x] 2.3 FNV-1a fingerprint and the artifact file adapter (list, read, write, remove, glob, archived dirs) [req: Fingerprint tracking]
- [x] 2.4 Myers unified diff and the pure proposal rules (write scope, build, stale, revert steps) [req: Diff proposals; Write scope; Stale proposals are never applied]

## 3. Readiness and structure

- [x] 3.1 Requirement parsing and the six readiness checks in `hooks/plan/readiness.ts` [req: Readiness checklist; Render existing artifacts]
- [x] 3.2 Deterministic task-graph layout with SVG and ASCII renderers in `hooks/plan/structure.ts` [req: Structural diagrams]

## 4. Plan agents

- [x] 4.1 Plan prompts with delimited untrusted data and the five JSON output contracts [req: User text is data; Agent output validation]
- [x] 4.2 Plan roles in the three-level model/effort config, registration, hiding and the plan-agent write guard [req: Read-only plan agents]

## 5. Runner and authoring

- [x] 5.1 Plan runner core: one agent per change, spawn with resolved model, stop capture, one retry, token history [req: One active plan agent per change; Agent output validation; Read-only plan agents]
- [ ] 5.2 Catalog: list refresh, change description with readiness, fingerprint polling, stale marking, change creation [req: List changes by group; Create a change; Fingerprint tracking; Readiness follows the fingerprint; Stage derivation]
- [ ] 5.3 Draft next in CLI order and comment iteration as diff proposals [req: Draft artifacts in CLI order; Diff proposals; Nothing written without approval]
- [ ] 5.4 Apply protocol: accept with stale check, validate, revision commit, revert on invalid, reject, ask another version [req: Validate and commit accepted proposals; Revert on invalid change; Nothing written without approval; Stale proposals are never applied; Write scope]
- [ ] 5.5 Brainstorm Q&A with the 15-round cap and draft from turns [req: Brainstorm Q&A; Brainstorm round cap]
- [ ] 5.6 Plan step forecast and per-group plan drafting [req: Plan step forecast and per-group drafting]

## 6. Explanation, critique and run

- [ ] 6.1 Explanation cached by fingerprint and Mermaid rendering through `mmdc` with fallback [req: Explanation cached by fingerprint; Mermaid rendering fallback]
- [ ] 6.2 Critique findings to comments and the readiness-gated run handoff to the board [req: Optional critique; Run gated by readiness]

## 7. Verification and archive

- [ ] 7.1 Pure findings rules: verdict normalization, allowed resolutions and `verify.md` text [req: Verdicts never invent a pass; Per-finding resolution; Verify pass rule and verify.md]
- [ ] 7.2 Verify runner: judge spawn, scoped ptest evidence, resolutions with linked tasks, targeted re-judge, `verify.md` proposal [req: Verify only after execution; Evidence from scoped ptest; Per-finding resolution; Targeted re-judge; Verify pass rule and verify.md]
- [ ] 7.3 Retrospective draft and archive through the CLI with failure handling [req: Retrospective via diff; Archive preconditions; Archive through the CLI; Archive failure handling]
- [ ] 7.4 Plan recovery after reload or compaction and the Engram mirror with `⚠ mirror pending` [req: Plan state persistence and recovery]

## 8. Changes viewer UI

- [ ] 8.1 `/zboard changes [id]`, the `zboard-changes` pane, grouped list, header errors and isolation [req: Changes pane; List and detail layout; Error display and isolation; List changes by group]
- [ ] 8.2 Change detail: stepper, readiness bar, Summary, Specs, Tasks and History tabs [req: List and detail layout; Render existing artifacts]
- [ ] 8.3 Diagrams tab: SVG on desktop, ASCII on terminal, explanation diagrams with Mermaid fallback [req: Structural diagrams; Mermaid rendering fallback; Explanation cached by fingerprint]
- [ ] 8.4 Diff view and Q&A view [req: Diff view; Q&A view]
- [ ] 8.5 Verify tab, forecast, critique, retry and archive controls [req: Per-finding resolution; Plan step forecast and per-group drafting; Optional critique; Archive preconditions]
- [ ] 8.6 Keyboard map, Tab focus switching, disabled keys and `o` on the board [req: Keyboard]

## 9. Integration

- [ ] 9.1 End-to-end lifecycle and security integration tests through the plugin, README update [req: Changes pane; Write scope; User text is data; Verdicts never invent a pass; Archive failure handling]
