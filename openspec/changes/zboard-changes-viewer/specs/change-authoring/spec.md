## ADDED Requirements

### Requirement: Draft artifacts in CLI order
The system SHALL draft the next artifact as the first artifact with status `ready` in `openspec status --json` order, SHALL give the drafter the output of `openspec instructions <artifact> --change <id> --json` and the content of its accepted dependency artifacts, and SHALL turn the drafter's files into a diff proposal instead of writing them.

#### Scenario: Next artifact drafted
- **WHEN** `brainstorm` is done and the CLI reports `proposal` and `design` as ready
- **THEN** pressing draft next spawns the drafter for `proposal` with its instructions and `brainstorm.md`, and a pending diff proposal for `proposal.md` appears

#### Scenario: Blocked artifact not drafted
- **WHEN** the CLI reports every remaining artifact as blocked
- **THEN** draft next is disabled and names the missing dependency

### Requirement: Read-only plan agents
The system SHALL register the plan agents `zboard:brainstormer`, `zboard:drafter`, `zboard:explainer`, `zboard:critic` and `zboard:judge`, hidden from the model, configurable through the existing three-level model and effort configuration; plan agents MUST NOT write files, and any Edit, Write or NotebookEdit call from a plan agent MUST be denied.

#### Scenario: Agent write denied
- **WHEN** a running `zboard:drafter` calls Write on `proposal.md`
- **THEN** the call is denied and the file is unchanged

#### Scenario: Hidden from the model
- **WHEN** the main session lists available agent types
- **THEN** the five plan agent types are not offered

#### Scenario: Configured model
- **WHEN** `.zboard/config.json` sets the drafter to sonnet 5.5 with effort medium
- **THEN** the drafter is spawned with that model and effort

### Requirement: One active plan agent per change
The system MUST NOT start a plan agent for a change while another plan agent for the same change is active.

#### Scenario: Second agent refused
- **WHEN** an explainer is running for change `a` and the user presses draft next on `a`
- **THEN** no agent is spawned and the user is told an agent is already running

### Requirement: Agent output validation
The system SHALL validate every plan agent answer against that agent's JSON contract, SHALL retry once with the gate reason when the answer is invalid or missing, and after a second failure SHALL record `PlanError` and offer a retry button.

#### Scenario: Invalid JSON retried once
- **WHEN** the drafter answers prose without JSON twice
- **THEN** it is spawned exactly twice, `PlanError` is recorded, and nothing is proposed or written

### Requirement: Brainstorm Q&A
The system SHALL run the brainstorm artifact as an in-pane Q&A where each brainstormer run returns exactly one question with options and a why, SHALL accept the answer as an option or free text, SHALL relaunch the brainstormer with all accumulated turns until it returns done, and SHALL then propose `brainstorm.md` as a diff.

#### Scenario: Answer by option
- **WHEN** the brainstormer asks a question with options `A` and `B` and the user presses `B`
- **THEN** `QaAnswered` records `B` and the brainstormer is relaunched with that turn

#### Scenario: Answer by free text
- **WHEN** the user types a free-text answer
- **THEN** the text is recorded as the answer and delivered to the next run as delimited data

#### Scenario: Done becomes a proposal
- **WHEN** the brainstormer returns `{done: true, brainstorm}`
- **THEN** `QaFinished` is recorded and a diff proposal for `brainstorm.md` is pending

### Requirement: Brainstorm round cap
The system MUST cap the brainstorm Q&A at 15 answered rounds; after the 15th answer it SHALL ask the brainstormer to finish, and if it still returns a question the Q&A SHALL end and the user SHALL be able to draft from the accumulated turns.

#### Scenario: Cap reached
- **WHEN** the 15th answer is recorded and the brainstormer returns another question
- **THEN** no 16th question is shown, the Q&A is marked done, and draft from turns is offered

### Requirement: Plan step forecast and per-group drafting
Before drafting the `plan` artifact the system SHALL show a cost forecast listing one drafter run per `##` task group of `tasks.md` with the resolved model and effort and an estimated token range when earlier drafter runs are recorded, and SHALL draft only after the user confirms, one group at a time, each group as its own diff proposal.

#### Scenario: Forecast before plan
- **WHEN** the next artifact is `plan` and `tasks.md` has 4 groups
- **THEN** a forecast of 4 drafter runs is shown and no agent is spawned until the user confirms

#### Scenario: Forecast declined
- **WHEN** the user dismisses the forecast
- **THEN** no drafter is spawned and the plan artifact stays not done

#### Scenario: Group by group
- **WHEN** the user confirms and accepts the proposal for group 1
- **THEN** the drafter is spawned for group 2 only after that acceptance
