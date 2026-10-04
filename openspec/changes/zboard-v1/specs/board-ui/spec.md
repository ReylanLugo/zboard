## ADDED Requirements

### Requirement: Board pane lifecycle
The system SHALL open a pane with id `zboard` when the user runs `/zboard`, and SHALL auto-open it when an active change is detected only where the engine seats unasked panes (144 columns or wider). The same component tree MUST render on both `terminal` and `desktop` surfaces.

#### Scenario: User opens the board
- **WHEN** the user runs `/zboard` in an 80-column terminal
- **THEN** the zboard pane opens

#### Scenario: Narrow terminal auto-open
- **WHEN** an active change is detected in a 100-column terminal
- **THEN** the pane is not forced open

### Requirement: Header summary
The system SHALL render a header showing change name, progress bar with done/total, active agent count, pending decision count, total tokens, and current view, and SHALL append warnings for `⚠ mirror pending`, invalid configuration, and ModErrors when present.

#### Scenario: Header content
- **WHEN** change zboard-v1 has 7 of 12 tasks done, 3 active agents, 1 decision, and 182k tokens in Kanban view
- **THEN** the header reads `zboard · zboard-v1 ▓▓▓░░ 7/12 · 3 agents · ⚠ 1 decision · 182k tok [v] Kanban`

### Requirement: Three views over the same Board
The system SHALL provide Kanban by status (Ready, Running, Review, Decision, Done), Swimlanes by agent, and Tree+detail views, all rendered from the same projected Board, and `v` SHALL cycle between them.

#### Scenario: Toggle view
- **WHEN** the user presses `v` in Kanban
- **THEN** the Swimlane view renders the same tasks

#### Scenario: Kanban card content
- **WHEN** a task is in review on loop 1 with an implementer run on sonnet 5.5/medium
- **THEN** its card shows a phase stepper like `R✓ P✓ T✓ C✓ Rv● ↺1`, the agent chip with model and effort, current tool, elapsed time, and tokens

#### Scenario: Swimlane heartbeat
- **WHEN** an agent has had no activity for more than 5 minutes
- **THEN** its lane heartbeat is amber; an errored agent shows red

#### Scenario: Wait reason shown
- **WHEN** a task waits on another task's allowed files
- **THEN** its queue entry shows a reason such as `⏸ waits 1.2 for auth.ts`

### Requirement: Task detail page
The system SHALL show, for a selected task, acceptance criteria status, each phase with gate result and artifact summary, a run timeline (agent, model/effort, duration, tokens, outcome), and the comment thread with delivery status; `a` SHALL open the full artifact.

#### Scenario: Delivered comment
- **WHEN** a comment was delivered to the reviewer
- **THEN** the thread shows "delivered to zboard:reviewer" under it

### Requirement: Keyboard interaction
The system SHALL support arrows to navigate, enter for detail, `c` comment, `b` block/unblock, `p` priority, `v` view, `f` filter by agent/status/section, and `esc` back, with no mouse dependency.

#### Scenario: Comment submit
- **WHEN** the user presses `c` on a task, types text, and submits
- **THEN** a `CommentAdded` event is recorded for that task

#### Scenario: Filter by status
- **WHEN** the user filters by status `needs_decision`
- **THEN** only tasks in that status are shown

#### Scenario: Empty comment
- **WHEN** the user submits an empty comment
- **THEN** no event is recorded

### Requirement: Rendering is pure
UI components SHALL render only from the projected Board and preferences and MUST NOT call `$` side effects during render; user actions SHALL be dispatched as domain events or commands.

#### Scenario: Render with no change loaded
- **WHEN** no change is loaded
- **THEN** the pane renders an empty state with the hint to run `/zboard run <change>`
