# zboard

A Claude Code mod that shows every task of an OpenSpec change on a board and drives each task through
research → plan → tdd → code → review (→ refactor loop) with subagents, gates it checks mechanically,
scoped `ptest` runs, one commit per task, and the `tasks.md` checkbox flipped only after a verified commit.

## Install

Load it from this folder for one session:

```bash
claude --plugin-dir /path/to/zboard
```

or add the folder as a plugin marketplace and install it, so `/reload-plugins` re-reads the folder.

## Use

| Command | Effect |
|---------|--------|
| `/zboard` | Open the board pane |
| `/zboard run <change>` | Load `openspec/changes/<change>/tasks.md` and start the pipeline (3 tasks at a time) |
| `/zboard run <change>/<label>` | Run one task only |
| `/zboard pause` | Let running phases finish; start nothing new until the next `/zboard run` |
| `/zboard set <label> <agent> <model> <effort>` | Per-task model/effort for one agent role, e.g. `/zboard set 2.1 implementer opus 5.5 high` |
| `/zboard config` | Effective model and effort per agent, with the level each value came from |
| `/zboard import-odd <feature>` | Preview a gentle-ai ODD feature as an OpenSpec change; `--confirm <digest>` writes it |

Board keys (while the pane holds the keyboard): Tab/arrows move between cards, Enter opens the detail,
`c` comment, `b` block/unblock, `p` priority, `v` Kanban → Swimlanes → Tree, `f` filter, `a` full artifact
in the detail, Esc closes the detail.

The main session can read the board with `board_status`, `board_task`, `board_artifact` and `board_agent`,
and comment with `board_comment`. It is told only when a task needs a decision or the change is complete.

## Pipeline rules

- Only tasks from `tasks.md` run; tasks created with `board_create_task` or native `TaskCreate` are tracked.
- A task depends on the tasks of the previous `##` section unless its text says `depends on 1.2` or `BLOCKED on 1.2`.
- Gates: research needs `path:line` evidence; plan needs allowed files and test files inside the repo;
  tdd must fail only on the new tests; code and refactor must pass `ptest`; review must return valid
  verdict JSON. A failed gate is retried once with the reason, then the task needs a decision.
- Tests run only as `ptest <file>` from the repository root. Exit 70/75/124 or a timeout is retried once and
  never counts as a pass.
- When the whole change is done, run the integrated `ptest --full` gate yourself before handing off.

## Configuration

Precedence, most specific first: `/zboard set` > `.zboard/config.json` > the plugin's settings pickers > defaults.

```json
{ "agents": { "reviewer": { "model": "opus 5.5", "effort": "max" } }, "autoEscalate": true }
```

Defaults: researcher sonnet 5.5/medium, planner opus 5.5/xhigh, tdd sonnet 5.5/low, implementer
sonnet 5.5/medium, reviewer opus 5.5/high, refactorer sonnet 5.5/medium.

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
