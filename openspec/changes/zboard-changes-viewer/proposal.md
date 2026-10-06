## Why

zboard v1 executes an OpenSpec change that already exists and stops when its last task is done. Everything around that run still happens by hand in the main session: writing the change, understanding it, revising it, deciding whether it is ready, checking that the code actually satisfies the specs, and archiving. Those steps have no approval trail, no readiness gate and no evidence that the requirements were met. A changes viewer inside zboard closes the lifecycle: changes are drafted by read-only agents, revised only through approved diffs, gated before they run, verified requirement by requirement, and archived only on evidence.

## What Changes

- New changes viewer pane (`/zboard changes`, id `zboard-changes`) listing active, draft and archived OpenSpec changes with stage and progress, an artifact stepper, tabs (Summary, Diagrams, Specs, Tasks, Verify, History), Q&A, diff and readiness views.
- New change creation with schema `superpowers-bridge`; every artifact is drafted by a read-only agent in the order `openspec status --json` reports, and enters as a diff proposal; brainstorming is an in-pane Q&A (one question per round, cap 15).
- New iteration loop: comment → per-file diff proposal → Accept / Reject / Ask another version; zboard writes only accepted diffs, validates with `openspec validate`, and commits `docs(<change>): <artifact> rev N`.
- New readiness checklist gating `▶ Run` plus an optional opus critique whose findings can become comments.
- New explanation: structural diagrams computed from `tasks.md` (SVG on desktop, ASCII on terminal) and an agent explanation with Mermaid diagrams on demand, cached by the change fingerprint.
- New verification: `zboard:judge` checks every requirement and scenario against code and scoped `ptest` evidence; per-finding resolutions (fix code, adjust spec, add test, accept); `verify.md` via diff; targeted re-judge.
- New archive step (`openspec archive <change> --yes --json`) enabled only after a passed verify run.
- **Board pane**
  - From: the board is the only zboard pane and execution starts from a hand-written change.
  - To: the board is reachable from the viewer through `▶ Run` (unchanged `/zboard run <change>` path), and `o` on the board returns to the viewer.
  - Reason: one place to move between planning and execution.
  - Impact: non-breaking; existing board keys and commands keep their meaning.

## Capabilities

### New Capabilities
- `change-catalog`: Listing and grouping OpenSpec changes, stage derivation from CLI status and the plan log, change creation, change-name validation, plan state persistence and Engram mirror.
- `change-authoring`: Artifact drafting in CLI-reported order, the brainstorm Q&A loop, the per-group plan step with a cost forecast, and the read-only plan agents.
- `plan-iteration`: Diff proposals, accept/reject/regenerate, stale detection, write-validate-commit with revert on invalid, revision history and write-scope restrictions.
- `plan-readiness`: The automatic readiness checklist that gates `▶ Run` and the optional critique whose findings become comments.
- `change-explanation`: Structural diagrams from `tasks.md`, agent explanations with conceptual diagrams, fingerprint-keyed cache, and the Mermaid rendering fallback.
- `change-verification`: The judge run, verdict and evidence rules, per-finding resolutions, targeted re-judge, `verify.md` and the retrospective.
- `change-archive`: Archive preconditions, the archive CLI call and its failure handling.
- `changes-viewer-ui`: The `zboard-changes` pane, list, stepper, tabs, Q&A, diff and readiness views, keys, and parity across terminal and desktop.

### Modified Capabilities
<!-- None: openspec/specs/ is empty (zboard-v1 is not archived yet); this change adds new capabilities only. -->

## Impact

- New code under `hooks/plan/`, `hooks/adapters/{openspec-cli,artifacts,prompts-plan}.ts`, `hooks/runtime/plan-runner.ts`, `hooks/ui/{ChangesPane,ChangeDetail,DiffView,QaView}.tsx`, with colocated `*.test.ts`.
- Edited wiring: `hooks/register.tsx` (new `plan` atom, new literal `ui.render` matcher for `zboard-changes`, plan hooks merged into the existing single unmatched hooks), `types/index.d.ts` (`zboard.plan` in the self-contained state contract), `hooks/runtime/io.ts` (`state.plan` port), `hooks/adapters/agents.ts` (five new hidden agent types), `hooks/commands/zboard.ts` (`changes` subcommand), board pane (`o` key).
- External tools: OpenSpec CLI (`list`, `status`, `instructions`, `validate`, `new change`, `archive` with `--json`), `git` (revision commits), `ptest` (judge evidence), optional `mmdc` (mermaid-cli).
- Writes into user repositories: only accepted diffs under `openspec/changes/<id>/`, plan revision commits, and `openspec archive` (the only writer of `openspec/specs/`).
- Engram topic `zplan/<project>/<change>`.
- No web UI, cloud services or model APIs beyond engine agent spawning.
