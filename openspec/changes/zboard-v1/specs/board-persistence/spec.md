## ADDED Requirements

### Requirement: Event log as session source
The system SHALL persist an append-only domain event log in `$.state` and SHALL derive the Board only through the pure `project(events)` fold. When compacted, the log SHALL be stored as a snapshot plus tail such that `project(snapshot, tail)` equals `project(fullLog)`.

#### Scenario: Hot reload
- **WHEN** the module hot-reloads mid-run
- **THEN** the Board rebuilt from `$.state` equals the Board before reload

#### Scenario: Compaction equivalence
- **WHEN** the log exceeds the snapshot threshold and is compacted
- **THEN** projecting snapshot plus tail yields the same Board as projecting the full log

### Requirement: Task identity
The system SHALL identify OpenSpec tasks by `changeId` plus label (for example `zboard-v1` + `2.1`) and MUST NOT use the OpenSpec JSON task index as identity.

#### Scenario: Task inserted before another
- **WHEN** a new task is inserted into tasks.md above task 2.1
- **THEN** task 2.1 keeps its execution state

### Requirement: tasks.md parsing
The system SHALL parse `## <n>. Section` headers, `- [ ]`/`- [x] <label> <text>` lines, indented continuation lines, and inline free text such as `BLOCKED on …` into tasks with their section and done-state.

#### Scenario: Multiline task
- **WHEN** a task line is followed by indented continuation lines
- **THEN** the continuation text belongs to that task's description

#### Scenario: Inline blocked text
- **WHEN** a task line contains `BLOCKED on 1.2`
- **THEN** the parsed task records the blocking text

### Requirement: Safe checkbox flip
The system SHALL modify tasks.md only by flipping `[ ]` to `[x]` on the exact line of the completed label, after re-reading the file and confirming that line is unchanged since it was read. If the line changed or is missing, the system MUST NOT write and SHALL set the task to `needs_decision`.

#### Scenario: Line edited externally
- **WHEN** the user edited the task's line after zboard read it
- **THEN** zboard does not write tasks.md and the task becomes `needs_decision`

#### Scenario: Other lines untouched
- **WHEN** a checkbox is flipped
- **THEN** every other byte of tasks.md is unchanged

### Requirement: External change reconciliation
The system SHALL detect external tasks.md edits through the `FileChanged` event or a 5 s `$.clock` poll and SHALL emit `ChangeLoaded` to reconcile the Board.

#### Scenario: User adds a task
- **WHEN** the user adds `- [ ] 3.4 New task` to tasks.md
- **THEN** within one poll interval task 3.4 appears on the board

### Requirement: Engram execution mirror
The system SHALL mirror execution state to Engram under topic keys `zboard/<project>/<change>/<task>`, phase artifacts under `zboard/<project>/<change>/<task>/<phase>[-N]`, and an index under `zboard/<project>/<change>/index`, via `$.tool.call` on `mcp__engram__mem_save`. Writes SHALL be debounced (10 s) and always flushed on PreCompact. Payloads MUST carry `rev` and `updatedAt`.

#### Scenario: Debounced flush
- **WHEN** several events for one task occur within 10 s
- **THEN** a single upsert for that task is issued after the debounce window

#### Scenario: PreCompact flush
- **WHEN** PreCompact fires with pending writes
- **THEN** all pending writes are flushed immediately

#### Scenario: Identical content within dedupe window
- **WHEN** a task's state is saved twice with the same visible content within 15 minutes
- **THEN** the payloads differ by `rev`/`updatedAt` so the second save is not deduplicated

### Requirement: Artifact truncation
The system SHALL truncate artifacts exceeding 50,000 characters, appending an explicit truncation marker and the agent's transcript path.

#### Scenario: Oversized artifact
- **WHEN** a research artifact has 80,000 characters
- **THEN** the stored observation is within the cap and ends with the truncation marker and transcript path

### Requirement: Engram degradation
When Engram is unavailable the system SHALL keep running on `$.state`, show `⚠ mirror pending` in the header, retry on the next flush, and MUST NOT block the pipeline.

#### Scenario: Engram down
- **WHEN** `mem_save` fails or is denied
- **THEN** the pipeline continues, the header shows `⚠ mirror pending`, and the write is retried at the next flush

### Requirement: Recovery after restart and compaction
On `session.start` and `PostCompact` the system SHALL rebuild the Board from tasks.md, the Engram index and task records, and the `$.state` log, and SHALL mark every running phase whose agent is absent from `$.agent.list()` as `interrupted` and relaunch it with its partial artifact.

#### Scenario: Agent lost during compaction
- **WHEN** PostCompact fires and a running phase's agent is no longer listed
- **THEN** the run's outcome becomes `interrupted` and the phase is relaunched with the partial artifact

#### Scenario: Done-state wins from tasks.md
- **WHEN** tasks.md shows `[x]` for a task Engram records as running
- **THEN** the task is projected as done

### Requirement: UI preferences
The system SHALL store UI preferences (current view, filter) in `$.store` and MUST NOT store execution state there.

#### Scenario: View persists across sessions
- **WHEN** the user switches to Swimlanes and starts a new session
- **THEN** the board opens in Swimlanes
