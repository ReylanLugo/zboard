## ADDED Requirements

### Requirement: Verify only after execution
The system SHALL offer Verify only when every task of the change's `tasks.md` is checked, and SHALL then spawn `zboard:judge` with the change's specs, the main specs and read-only access to the repository.

#### Scenario: Verify disabled with open tasks
- **WHEN** one task of the change is unchecked
- **THEN** Verify is disabled

#### Scenario: Verify starts the judge
- **WHEN** every task is checked and the user presses Verify
- **THEN** the judge is spawned once and the change moves to `verifying`

### Requirement: Evidence from scoped ptest
The system SHALL run every test file the judge cites with `ptest <file>` from the repository root through the existing ptest adapter, SHALL attach the end line of each run as evidence, and the judge MUST NOT run commands itself.

#### Scenario: Cited tests run
- **WHEN** the judge cites `tests/export.test.ts` for requirement "Export CSV"
- **THEN** zboard runs `ptest tests/export.test.ts` and attaches its end line to that finding

### Requirement: Verdicts never invent a pass
The system SHALL record one verdict per requirement or scenario among `true`, `false`, `no_evidence`, `ambiguous` and `contradiction` (with the main specs); a `true` verdict without `path:line` evidence or whose cited tests did not pass or could not run MUST be recorded as `no_evidence`; invalid judge output after one retry MUST record every requirement as `no_evidence`; requirements the judge omitted MUST be recorded as `no_evidence`; unknown verdicts MUST be recorded as `ambiguous`.

#### Scenario: True without evidence degraded
- **WHEN** the judge returns `true` for a requirement with an empty evidence list
- **THEN** the finding is recorded as `no_evidence`

#### Scenario: ptest unavailable
- **WHEN** the judge returns `true` with `path:line` evidence but `ptest` cannot run (exit 70 twice)
- **THEN** the finding is recorded as `no_evidence`

#### Scenario: Invalid judge output
- **WHEN** the judge answers invalid JSON twice
- **THEN** every requirement is recorded as `no_evidence` and no finding is `true`

#### Scenario: Omitted requirement
- **WHEN** the judge returns findings for 4 of 5 requirements
- **THEN** the fifth is recorded as `no_evidence`

### Requirement: Per-finding resolution
The system SHALL let the user resolve each non-true finding: `false` and `contradiction` by `fix_code` or `adjust_spec`; `no_evidence` by `add_test` or `accepted`; `ambiguous` by `adjust_spec`, `fix_code` or `accepted`. `fix_code` and `add_test` SHALL add a task to `tasks.md` through a diff proposal and link it to the finding; `adjust_spec` SHALL open a spec diff proposal; `accepted` SHALL be recorded in `verify.md`. A resolution outside the allowed set MUST be refused.

#### Scenario: Fix code adds a board task
- **WHEN** the user resolves a `false` finding with `fix_code` and accepts the task diff
- **THEN** a new task linked to the finding is in `tasks.md`, the change returns to `executing`, and the board can run it

#### Scenario: Add test adds a TDD task
- **WHEN** the user resolves a `no_evidence` finding with `add_test`
- **THEN** a task to write the missing test is proposed for `tasks.md` and linked to the finding

#### Scenario: Accept not allowed for false
- **WHEN** the user tries to accept a `false` finding
- **THEN** the resolution is refused

### Requirement: Targeted re-judge
After resolutions are applied and their linked tasks are done, the system SHALL re-run the judge only on the affected requirements and SHALL keep the verdicts of unaffected findings.

#### Scenario: Only affected items re-judged
- **WHEN** 2 of 10 findings were resolved with `fix_code` and their tasks are done
- **THEN** the judge is spawned for those 2 requirements only and the other 8 verdicts are unchanged

### Requirement: Verify pass rule and verify.md
The system SHALL mark the verify run passed only when every finding is `true` or `accepted` and every finding-linked task is checked, and SHALL write `verify.md` (verdicts, evidence, resolutions and accepted risks) only through an accepted diff proposal.

#### Scenario: Accepted no-evidence passes
- **WHEN** all findings are `true` except one `no_evidence` finding resolved as `accepted`
- **THEN** the verify run is passed and `verify.md` records the accepted finding

#### Scenario: Linked task open blocks pass
- **WHEN** every finding is resolved but one linked task is unchecked
- **THEN** the verify run is not passed

### Requirement: Retrospective via diff
After a passed verify run, when the schema lists a retrospective artifact, the system SHALL draft it and write it only through an accepted diff proposal, recording `RetrospectiveAccepted`.

#### Scenario: Retrospective accepted
- **WHEN** verify passed and the user accepts the retrospective proposal
- **THEN** `retrospective.md` is written, committed as a plan revision, and archive becomes available
