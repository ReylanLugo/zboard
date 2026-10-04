## ADDED Requirements

### Requirement: On-demand read tools
The system SHALL expose read tools `board_status`, `board_task(taskId)`, `board_artifact(taskId, phase)`, and `board_agent(agentId)` to the main session, returning data from the projected Board and Engram; `board_agent` SHALL include the transcript path. Read tools MUST NOT mutate state.

#### Scenario: Status query
- **WHEN** the main session calls `board_status`
- **THEN** it receives per-task status, phase, loop, and active agents without any event being appended

#### Scenario: Unknown task
- **WHEN** `board_task` is called with an id not on the board
- **THEN** an error result names the unknown id

#### Scenario: Truncated artifact
- **WHEN** `board_artifact` returns an artifact that was truncated in storage
- **THEN** the result includes the truncation marker and the transcript path

### Requirement: Actionable-only notices
The system SHALL inject a short notice into the main session only when a task becomes `needs_decision`, when a gate failure escalates, or when the whole change completes, and MUST NOT notify for routine phase progress.

#### Scenario: Routine progress
- **WHEN** a task advances from plan to tdd
- **THEN** no notice is injected

#### Scenario: Decision needed
- **WHEN** a task becomes `needs_decision`
- **THEN** a notice with the task label and reason is injected

#### Scenario: Change completed
- **WHEN** the last task of the change is done
- **THEN** a completion notice is injected, reminding that the integrated `ptest --full` gate is still required

### Requirement: Main-session comments
The system SHALL let the main session comment on a task through `board_comment`, recording `author: main` and delivering it like a user comment.

#### Scenario: Main comments on a running task
- **WHEN** the main session calls `board_comment` on a task with a running implementer
- **THEN** the comment is recorded with author `main` and delivered to that implementer
