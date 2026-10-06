## Context

zboard v1 (merged on `main`) is a Claude Code mod that turns the tasks of an
existing OpenSpec change into a board and drives each task through research →
plan → tdd → code → review (→ refactor loop) with `zboard:*` subagents,
mechanical gates, scoped `ptest` runs, per-task commits and verified `tasks.md`
flips (see `openspec/changes/zboard-v1/design.md`, D1–D14). Its layout is fixed
by the engine's plugin checker (Claude Code 2.1.289), as recorded in the v1
executor ledger rulings:

- `$` is followed only into functions of the same file, never across an import.
  `hooks/register.tsx` is the composition root: it holds every atom, every hook
  and one `ioOf($)` that builds the `Io` port object (`hooks/runtime/io.ts`);
  every other module receives `Io` and is tested against the in-memory world
  (`hooks/testing/world.ts`).
- `$.state` is read only through atoms declared as consts of `register.tsx`;
  `types/index.d.ts` is the self-contained state contract (types only) and must
  declare every state key.
- Hooks are function literals inside `on(...)`; `.catch(handler)` accepts only
  function literals, so failures go through the `isolate(io, name, work,
  fallback)` wrapper.
- Each event takes one unmatched hook: the existing unmatched `session.start`,
  `tool.call`, `ui.focus` and `turn.complete` hooks must be extended, never
  duplicated.
- Hook matchers must be literals (`requestId: 'zboard-changes'`, not an
  imported constant).
- Text elements drop `key`; keyed text is wrapped as `<Box key=…><Text>…</Text></Box>`.
- Relative fs paths resolve against the engine's cwd, so `ioOf` resolves
  repo-relative paths against `$.session.root()`.
- The kit cannot store session rows, so notices toast first, then
  `session.append`.

Surfaces: both have Box/Text/Button/Link/Code/Markdown; desktop (remote
surfaces) also has Svg; terminal has Image (raster). The sandbox has no DOM and
no Node APIs, so the Mermaid JS library cannot run inside the mod, and hashing
needs a pure TypeScript implementation.

Current gap: everything before and after a board run is manual. Changes are
written by hand in the main session, understood by reading files, revised
without an approval trail, run without a readiness check, closed without
requirement-level evidence, and archived by hand.

Stakeholders: the user (author and approver of every write), the main Claude
session (unchanged consumer of board tools and notices), the read-only plan
agents (workers), and the v1 board (execution engine, reused unchanged).

## Goals / Non-Goals

**Goals:**

- One pane that lists every OpenSpec change and shows where each stands in its
  lifecycle (draft → authoring → ready → executing → verifying → retrospective →
  archiving → archived).
- Create changes and draft every artifact with read-only agents, in the order
  the OpenSpec CLI reports, with the user approving each write as a diff.
- Iterate on any artifact through comments and per-file diff proposals; every
  accepted write is validated and committed as a plan revision.
- Gate `▶ Run` on a free, mechanical readiness checklist; offer an optional
  critique.
- Explain a change with free structural diagrams and an on-demand, cached agent
  explanation.
- Verify a finished change requirement by requirement with evidence, resolve
  each finding explicitly, and archive only on a passed verification.
- Keep the plan domain pure, immutable and near-fully unit-tested, and respect
  every engine ruling from v1.

**Non-Goals:**

- Web UI or any surface outside Claude Code.
- Multi-user or team synchronization.
- Editing source code from the viewer (code changes only happen as board tasks).
- Running the board pipeline differently: `▶ Run` reuses v1 unchanged.
- Agents writing files: they only return JSON.

## Decisions

### D1. Approach A: a plan layer inside zboard

The viewer extends zboard instead of shipping a second mod (`$` never crosses
plugins, so a separate mod would duplicate `Io`, the event log, the Engram
mirror and the agent configuration) or leaving authoring to the main session
(approval, validation and "never invent a pass" would be unenforced). See
`brainstorm.md` for the comparison.

New modules (tests colocated as `*.test.ts`):

| Path | Responsibility |
|------|----------------|
| `hooks/plan/lifecycle.ts` | Pure lifecycle rules over `ChangeRecord`: `stageOf`, `groupOf`, `nextArtifact`, `actionsFor` (each action gated with a reason), `verifyPassed`, `affectedRequirements`. |
| `hooks/plan/plan-events.ts` | Closed union of plan events. |
| `hooks/plan/plan-project.ts` | Pure fold `projectPlan(events) → PlanBoard` (`Record<changeId, ChangeRecord>`). |
| `hooks/plan/readiness.ts` | Pure readiness checklist over parsed artifacts and CLI results. |
| `hooks/plan/structure.ts` | Pure structural model and layered layout from `tasks.md`; SVG and ASCII renderers. |
| `hooks/plan/proposals.ts` | Pure diff-proposal rules: build, stale check, apply plan, revert plan, write scope. |
| `hooks/plan/findings.ts` | Pure verdict normalization, resolution rules, citable test paths, `verify.md` text (affected-item selection and the verify pass rule live in `lifecycle.ts`, which the fold uses). |
| `hooks/plan/diff.ts`, `hash.ts`, `contracts.ts`, `forecast.ts`, `plan-log.ts` | Pure Myers unified diff, FNV-1a fingerprint, the five agent JSON contracts, the plan-step forecast, and the compacted plan log. |
| `hooks/adapters/openspec-cli.ts` | `list`, `status`, `instructions`, `validate`, `new change`, `archive` with `--json` via `io.process.run`; output parsing. |
| `hooks/adapters/artifacts.ts` | Artifact read/write/remove through `Io` (`fs.list` port added; removal of a new file on revert runs `rm -f --` from the root), change fingerprint, glob matching of CLI output paths. |
| `hooks/adapters/prompts-plan.ts` | Prompts for the five plan agents; user text delimited as data. |
| `hooks/runtime/plan-runner.ts` | Runs plan jobs through `Io` (`defineJob`/`startJob`/`planStop`); owns the one-agent-per-change slot and the single retry. Flows live beside it: `plan-catalog`, `plan-draft`, `plan-apply`, `plan-brainstorm`, `plan-forecast`, `plan-explain`, `plan-critique`, `plan-run`, `plan-verify`, `plan-archive`, `plan-mirror`, `plan-recovery`, `plan-open`, `plan-docs`. |
| `hooks/ui/ChangesPane.tsx`, `ChangeDetail.tsx`, `DiffView.tsx`, `QaView.tsx` | Rendering only. |

Reused unchanged or extended in place: `adapters/tasks-md.ts` (parser and
dependencies feed `structure.ts` and readiness), `adapters/git.ts` (task-scoped
`commit --only` for revisions), `adapters/ptest.ts` (judge evidence),
`adapters/engram.ts` (mirror), `adapters/agents.ts` + `domain/config.ts`
(registration, `agent.offer`, three-level model/effort config), `domain/json.ts`
(JSON extraction), `runtime/log-store.ts` (append, snapshot-plus-tail
compaction, `isolate`). The existing `adapters/openspec.ts` keeps `tasks.md`
loading and flipping; `openspec-cli.ts` is the new home of every CLI `--json`
call used by the plan layer.

Rules carried over from v1: `hooks/plan/` never imports `$`, adapters or UI;
all values are immutable; adapters expose small typed functions over `Io`.

### D2. Lifecycle state machine

```
draft ──► authoring ──► ready ──► executing ──► verifying ──► retrospective ──► archiving ──► archived
            ▲   │         │  ▲                     │  ▲
            │   └─────────┘  └── fingerprint change│  │ fix_code / add_test tasks
            └── artifact iteration (diff accepted) └──┴── back to executing, then re-judge
```

- `draft`: the change exists (`ChangeCreated`) and no artifact is done.
- `authoring`: at least one artifact is done and an `applyRequires` artifact (per
  `openspec status --json`) is not. The CLI decides order and completion; the
  plan layer never hardcodes artifact names, so other schemas work.
- `ready`: every `applyRequires` artifact is done and every readiness check is
  `ok`. Any fingerprint change recomputes readiness and can drop the change back
  to `authoring`.
- `executing`: `RunStarted` was recorded; the v1 board owns the work.
  `ExecutionFinished` is recorded when every task in `tasks.md` is checked.
- `verifying`: judge runs and finding resolutions. A resolution that adds a task
  (`fix_code`, `add_test`) returns the change to `executing`; when those tasks
  are done, the judge re-runs on affected items only.
- `retrospective`: entered when `VerifyRun.passed`; the retrospective artifact
  (when the schema has one) is drafted and accepted via diff.
- `archiving` → `archived`: the archive CLI call is in flight / succeeded.

Rules: only accepted diffs write; one active plan agent per change; verify and
archive are offered only when all tasks are done; archive only when
`verify.passed` and every finding-linked task is done.

### D3. Data model

```ts
type ChangeStage = 'draft' | 'authoring' | 'ready' | 'executing' | 'verifying' | 'retrospective' | 'archiving' | 'archived'

interface ChangeRecord {
  readonly id: string; readonly schema: string; readonly stage: ChangeStage
  readonly artifacts: readonly ArtifactState[]; readonly current?: string
  readonly qa?: QaSession; readonly proposal?: DiffProposal   // at most one pending
  readonly revisions: readonly Revision[]; readonly readiness: readonly ReadinessCheck[]
  readonly critique?: readonly Finding[]; readonly verify?: VerifyRun
  readonly explanation?: { readonly key: string; readonly fingerprint: string }
  readonly activeAgent?: { readonly agentId: string; readonly role: PlanRole; readonly startedAt: number }
  readonly retryable?: ActiveAgent                    // interrupted or twice-failed; offered for retry
}
interface ArtifactState { readonly id: string; readonly status: 'blocked' | 'ready' | 'done'; readonly path: string }
interface QaSession { readonly turns: readonly { question: string; options: readonly string[]; why: string; answer?: string }[]; readonly done: boolean }
interface DiffProposal {
  readonly id: string; readonly artifact: string; readonly reason: string
  readonly files: readonly { path: string; before: string | null; after: string }[]
  readonly status: 'pending' | 'accepted' | 'rejected' | 'stale'
}
interface Revision { readonly proposalId: string; readonly artifact: string; readonly commit: string; readonly at: number }
interface ReadinessCheck { readonly id: string; readonly ok: boolean; readonly detail: string }
interface Finding {
  readonly id: string; readonly requirement: string; readonly scenario?: string
  readonly verdict: 'true' | 'false' | 'no_evidence' | 'ambiguous' | 'contradiction'
  readonly evidence: readonly string[]          // `path:line` and ptest end lines
  readonly resolution?: 'fix_code' | 'adjust_spec' | 'add_test' | 'accepted'
  readonly linkedTask?: string                   // tasks.md label
}
interface VerifyRun { readonly runs: number; readonly findings: readonly Finding[]; readonly passed: boolean }
```

`before: null` means the file must not exist when the proposal is applied. The
`stale` status is computed by the fold from fingerprint events; a stale proposal
can only be regenerated or rejected.

### D4. Plan events and log

Own append-only log under state key `zboard.plan` (atom `planAtom` declared in
`register.tsx`, declared in `types/index.d.ts`, exposed as `io.state.plan`),
compacted with the same snapshot-plus-tail rule and equivalence property test as
the board log. Events (closed union): `ChangesListed`, `ChangeCreated`,
`QaAsked`, `QaAnswered`, `QaFinished`, `DraftRequested`, `ProposalReady`,
`ProposalAccepted`, `ProposalRejected`, `ExplanationCached`, `CritiqueRecorded`,
`RunStarted`, `ExecutionFinished`, `VerifyRecorded`, `FindingResolved`,
`RetrospectiveAccepted`, `ChangeArchived`, `PlanAgentStarted`,
`PlanAgentStopped`, `PlanError`, plus `ProposalStale` (recorded by the runtime,
which can read files, when a pending proposal's file no longer matches its
`before`), `ArchiveStarted` (the `archiving` stage), `PlanRestored` (Engram
mirror restore) and `PlanMirrorState` (`⚠ mirror pending`). `ChangesListed` carries each change's CLI
status and fingerprint, so a fingerprint difference is observed by the fold.

Fold rules:

- A new fingerprint invalidates the explanation cache entry, recomputes
  readiness, and marks a pending proposal `stale` if any of its files' current
  content differs from its `before`.
- `ProposalReady` is refused by the fold (recorded as `PlanError`) while another
  proposal is pending for the same change.
- `PlanAgentStarted` is refused while `activeAgent` is set.

Persistence split:

| Store | Owns |
|-------|------|
| Artifact files (git) | Change content; revisions are commits. |
| `$.state` `zboard.plan` | Session plan log and projection. |
| `$.store` `zplan/explain/<change>` | Cached explanation (one entry per change, overwritten). |
| Engram `zplan/<project>/<change>` | Mirror of Q&A turns, revisions, critique, findings, resolutions (debounced, `rev`/`updatedAt`, flushed on `PreCompact`, degraded to `⚠ mirror pending` when unavailable). |

Recovery on `session.start` and `PostCompact` rebuilds the projection from the
log and the Engram mirror; an `activeAgent` absent from `io.agent.list()` gets
`PlanAgentStopped { interrupted }` and a retry button. Plan agents are never
relaunched automatically (each run costs an opus call).

### D5. Engine wiring

All new hooks live in `register.tsx`:

- `session.start` (the single unmatched hook) additionally registers the five
  plan agent types and runs plan recovery inside `isolate`.
- `command.run { command: 'zboard' }` dispatch gains `changes` (open the pane)
  and `changes <id>` (open on a change); `/zboard run <change>` is untouched.
- `ui.render { component: 'Pane', requestId: 'zboard-changes' }` reads
  `planAtom` (subscription) and calls `renderChanges(els, surface, io, props)`.
- `ui.close { id: 'zboard-changes' }` clears transient UI state.
- The existing single unmatched `ui.focus` hook dispatches on `requestId` to
  either the board's `focusCard` or the viewer's `focusChange`.
- `installAgentOffer` hides the five new types from the model.
- The existing Edit/Write/NotebookEdit guard also fails closed for plan-agent
  ids: plan agents are read-only by contract and by enforcement.
- `classic.FileChanged` and the existing 5 s poll additionally refresh the
  fingerprint of the change open in the viewer.

### D6. OpenSpec CLI adapter

`openspec-cli.ts` runs argv arrays through `io.process.run` with
`cwd = session root`, no shell, and an explicit timeout. Calls:
`list --json`, `status --change <id> --json`, `instructions <artifact> --change
<id> --json`, `validate <id> --strict --json`, `new change <id> --schema
<schema>`, `archive <id> --yes --json`. Non-zero exit or unparsable JSON is a
typed failure carrying the trimmed CLI output; nothing is inferred from prose.
Change ids are validated before any call with the v1 change-name rule
(kebab-case, no `/`, `..`, leading `-` or absolute paths). Tests serve real
recorded `--json` outputs as `process.run` rules in the world.

### D7. Artifacts, fingerprint and diffs

- Fingerprint: a pure-TypeScript hash (FNV-1a 64-bit, hex) over the sorted list
  of `(repo-relative path, content)` for every file under
  `openspec/changes/<id>/` except `.openspec.yaml`. Used only for cache and
  staleness, never for security.
- Diff: pure line-based unified diff (Myers) with 3 lines of context, computed
  per file; new files diff against empty, deleted files are not supported.
- Write scope: a proposal path is accepted only if, after normalization, it lies
  under `openspec/changes/<id>/` of the proposal's own change. Absolute paths,
  `..` segments, other changes, `openspec/specs/` and anything outside
  `openspec/` are refused when the proposal is built and again when it is
  applied. `openspec archive` is the only writer of `openspec/specs/`.

### D8. Apply protocol for an accepted proposal

1. Re-read every file; if any current content differs from `before` (or a
   `before: null` file now exists), mark the proposal `stale` and write nothing.
2. Write every `after`.
3. Run `openspec validate <id> --strict`. On failure, restore every `before`
   (deleting files that were `null`), record `PlanError`, and request a
   correction proposal from the drafter with the validator output as data.
4. On success, commit only those paths with `git commit --only` and message
   `docs(<change>): <artifact> rev N` (N = revisions of that artifact + 1; no AI
   attribution), verify the commit, and record `ProposalAccepted` plus the
   `Revision`.
5. Refresh CLI status and the fingerprint (`ChangesListed`).

Reject records `ProposalRejected`. "Ask another version" rejects the pending
proposal and re-launches the same agent with the previous proposal and the
user's note as data.

### D9. Plan agents

Registered by the mod as `zboard:<role>`, hidden from the model, read-only, each
returning one JSON object validated by a gate; configurable through the existing
three-level model/effort configuration (new role keys).

| Agent | Default | Output contract |
|-------|---------|-----------------|
| `zboard:brainstormer` | opus 5.5 / high | `{question, options[], why}` or `{done: true, brainstorm}` |
| `zboard:drafter` | opus 5.5 / high (sonnet 5.5 / medium for `tasks`) | `{files: [{path, content}], notes}` |
| `zboard:explainer` | sonnet 5.5 / medium | `{overview, sections[], diagrams: [{title, mermaid}]}` |
| `zboard:critic` | opus 5.5 / high | `{findings: [{severity, artifact, issue, suggestion}]}` |
| `zboard:judge` | opus 5.5 / high | `{findings: [{requirement, scenario?, verdict, evidence[], tests[]}]}` |

Prompts (`prompts-plan.ts`) contain the CLI `instructions` JSON, accepted
dependency artifacts, and user text (comments, answers, notes) inside a
delimited, escaped data block labelled as untrusted data, never concatenated
into instructions. Invalid JSON or no answer is retried once with the gate
reason; a second failure records `PlanError` and shows a retry button.

### D10. Authoring flows

- **New change**: the user enters an id; zboard validates it, refuses an
  existing directory, runs `openspec new change <id> --schema
  superpowers-bridge`, and records `ChangeCreated`.
- **Draft next**: the next artifact is the first `ready` artifact in
  `openspec status --json` order. zboard fetches `instructions <artifact>
  --json`, spawns the drafter with the template, rules and accepted dependency
  content, and turns `files` into a diff proposal.
- **Brainstorm**: when the next artifact is `brainstorm`, the brainstormer runs
  in Q&A mode: each run returns one question (options + why); the user answers
  by option or free text; the agent is relaunched with all turns; on `done`, its
  `brainstorm` text becomes a diff proposal for `brainstorm.md`. After 15
  answered rounds zboard asks the agent to finish (`done` required); if it still
  asks, the Q&A ends and the user can draft from the accumulated turns.
- **Plan step**: before drafting `plan`, zboard shows a cost forecast — one
  drafter spawn per `##` task group of `tasks.md`, with the resolved model and
  effort, and an estimated token range from previous drafter runs of this
  project when recorded, otherwise "no estimate". Only after the user confirms
  does it draft one group at a time; each group is its own diff proposal.

### D11. Readiness and critique

Checks (`readiness.ts`, all mechanical and free):

| id | Passes when |
|----|-------------|
| `validate` | `openspec validate <id> --strict` exits 0. |
| `scenarios` | Every `### Requirement:` in the change's delta specs has ≥1 `#### Scenario:`. |
| `coverage` | Every `tasks.md` task names ≥1 requirement of the change, either by an exact (case-insensitive) requirement name in its text or continuation lines, or by a `[req: <name>]` tag. |
| `cycles` | The `tasks.md` dependency graph (explicit `depends on` / `BLOCKED on` and section barriers, as the v1 parser derives them) is acyclic. |
| `size` | No task text exceeds `TASK_TEXT_MAX` (600 characters) and no `##` group has more than `GROUP_TASK_MAX` (12) tasks. |
| `acceptance` | Every task has acceptance criteria: an `Acceptance:` continuation line in `tasks.md`, or an "Acceptance" heading in its `plan.md` task section. |

`▶ Run` is enabled only when every check is `ok`; each failing check shows its
`detail` (which requirement, task or cycle). "Critique" spawns the critic;
each returned finding can be turned into a comment that starts an iteration
proposal on its artifact. Critique never blocks Run.

### D12. Explanation and diagrams

- **Structural diagrams (free)**: `structure.ts` builds a layered graph from
  `tasks.md` (groups as layers, tasks as nodes, dependency edges) and lays it
  out with a pure longest-path layering and barycentric ordering. Desktop renders
  it as an `Svg` element; terminal renders an ASCII drawing in a `Code` block. A
  second structural view lists requirements against covering tasks.
- **Explain (agent)**: the explainer receives all artifacts and returns an
  overview, sections and Mermaid diagrams. The result is stored at
  `zplan/explain/<change>` with the fingerprint; it is reused while the
  fingerprint matches and regenerated only on an explicit Explain after a
  change.
- **Mermaid rendering**: the mod probes `mmdc --version` once per session. When
  present, each diagram is rendered through `io.process.run` to SVG (desktop,
  `Svg`, read from stdout) or PNG (terminal, `Image`, written under
  `/tmp/zboard-mermaid`, never inside the repository). When absent or failing, the Mermaid source
  is shown in a `Code` block with the hint
  `npm i -g @mermaid-js/mermaid-cli`.

### D13. Verification, findings and resolutions

1. When every task is checked (`ExecutionFinished`), Verify spawns the judge
   with the change's specs, the main specs in `openspec/specs/`, and the
   repository (read-only).
2. The judge cites test files per finding (`tests[]`). zboard runs each cited
   file with the v1 ptest adapter (`ptest <file>`, retry once on 70/75/124 or
   timeout) and attaches the end lines as evidence. The judge never runs
   commands itself.
3. Normalization (`findings.ts`): invalid JSON after one retry → every
   requirement `no_evidence`; `true` without `path:line` evidence or whose cited
   tests did not pass (or could not run) → `no_evidence`; an unknown verdict →
   `ambiguous`; requirements the judge omitted → `no_evidence`. zboard never
   produces `true` on its own.
4. Resolutions, chosen per finding by the user:

| Verdict | Allowed resolutions |
|---------|---------------------|
| `false`, `contradiction` | `fix_code` (task added to `tasks.md` via diff, runs on the board) or `adjust_spec` (spec diff). |
| `no_evidence` | `add_test` (TDD task added via diff) or `accepted`. |
| `ambiguous` | `adjust_spec`, `fix_code` or `accepted`. |

5. After resolutions (and after the linked tasks are done) the judge re-runs
   only on the affected requirements; unaffected findings keep their verdicts.
6. `VerifyRun.passed` is true only when every finding is `true` or `accepted`,
   and every linked task is checked. `verify.md` (verdicts, evidence,
   resolutions, accepted risks) is written via diff proposal.
7. The retrospective artifact, when the schema lists one, is drafted and accepted
   via diff (`RetrospectiveAccepted`).

### D14. Archive

Archive is enabled only when `verify.passed` and every finding-linked task is
done. zboard runs `openspec archive <id> --yes --json`; on success it records
`ChangeArchived` and refreshes the list; on failure it records `PlanError` with
the CLI output, the change returns from `archiving` to `retrospective`, and
nothing is reported as archived.

### D15. UI

Pane `zboard-changes`, opened by `/zboard changes` (user-opened, seats at any
width). Left: change list grouped Active / Drafts / Archived with stage and
task progress. Right: artifact stepper (`●` done, `◐` current, `○` blocked),
readiness bar, and tabs Summary · Diagrams · Specs (uncovered requirements
flagged) · Tasks · Verify · History. Q&A view: question, why, one Button per
option, free-text input, Finish. Diff view: unified diff per file with
Accept / Reject / Ask another version. Keys (Button hotkeys): `n` new, `c`
comment, `d` draft next, `e` explain, `x` critique, `r` run, `a` accept, `z`
reject, Tab switches tab, Esc goes back. On the board, `o` opens the viewer on
the board's change. Same component tree on both surfaces; only diagram
rendering differs (Svg vs ASCII/Image). Keyed texts are wrapped in Boxes.

### D16. Error isolation

Every plan hook runs inside `isolate`; failures become `PlanError { changeId?,
hook, message }`, shown on the change and in the header. One broken change
never blocks the list, other changes, or the board.

### D17. Testing

TDD with `claude plugin test`. Pure domain (lifecycle, fold, readiness, SVG and
ASCII layout, proposals apply/stale/revert, findings) near 100%. CLI adapter
against recorded `--json` fixtures served as `process.run` rules. Runtime:
Q&A cap, draft → diff → accept → validate → commit and revert-on-invalid,
critique → comment, judge `no_evidence` without ptest, every finding resolution
including the added board task, archive blocked until verify passes. UI on
terminal and desktop: list, stepper, accept/reject keys, Q&A option and free
text, Mermaid fallback without `mmdc`. Negative and security: diff paths outside
`openspec/changes/<id>/` (including `openspec/specs/`) refused, change-name
traversal refused, stale proposal never applied, judge `true` without evidence
degraded, comment prompt injection delivered delimited as data.

## Risks / Trade-offs

- [Composition root keeps growing] → plan hooks stay one-liners calling
  `plan-runner`/UI functions; the domain stays outside `register.tsx`.
- [Merging into single unmatched hooks breaks v1 behaviour] → v1 integration
  tests run unchanged; new behaviour dispatches on `requestId`/role and falls
  through to the v1 path otherwise.
- [Agent output tries to escape the change directory] → write scope checked at
  build and at apply; plan agents are read-only and guarded.
- [User edits a file while a proposal is pending] → stale detection on
  fingerprint and on apply; stale proposals are never applied.
- [Accepted diff leaves the change invalid] → validate after write, restore
  `before`, correction proposal; no commit of an invalid state.
- [Judge invents passes] → `true` requires `path:line` evidence and passing
  cited tests run by zboard; everything else degrades to `no_evidence`.
- [Agent cost (opus) grows with iterations] → explicit user actions only, plan
  forecast before the per-group plan step, explanation cache by fingerprint,
  one active agent per change, no automatic relaunch after interruption.
- [Prompt injection through comments, answers or artifact text] → delimited,
  escaped, labelled as data; agents cannot write.
- [`mmdc` absent or slow] → Code-block fallback; diagrams never block other
  tabs.
- [FNV-1a collisions] → fingerprint only keys caches and staleness; apply still
  compares exact `before` content.
- [Readiness heuristics (size, coverage tags) are opinionated] → named
  constants, each failing check explains itself; adjustable without changing
  the spec contract.

## Migration Plan

Additive. Existing changes without a plan log get a stage derived from
`openspec status --json` and `tasks.md` (all tasks checked → `verifying`, any
task present → `ready` or `authoring` per readiness, archived directory →
`archived`). The board, its commands and its state keys are unchanged. Rollback
is reverting the change's commits: artifact files and plan revision commits stay
valid in git; `zboard.plan` state, `zplan/*` store keys and Engram topics become
inert.

## Open Questions

- `mmdc` I/O through `io.process.run`: stdin input and stdout output versus a
  temporary file, and cold-start time against the default 30 s timeout (spike in
  the first diagram task; fallback is the Code block).
- `openspec validate --strict --json` and `archive --json` output shapes on the
  installed CLI version (recorded as fixtures in the adapter task).
- Readiness thresholds (`TASK_TEXT_MAX` 600, `GROUP_TASK_MAX` 12) and the
  `[req: …]` tag are provisional; tuned after the first real change.
- Whether `AgentSpec` can restrict a type's tools to read-only ones; the
  write guard enforces read-only behaviour either way.
