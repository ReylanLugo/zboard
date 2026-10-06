## ADDED Requirements

### Requirement: Archive preconditions
The system SHALL enable Archive only when the change's verify run is passed, every finding-linked task is checked, and the retrospective artifact (when the schema lists one) is done.

#### Scenario: Archive blocked before verify
- **WHEN** a change has all tasks checked but no passed verify run
- **THEN** Archive is disabled and names the missing verify run

#### Scenario: Archive blocked by linked task
- **WHEN** verify passed earlier but a newly linked task is unchecked
- **THEN** Archive is disabled

### Requirement: Archive through the CLI
The system SHALL archive by running `openspec archive <id> --yes --json` from the repository root and SHALL record `ChangeArchived` and move the change to the Archived group only when the CLI succeeds; the archive CLI is the only writer of `openspec/specs/`.

#### Scenario: Archive succeeds
- **WHEN** the preconditions hold and the user presses Archive
- **THEN** the CLI is run once, `ChangeArchived` is recorded, and the change is listed under Archived

### Requirement: Archive failure handling
If the archive CLI exits non-zero or returns unparsable output, the system MUST NOT record the change as archived, SHALL record `PlanError` with the CLI output, and SHALL return the change to `retrospective`.

#### Scenario: Archive fails
- **WHEN** `openspec archive` exits 1 with a delta conflict message
- **THEN** the change is not listed as archived and the CLI output is shown

#### Scenario: Invalid name never archived
- **WHEN** an archive request carries the id `../x`
- **THEN** no process is run and an invalid-name error is shown
