## ADDED Requirements

### Requirement: Board agent types with defaults
The system SHALL register six board agent types with these default model/effort pairs: researcher sonnet 5.5/medium, planner opus 5.5/xhigh, tdd sonnet 5.5/low, implementer sonnet 5.5/medium, reviewer opus 5.5/high, refactorer sonnet 5.5/medium. The system SHALL hide these types from the main model's agent offer so only the pipeline spawns them.

#### Scenario: No configuration present
- **WHEN** no global, project, or task configuration exists
- **THEN** the planner is spawned with opus 5.5 and effort xhigh

#### Scenario: Hidden from model
- **WHEN** the main model lists available agent types
- **THEN** the board agent types are not offered

### Requirement: Three-level precedence
The system SHALL resolve each agent's model and effort with precedence per-task override (`/zboard set <label> <agent> <model> <effort>`) over project `.zboard/config.json` over global userConfig pickers over defaults, the most specific level winning per field.

#### Scenario: Project overrides global
- **WHEN** global sets reviewer to sonnet 5.5/high and `.zboard/config.json` sets reviewer to opus 5.5/max
- **THEN** reviewers spawn with opus 5.5/max

#### Scenario: Task override
- **WHEN** `/zboard set 2.1 implementer opus 5.5 high` is issued
- **THEN** only task 2.1's implementer uses opus 5.5/high

#### Scenario: Global picker change
- **WHEN** the user changes a global picker in the config menu
- **THEN** the module reloads and subsequent spawns use the new value

### Requirement: Invalid configuration fallback
The system SHALL replace an invalid model or effort with the default and show a header warning, and SHALL ignore effort for models that do not support it. A malformed `.zboard/config.json` MUST NOT stop the board.

#### Scenario: Unknown effort
- **WHEN** the project config sets implementer effort to `ultra`
- **THEN** the default effort is used and the header shows a configuration warning

#### Scenario: Malformed project config
- **WHEN** `.zboard/config.json` is not valid JSON
- **THEN** all agents use the next precedence level and a warning is shown

### Requirement: Optional auto-escalation
The system SHALL support an auto-escalation option, off by default, that raises the refactorer's effort by one step on loop 3, never above `max`.

#### Scenario: Escalation disabled
- **WHEN** auto-escalation is off and a refactor runs on loop 3
- **THEN** the configured effort is used unchanged

#### Scenario: Escalation enabled
- **WHEN** auto-escalation is on and the refactorer effort is medium on loop 3
- **THEN** the refactorer spawns with effort high

### Requirement: Effective configuration display
`/zboard config` SHALL list each agent's effective model and effort with the source level that provided each value, and runs SHALL record the model and effort actually used.

#### Scenario: Show config sources
- **WHEN** the user runs `/zboard config` with a project override for the reviewer
- **THEN** the reviewer row shows its values with source "project"
