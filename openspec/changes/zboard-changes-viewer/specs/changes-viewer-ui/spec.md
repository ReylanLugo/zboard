## ADDED Requirements

### Requirement: Changes pane
The system SHALL open a pane with id `zboard-changes` when the user runs `/zboard changes`, SHALL open it on a given change for `/zboard changes <id>`, and SHALL render the same component tree on the terminal and desktop surfaces, differing only in diagram rendering.

#### Scenario: Open the viewer
- **WHEN** the user runs `/zboard changes` in an 80-column terminal
- **THEN** the `zboard-changes` pane opens with the change list

#### Scenario: Existing commands unchanged
- **WHEN** the user runs `/zboard run add-export`
- **THEN** the board behaves exactly as before this change

### Requirement: List and detail layout
The system SHALL show the change list grouped Active, Drafts and Archived with stage and progress on the left, and for the selected change an artifact stepper (`●` done, `◐` current, `○` blocked), a readiness bar and the tabs Summary, Diagrams, Specs, Tasks, Verify and History on the right.

#### Scenario: Stepper states
- **WHEN** `brainstorm` and `proposal` are done and `design` is being drafted while `tasks` is blocked
- **THEN** the stepper shows `●` for brainstorm and proposal, `◐` for design and `○` for tasks

#### Scenario: History tab
- **WHEN** a change has two accepted revisions
- **THEN** the History tab lists both with artifact, commit and time

### Requirement: Q&A view
The system SHALL show the current brainstorm question with its why, one button per option, a free-text input and a Finish action, and SHALL show earlier turns with their answers.

#### Scenario: Option button
- **WHEN** the user presses the second option button
- **THEN** that option is recorded as the answer

#### Scenario: Free text
- **WHEN** the user submits text in the free-text input
- **THEN** the text is recorded as the answer

### Requirement: Diff view
The system SHALL show a pending proposal as a unified diff per file with Accept, Reject and Ask another version actions, and SHALL show a stale proposal with Regenerate instead of Accept.

#### Scenario: Accept by key
- **WHEN** a proposal is pending and the user presses `a`
- **THEN** the proposal is accepted through the apply protocol

#### Scenario: Reject by key
- **WHEN** a proposal is pending and the user presses `z`
- **THEN** the proposal is rejected and no file is written

#### Scenario: Stale proposal
- **WHEN** a pending proposal is stale
- **THEN** Accept is not offered and Regenerate is shown

### Requirement: Keyboard
The system SHALL bind `n` new change, `c` comment, `d` draft next, `e` explain, `x` critique, `r` run, `a` accept, `z` reject, Tab switch tab and Esc back while the viewer holds the keyboard, and `o` on the board SHALL open the viewer on the board's change; disabled actions MUST NOT run when their key is pressed.

#### Scenario: Run key while not ready
- **WHEN** readiness fails and the user presses `r`
- **THEN** nothing runs and the failing checks are shown

#### Scenario: Back from the board
- **WHEN** the board shows change `add-export` and the user presses `o`
- **THEN** the viewer opens with `add-export` selected

### Requirement: Error display and isolation
The system SHALL show plan errors on the affected change and in the pane header, and a failure in one change's hook MUST NOT prevent the list, other changes or the board from rendering.

#### Scenario: One change broken
- **WHEN** reading change `a` throws
- **THEN** `a` shows an error, the other changes render, and the board pane still opens
