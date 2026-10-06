## ADDED Requirements

### Requirement: Readiness checklist
The system SHALL compute, without spawning agents, the readiness checks `validate` (`openspec validate <id> --strict` passes), `scenarios` (every requirement has at least one scenario), `coverage` (every task names at least one requirement of the change by exact name or `[req: <name>]` tag), `cycles` (the task dependency graph is acyclic), `size` (no task text over 600 characters and no group over 12 tasks) and `acceptance` (every task has acceptance criteria in `tasks.md` or its `plan.md` section), each with a detail that names what failed.

#### Scenario: All checks pass
- **WHEN** a change validates, every requirement has a scenario, every task names a requirement, there are no cycles, sizes are within limits, and every task has acceptance criteria
- **THEN** every check is ok and the readiness bar is green

#### Scenario: Uncovered task
- **WHEN** task 2.3 names no requirement
- **THEN** `coverage` fails with a detail naming task 2.3

#### Scenario: Dependency cycle
- **WHEN** task 1.2 depends on 2.1 and task 2.1 depends on 1.2
- **THEN** `cycles` fails and its detail names both tasks

#### Scenario: Requirement without scenario
- **WHEN** a delta spec has a requirement with no `#### Scenario:`
- **THEN** `scenarios` fails and names that requirement

### Requirement: Run gated by readiness
The system SHALL enable `▶ Run` only when every readiness check is ok and every apply-required artifact is done, and `▶ Run` SHALL start the change on the existing board through the unchanged `/zboard run <change>` path and record `RunStarted`.

#### Scenario: Run disabled
- **WHEN** any readiness check fails
- **THEN** `▶ Run` is disabled and the failing checks are listed

#### Scenario: Run starts the board
- **WHEN** readiness is green and the user presses `▶ Run`
- **THEN** the board runs the change exactly as `/zboard run <change>` does and the change moves to `executing`

### Requirement: Readiness follows the fingerprint
The system SHALL recompute readiness whenever the change fingerprint changes, and a change in `ready` whose recomputed readiness fails SHALL return to `authoring`.

#### Scenario: Edit breaks readiness
- **WHEN** a ready change gets a new task with no requirement reference
- **THEN** `coverage` fails and the change returns to `authoring`

### Requirement: Optional critique
The system SHALL offer a Critique action that spawns `zboard:critic`, SHALL record its findings with severity, artifact, issue and suggestion, and SHALL let the user turn any finding into a comment that starts an iteration proposal on that artifact; critique MUST NOT block `▶ Run`.

#### Scenario: Finding becomes a comment
- **WHEN** the critic reports an issue on `design.md` and the user turns it into a comment
- **THEN** the drafter is spawned for `design.md` with the finding as data

#### Scenario: Critique not required
- **WHEN** readiness is green and no critique was run
- **THEN** `▶ Run` is enabled
