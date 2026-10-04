## ADDED Requirements

### Requirement: ODD feature import
`/zboard import-odd <feature>` SHALL read `odd/tasks/<feature>.md` and its Engram mirror `odd/<feature>/tasks`, using whichever is newest, and SHALL generate `openspec/changes/<feature>/` with `proposal.md` from Objective/Problem/Why/Scope, `tasks.md` mapping each `T<n>` to `1.<n>` while preserving `[x]`, and `design.md` from Constraints/Acceptance. Route and Commit per task SHALL be stored in Engram as history.

#### Scenario: Completed task preserved
- **WHEN** the ODD file contains `- [x] T2 — Add parser. Route: inline. Commit: \`abc123\`.`
- **THEN** the generated tasks.md contains `- [x] 1.2 Add parser` and Engram stores route and commit for 1.2

#### Scenario: Mirror newer than file
- **WHEN** the Engram mirror is newer than the local ODD file
- **THEN** the import uses the Engram mirror content

### Requirement: Preview and confirmation
The system SHALL show a preview of the files to be generated and MUST NOT write any file until the user confirms.

#### Scenario: User declines
- **WHEN** the user declines the preview
- **THEN** no file is written

### Requirement: Source and target safety
The import MUST NOT modify the ODD source file and MUST NOT overwrite an existing `openspec/changes/<feature>/` directory. The feature name MUST be validated as a filename-safe identifier.

#### Scenario: Existing change directory
- **WHEN** `openspec/changes/<feature>/` already exists
- **THEN** the import refuses and writes nothing

#### Scenario: Traversal in feature name
- **WHEN** the feature argument is `../../etc`
- **THEN** the import is rejected before any read or write

#### Scenario: Source unchanged
- **WHEN** an import completes
- **THEN** the ODD source file is byte-identical to before

### Requirement: Malformed ODD input
The system SHALL report unparseable sections or task lines in the preview and MUST NOT silently drop tasks.

#### Scenario: Unrecognized task line
- **WHEN** a line under Tasks does not match the `T<n>` format
- **THEN** the preview lists it as unparsed and asks the user before writing
