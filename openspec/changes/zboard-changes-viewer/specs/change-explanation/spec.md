## ADDED Requirements

### Requirement: Render existing artifacts
The system SHALL render a change's existing artifacts in the Summary, Specs and Tasks tabs as Markdown without spawning an agent, and the Specs tab SHALL flag requirements that no task names.

#### Scenario: Summary without agents
- **WHEN** the user opens a change that has `proposal.md` and `design.md`
- **THEN** the Summary tab renders them and no agent is spawned

#### Scenario: Uncovered requirement flagged
- **WHEN** requirement "Export CSV" is named by no task
- **THEN** the Specs tab marks it as uncovered

### Requirement: Structural diagrams
The system SHALL compute structural diagrams from `tasks.md` (groups as layers, tasks as nodes, dependency edges, and requirements against covering tasks) with a deterministic pure layout, rendered as SVG on desktop and as ASCII on terminal, without spawning an agent.

#### Scenario: Desktop SVG
- **WHEN** the Diagrams tab is shown on the desktop surface
- **THEN** the task graph is an Svg element with one node per task and one edge per dependency

#### Scenario: Terminal ASCII
- **WHEN** the Diagrams tab is shown on the terminal surface
- **THEN** the same graph is drawn as ASCII text in a code block

#### Scenario: Deterministic layout
- **WHEN** the same `tasks.md` is laid out twice
- **THEN** both layouts are identical

### Requirement: Explanation cached by fingerprint
On Explain the system SHALL spawn `zboard:explainer` and store its overview, sections and diagrams with the change fingerprint, SHALL reuse the stored explanation while the fingerprint is unchanged, and MUST NOT show an explanation whose fingerprint differs from the current one as current.

#### Scenario: Cache hit
- **WHEN** the user presses Explain twice without changing the change
- **THEN** the explainer is spawned once and the second Explain shows the cached result

#### Scenario: Cache invalidated
- **WHEN** an artifact changes after an explanation was cached
- **THEN** the explanation is marked outdated and the next Explain spawns the explainer again

### Requirement: Mermaid rendering fallback
The system SHALL render conceptual Mermaid diagrams through `mmdc` via the process port only when `mmdc` is installed (SVG on desktop, raster image on terminal), and otherwise SHALL show the Mermaid source in a code block with an install hint.

#### Scenario: mmdc missing
- **WHEN** `mmdc --version` fails
- **THEN** each diagram is shown as a Mermaid code block with the hint `npm i -g @mermaid-js/mermaid-cli` and no other tab is affected

#### Scenario: mmdc renders
- **WHEN** `mmdc` is installed on the desktop surface
- **THEN** each diagram is rendered as an Svg element

#### Scenario: mmdc fails on one diagram
- **WHEN** `mmdc` exits non-zero for one diagram
- **THEN** that diagram falls back to its code block and the others still render
