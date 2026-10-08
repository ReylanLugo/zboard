# zboard

A Claude Code mod that shows every task of an OpenSpec change on a board and drives each task through
research → plan → tdd → code → review (→ refactor loop) with subagents, gates it checks mechanically,
scoped test runs (`ptest` by default, or your own test command), one commit per task, and the `tasks.md`
checkbox flipped only after a verified commit.

## Install

Requirements: Claude Code 2.1.289 or later, `git`, the OpenSpec CLI (`openspec` 1.13+), and a test runner for
your repository (`ptest` by default, or any command set as `testCommand`; see [Configuration](#configuration)).
Optional: the Engram MCP server (plan and board state survive compaction) and `mmdc` for conceptual diagrams
(`npm i -g @mermaid-js/mermaid-cli`).

From the marketplace (inside Claude Code):

```
/plugin marketplace add ReylanLugo/zboard
/plugin install zboard@zboard
```

or from the command line:

```bash
claude plugin marketplace add ReylanLugo/zboard
claude plugin install zboard@zboard
```

Update later with `claude plugin marketplace update zboard`.

From a local clone (development, or to pin a checkout):

```bash
git clone https://github.com/ReylanLugo/zboard.git ~/tools/zboard
claude --plugin-dir ~/tools/zboard              # one session
export CLAUDE_CODE_PLUGIN_DIRS=~/tools/zboard   # every session, desktop app included
```

zboard commits once per task on the current branch, so start it on a feature branch.

## Use

| Command | Effect |
|---------|--------|
| `/zboard` | Open the board pane |
| `/zboard run <change>` | Load `openspec/changes/<change>/tasks.md` and start the pipeline (3 tasks at a time) |
| `/zboard run <change>/<label>` | Run one task only |
| `/zboard pause` | Let running phases finish; start nothing new until the next `/zboard run` |
| `/zboard set <label> <agent> <model> <effort>` | Per-task model/effort for one agent role, e.g. `/zboard set 2.1 implementer opus 5.5 high` |
| `/zboard config` | Effective model and effort per agent, with the level each value came from, and the effective test command |
| `/zboard import-odd <feature>` | Preview a gentle-ai ODD feature as an OpenSpec change; `--confirm <digest>` writes it |

Board keys (while the pane holds the keyboard): Tab/arrows move between cards, Enter opens the detail,
`c` comment, `b` block/unblock, `p` priority, `v` Kanban → Swimlanes → Tree, `f` filter, `a` full artifact
in the detail, Esc closes the detail.

The main session can read the board with `board_status`, `board_task`, `board_artifact` and `board_agent`,
and comment with `board_comment`. It is told only when a task needs a decision or the change is complete.

## Changes viewer

`/zboard changes` opens the `zboard-changes` pane (`/zboard changes <change>` opens it on one change; `o` on the
board opens it on the board's change). The list groups OpenSpec changes as Active, Drafts and Archived with their
stage and task progress; the detail shows the artifact stepper (`●` done, `◐` current, `○` other), the readiness
bar and the tabs Summary · Diagrams · Specs · Tasks · Verify · History.

| Key | Action |
|-----|--------|
| `n` | New change (`openspec new change <id> --schema superpowers-bridge`) |
| `d` | Draft the next artifact in `openspec status` order (brainstorm runs as a Q&A; the plan step shows a forecast first) |
| `c` | Comment on the selected artifact → the drafter proposes a diff |
| `a` / `z` | Accept / reject the pending diff |
| `e` / `x` | Explain (cached by the change fingerprint) / critique |
| `r` | ▶ Run on the board — only when every readiness check passes |
| Tab, Esc | Move between tabs and buttons / close the viewer |

Rules the viewer enforces:

- Plan agents (`zboard:brainstormer`, `drafter`, `explainer`, `critic`, `judge`) never write and are hidden from the
  model. zboard writes only diffs you accept, only under `openspec/changes/<change>/`, validates them with
  `openspec validate --strict`, and commits each as `docs(<change>): <artifact> rev N`; an invalid result is restored
  and a correction is requested. `openspec archive` is the only writer of `openspec/specs/`.
- Readiness: `validate`, every requirement has a scenario, every task names a requirement (by name or `[req: <name>]`),
  no dependency cycle, task text ≤ 600 characters and ≤ 12 tasks per group, and acceptance criteria
  (`Acceptance:` in `tasks.md` or an **Acceptance** line in the task's `plan.md` section).
- Verify runs only when every task is checked. The judge's cited tests run through the test command (`ptest <file>` by
  default); a `true` verdict without `path:line` evidence, or with a test that did not pass or whose output reports no
  executed test, is `no_evidence`. Archive needs a passed verify run, every
  finding-linked task done and the retrospective accepted.
- Conceptual diagrams render through `mmdc` when installed (`npm i -g @mermaid-js/mermaid-cli`); PNGs for the terminal
  go to `/tmp/zboard-mermaid`, never into the repository.
- Plan history is mirrored to Engram under `zplan/<project>/<change>`; `⚠ mirror pending` means Engram is unavailable
  and the viewer keeps working from its local log.

Plan-agent models and efforts use the same three levels as the board (`.zboard/config.json` `agents.<role>`, the
settings pickers, defaults: brainstormer, drafter, critic and judge opus 5.5/high; explainer sonnet 5.5/medium;
the drafter writes `tasks.md` with sonnet 5.5/medium).

## Pipeline rules

- Only tasks from `tasks.md` run; tasks created with `board_create_task` or native `TaskCreate` are tracked.
- A task depends on the tasks of the previous `##` section unless its text says `depends on 1.2` or `BLOCKED on 1.2`.
- Gates: research needs `path:line` evidence; plan needs allowed files and test files inside the repo;
  tdd must fail only on the new tests; code and refactor must pass the test command; review must return valid
  verdict JSON. A failed gate is retried once with the reason, then the task needs a decision.
- Test files run one at a time from the repository root through the test command (see [Test command](#test-command)).
  A test file must be a plain repository-relative path (not absolute, no `..`, not starting with `-`) or it is
  never run. A run that cannot finish never counts as a pass.
- When the whole change is done, run your project's full test suite (with ptest: `ptest --full`) before handing off.

## Configuration

Precedence, most specific first: `/zboard set` > `.zboard/config.json` > the plugin's settings pickers > defaults.

```json
{ "agents": { "reviewer": { "model": "opus 5.5", "effort": "max" } }, "autoEscalate": true }
```

Defaults: researcher sonnet 5.5/medium, planner opus 5.5/xhigh, tdd sonnet 5.5/low, implementer
sonnet 5.5/medium, reviewer opus 5.5/high, refactorer sonnet 5.5/medium.

### Test command

With no `testCommand`, zboard runs each test file as `ptest <file>` (timeout 10 minutes; exit 70/75/124 or a
timeout is retried once and never counts as a pass). zboard does not install ptest: either have it on your `PATH`
or set your own command in `.zboard/config.json`:

```json
{ "testCommand": ["uv", "run", "pytest", "{file}"], "testTimeoutMs": 300000 }
```

```json
{ "testCommand": ["npx", "vitest", "run", "{file}"] }
```

- `testCommand` is an argv array, never run through a shell: 1–32 non-empty strings, each at most 512 characters.
  Every `{file}` inside an element is replaced by the repository-relative test file; with no `{file}`, the file is
  appended as the last element.
- `testTimeoutMs` is optional: an integer from 1000 to 3600000 (default 600000). Claude Code kills a process after
  ten minutes, so values above 600000 are capped there with a warning. Without `testCommand` it is ignored.
- An invalid value shows a config warning in the board header and in `/zboard config`, and ptest stays in use.
- Exit 0 is a pass and any other exit is a failure; a run that times out or cannot start is retried once, then the
  result is incomplete. Failing tests are read from pytest `FAILED …` and vitest `FAIL … > …` lines.
- The judge's `true` verdict needs a cited test that passed with at least one executed test. zboard reads that
  count from ptest's end line and from pytest (`N passed` summary), vitest (`Tests  N passed`), jest
  (`Tests: N passed`), go test (`ok <pkg>` lines) and cargo (`test result: ok. N passed`) output. Any other
  runner's output counts as zero executed tests, so its findings can at best be `no_evidence`, which you can
  accept without evidence.
- Pick a command that runs a single test file. `go test` runs packages rather than files, so it does not fit a
  per-file `testCommand` well.

## Engram

Execution state and artifacts are mirrored to Engram (`zboard/<project>/<change>/…`) every 10 s and before
compaction. If Engram is unavailable the board keeps running and shows `⚠ mirror pending`. If your session
asks for permission on each Engram write, allow the three tools in your settings:

```json
{ "permissions": { "allow": ["mcp__engram__mem_save", "mcp__engram__mem_search", "mcp__engram__mem_get_observation"] } }
```

## Develop

```bash
claude plugin validate .
claude plugin test .
npx --yes -p typescript@5.6 tsc -p .
```

### Why everything is wired in `hooks/register.tsx`

Claude Code's module checker shapes the layout:

- `$` is followed only into functions of the same file, never across an import.
- `$.state` is read only through atoms declared in the calling file.
- Hooks must be function literals inside `on(...)`, and each event takes one hook without a matcher.

So `register.tsx` is the composition root. It holds the atoms, every hook, and one `ioOf($)` that builds the
`Io` ports (`hooks/runtime/io.ts`). Every other module receives that `Io` and stays testable without the engine.
Tests answer the ports from an in-memory world (`hooks/testing/world.ts`).

## License

[MIT](LICENSE) © 2026 ReylanLugo
