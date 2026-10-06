## ADDED Requirements

### Requirement: List changes by group
The system SHALL list every OpenSpec change reported by `openspec list --json` and every directory under `openspec/changes/archive/`, grouped as Active, Drafts and Archived, and SHALL show for each change its stage and, when it has a `tasks.md`, its checked/total task progress.

#### Scenario: Grouped list
- **WHEN** the repository has change `a` with all apply-required artifacts done, change `b` with only `brainstorm.md`, and an archived change `c`
- **THEN** `a` is listed under Active, `b` under Drafts and `c` under Archived, each with its stage

#### Scenario: CLI unavailable
- **WHEN** `openspec list --json` exits non-zero
- **THEN** the list shows the CLI output as an error and no change is invented

### Requirement: Stage derivation
The system SHALL derive each change's stage from its plan log when one exists, and otherwise from `openspec status --json` and `tasks.md`; it MUST take artifact order and completion from the CLI and MUST NOT hardcode artifact names.

#### Scenario: Change without plan log
- **WHEN** a change created by hand has every apply-required artifact done, passes readiness, and has unchecked tasks
- **THEN** its stage is `ready`

#### Scenario: Other schema
- **WHEN** a change uses a schema whose artifacts are `proposal`, `specs` and `tasks`
- **THEN** the stepper and stage use exactly those artifacts in the CLI-reported order

### Requirement: Create a change
The system SHALL create a new change by validating the id and running `openspec new change <id> --schema superpowers-bridge`, and SHALL record `ChangeCreated` only when the CLI succeeds.

#### Scenario: New change created
- **WHEN** the user creates change `add-export`
- **THEN** the CLI is called with `new change add-export --schema superpowers-bridge` and the change appears under Drafts at stage `draft`

#### Scenario: Existing change refused
- **WHEN** the user creates a change whose directory already exists
- **THEN** no CLI call is made and the user is told the change exists

### Requirement: Change-name validation
The system MUST refuse any change id that is not kebab-case, contains `/`, `\` or `..`, starts with `-`, or is an absolute path, before any CLI call or file access.

#### Scenario: Traversal refused
- **WHEN** an id `../../etc` is requested
- **THEN** no process is run, no file is read or written, and an invalid-name error is shown

#### Scenario: Option injection refused
- **WHEN** an id `--yes` is requested
- **THEN** it is refused as an invalid change name

### Requirement: Plan state persistence and recovery
The system SHALL record plan activity as an append-only event log under state key `zboard.plan`, SHALL mirror Q&A turns, revisions, critique, findings and resolutions to Engram topic `zplan/<project>/<change>`, and SHALL rebuild the projection on session start and after compaction.

#### Scenario: Recovery after reload
- **WHEN** the mod reloads during a Q&A session with 4 answered turns
- **THEN** the change shows the same 4 turns and the next question is not lost

#### Scenario: Interrupted agent not relaunched
- **WHEN** recovery finds an active plan agent that is absent from the engine's agent list
- **THEN** the agent is recorded as interrupted, a retry button is shown, and no agent is spawned automatically

#### Scenario: Engram unavailable
- **WHEN** Engram writes fail
- **THEN** the viewer keeps working from the local log and shows `⚠ mirror pending`

### Requirement: Fingerprint tracking
The system SHALL compute a fingerprint for each change from the sorted paths and contents of its files, SHALL refresh it on file-change events and on the periodic poll, and a new fingerprint MUST invalidate the cached explanation, recompute readiness and mark a pending proposal stale when one of its files changed.

#### Scenario: External edit detected
- **WHEN** the user edits `design.md` of the open change in an editor
- **THEN** the change's fingerprint changes and its readiness is recomputed
