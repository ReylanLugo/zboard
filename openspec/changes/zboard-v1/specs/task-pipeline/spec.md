## ADDED Requirements

### Requirement: Mod-driven phase sequence
The system SHALL drive each task through the phases research, plan, tdd, code, and review in that order, and SHALL decide every transition with a pure `pipeline.next(task, event)` function returning one of spawn, advance, loop, escalate, or done. The main Claude session MUST NOT be required to advance phases.

#### Scenario: Happy path to done
- **WHEN** every phase of a task passes its gate and the reviewer returns `approve`
- **THEN** the task moves research → plan → tdd → code → review → done without any main-session action

#### Scenario: Reviewer requests changes
- **WHEN** the review phase records a valid verdict `changes` with at least one finding
- **THEN** the system spawns a refactor phase, increments `loop`, and then runs review again

#### Scenario: Review loop cap reached
- **WHEN** the review returns `changes` and the task's `loop` has reached the cap of 3
- **THEN** the task status becomes `needs_decision` and no further refactor is spawned

### Requirement: Phase gates validated by the mod
The system SHALL validate each phase output against its contract before advancing: research MUST contain at least one finding with `path:line` evidence in valid JSON; plan MUST provide a non-empty `allowedFiles` whose every normalized path lies inside the repository and a non-empty `testCases`; tdd MUST produce a scoped ptest run that fails only because of the newly added tests; code MUST produce a green scoped ptest run with only `allowedFiles` and the task's tests touched; review MUST produce a valid ReviewVerdict where `changes` has at least one finding; refactor MUST produce a green scoped ptest run. Anything unknown or ambiguous SHALL count as a gate failure.

#### Scenario: Research without evidence
- **WHEN** the researcher returns valid JSON whose findings carry no `path:line` evidence
- **THEN** the research gate fails

#### Scenario: Plan authorizes a path outside the repository
- **WHEN** the plan lists `../outside/secret.ts` or an absolute path outside the repository root in `allowedFiles`
- **THEN** the plan gate fails and the task does not reach tdd

#### Scenario: TDD tests pass immediately
- **WHEN** the tdd phase finishes and the scoped ptest run on the task's test files exits 0
- **THEN** the tdd gate fails because RED was not observed

#### Scenario: TDD breaks pre-existing tests
- **WHEN** the scoped ptest run fails and a failing test case existed before the tdd phase
- **THEN** the tdd gate fails

#### Scenario: Reviewer approves without valid JSON
- **WHEN** the reviewer's final output is free text saying "approve" with no valid ReviewVerdict JSON
- **THEN** the review gate fails and the task is not marked done

#### Scenario: Changes verdict without findings
- **WHEN** the reviewer returns `{"verdict":"changes","findings":[]}`
- **THEN** the review gate fails

### Requirement: Gate retry and escalation
The system SHALL relaunch a phase exactly once with the gate failure reason injected into the prompt when its gate fails, and SHALL set the task to `needs_decision` and emit a main-session notice when the relaunched phase fails its gate again. An agent that ends without an artifact or with invalid JSON SHALL be treated as a gate failure.

#### Scenario: First gate failure
- **WHEN** a code phase gate fails for the first time
- **THEN** a new code phase is spawned whose prompt includes the failure reason

#### Scenario: Second gate failure
- **WHEN** the relaunched phase fails its gate
- **THEN** the task becomes `needs_decision` and a notice is sent to the main session

#### Scenario: Agent ends without artifact
- **WHEN** a phase agent stops without producing its artifact
- **THEN** the phase is retried once and then escalated to `needs_decision`

### Requirement: Phase artifacts carried forward
The system SHALL store every phase artifact in Engram and SHALL inject the previous phases' artifacts into the next phase's prompt.

#### Scenario: Plan receives research
- **WHEN** the plan phase is spawned for a task whose research passed
- **THEN** the planner prompt contains the stored research artifact

### Requirement: Read-only phases
The system SHALL run research, plan, and review agents as read-only and MUST deny any file-mutating tool call made by those agents.

#### Scenario: Reviewer attempts an edit
- **WHEN** a review-phase agent calls Edit on any file
- **THEN** the call is denied with a message stating the phase is read-only

### Requirement: Allowed-file enforcement
The system SHALL intercept file-mutating tool calls from code and refactor agents and MUST deny any target path that, after normalization against the repository root, is not in the task's `allowedFiles` or test files. After 3 denies in one phase the task SHALL become `needs_decision` with reason "plan too narrow".

#### Scenario: Edit outside allowed files
- **WHEN** an implementer agent calls Write on `src/other.ts` that is not in `allowedFiles`
- **THEN** the call is denied with a message naming the allowed files

#### Scenario: Path traversal attempt
- **WHEN** an implementer calls Edit on `src/allowed/../../etc/passwd` while only `src/allowed/a.ts` is allowed
- **THEN** the normalized path is rejected and the call is denied

#### Scenario: Third deny in a phase
- **WHEN** the same phase receives its third allowed-file deny
- **THEN** the task becomes `needs_decision` with reason "plan too narrow"

### Requirement: Tests only through ptest
The system SHALL execute every gate test run as `ptest` scoped to the task's test files via `$.process.run` and MUST NOT invoke a raw test runner. Exit codes 70, 75, and 124 SHALL trigger one retry without code changes; a repeat SHALL set `needs_decision` with ptest's end line. These exit codes and any missing or unparseable result MUST never count as a pass.

#### Scenario: Incomplete ptest result
- **WHEN** a code gate ptest run exits 70 twice in a row
- **THEN** the task becomes `needs_decision` and the decision reason contains ptest's end line

#### Scenario: Timeout is not a pass
- **WHEN** the ptest process times out
- **THEN** the gate is not recorded as passed

### Requirement: Scheduler constraints
The system SHALL run at most 3 tasks concurrently by default, SHALL only start tasks whose `dependsOn` are all done, and MUST NOT run code or refactor phases concurrently for two tasks whose plans share any `allowedFiles` entry. A waiting task SHALL expose its wait reason.

#### Scenario: Concurrency limit
- **WHEN** 3 tasks are running and a fourth task is runnable
- **THEN** the fourth task stays queued until a running task leaves the running state

#### Scenario: Unmet dependency
- **WHEN** task 1.3 depends on 1.2 and 1.2 is not done
- **THEN** 1.3 is not started

#### Scenario: Overlapping allowed files
- **WHEN** task 1.2 is in code with `auth.ts` allowed and task 1.4's plan also allows `auth.ts`
- **THEN** 1.4 waits before code and its wait reason reads "waits 1.2 for auth.ts"

### Requirement: Explicit start and pause
The system SHALL start the pipeline only through `/zboard run <change>` or `/zboard run <change>/<label>`. `/zboard pause` SHALL let in-flight phases finish and MUST NOT launch new phases until resumed.

#### Scenario: Board opened without run
- **WHEN** the user opens the board for a change but never issues `/zboard run`
- **THEN** no agent is spawned

#### Scenario: Pause during execution
- **WHEN** the user issues `/zboard pause` while two phases are running
- **THEN** both phases run to completion and no next phase is spawned

### Requirement: Per-task commit and checkbox flip
On task completion the system SHALL stage only the task's touched files, commit with message `feat(<change>): <label> <title>` without any AI attribution, and then flip `- [ ] <label>` to `- [x] <label>` in `tasks.md`. The system MUST NOT use `git add -A`. A commit failure, including a mutating commit hook, SHALL leave the task unchecked and set `needs_decision`.

#### Scenario: Successful close
- **WHEN** task 2.1 "Parse tasks" passes review
- **THEN** a commit `feat(zboard-v1): 2.1 Parse tasks` containing only the task's files is created and line `- [ ] 2.1` becomes `- [x] 2.1`

#### Scenario: Unrelated changes in the working tree
- **WHEN** the working tree contains modified files not touched by the task
- **THEN** those files are not staged in the task commit

#### Scenario: Commit hook modifies files
- **WHEN** the commit fails or a hook rewrites staged content
- **THEN** the checkbox is not flipped and the task becomes `needs_decision`

### Requirement: Spawn denial
The system SHALL set a task to `blocked` with the denial reason when `$.agent.spawn` returns `{deny}`.

#### Scenario: Spawn denied
- **WHEN** spawning the implementer returns a deny
- **THEN** the task becomes `blocked` and the reason is shown on the card
