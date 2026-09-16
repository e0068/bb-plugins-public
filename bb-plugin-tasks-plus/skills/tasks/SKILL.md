---
name: tasks
description: Use when asked to work on or track a task in the Tasks plugin, when the prompt mentions a task key such as ABC-12, or when work needs task comments, attachments, delegation tracking, or status updates.
---

# Tasks

Use the `bb tasks` CLI to understand the assigned task, keep its record useful,
and report the outcome where the work is tracked.

Delegation presets are user-defined; Tasks ships with none. Before dispatching
work, use `bb tasks preset list` and create a preset if the required one does
not already exist. Dispatch requires an existing preset.

## Work a task

1. Find and read the task before acting:

   ```sh
   bb tasks show ABC-12
   ```

   A task answers to its key (`ABC-12`, any case), to its file's slug (the
   file name under the tasks folder without `.md`), or to its id
   `<boardId>:<slug>`. Two kinds of task have no key: a file written by
   hand, and — more often — a task you created from a thread working in a
   worktree. A key is the board's name for a task, and the board sees a task
   only once its file is in the main checkout, so a branch-born task carries
   none until it lands there. Address such a task by its slug — that is what
   `show`, `list`, and a task card print as its key.

   The detail includes the description, status, priority, labels, subtasks,
   comments, attachments, attached worker threads, and the GitHub pull
   requests those threads produced (from environment metadata, with state
   open/draft/merged/closed). Use
   `bb tasks show ABC-12 --json` when the result will drive commands or code.

   For project-wide discovery, `bb tasks list` returns at most 100 rows by
   default. Pass `--limit 1-500`; in JSON, continue with `nextCursor` via the
   same filters/sort and `--cursor <value>`. A task-list mutation makes an old
   cursor stale, so restart without it.

2. Fetch every relevant attachment before making assumptions about it:

   ```sh
   bb tasks attachment get <attachment-id> --out <path>
   ```

3. Do the work. Post one substantive comment at each meaningful milestone,
   such as a completed investigation, an implementation ready for validation,
   or a concrete blocker:

   ```sh
   bb tasks comment ABC-12 --body "Implemented the change; focused validation now passes."
   ```

   Add `--notify` only when the new comment should be delivered to the thread
   that authored the task's most recent agent reply. This resumes an idle
   recipient; with no prior agent reply, the comment is recorded without
   targeting an unrelated thread. In agent context, the new comment keeps the
   current thread identity and an explicit `--author`, while delivery still
   targets the prior latest responder rather than the new comment itself.

4. Attach result artifacts that belong with the task, such as reports,
   screenshots, patches, or generated files. `--file` accepts images and
   other files (for example `.png`, `.jpg`, `.svg`, `.pdf`, `.md`, `.patch`,
   or logs).

   **Task-level attachment** — pass the task key so the file sits on the
   task itself:

   ```sh
   bb tasks attachment add ABC-12 --file ./report.md
   bb tasks attachment add ABC-12 --file ./screenshot.png
   ```

   **Comment-level attachment** — pass a comment ID so the file sits on that
   comment (for example a screenshot that belongs with a specific milestone
   note). Create the comment with `--json`, capture `.comment.id`, then add
   the attachment:

   ```sh
   comment_id=$(
     bb tasks comment ABC-12 \
       --body "Screenshot of the failing step." \
       --json | jq -r '.comment.id'
   )
   bb tasks attachment add "$comment_id" --file ./screenshot.png
   bb tasks attachment add "$comment_id" --file ./trace.log
   ```

   A task key attaches at task level; a comment ID attaches to that comment.
   Do not pass a task key when the file should hang off a comment. Use
   `--json` when capturing the returned attachment metadata. When creating a
   task that should start with files, pass repeatable `--attach <path>` to
   `bb tasks create` instead of attaching afterwards. Remove an attachment by
   id with `bb tasks attachment remove <attachment-id>` (row and blob are
   deleted together); reuse the ids from `bb tasks attachment list <key>`.
   Referenced attachments are rejected unless the caller explicitly confirms
   content cleanup with `--remove-references`; that flag removes the saved
   description image reference together with the row and blob.

   File paths (`--file`, `--attach`, `--out`, `--description-file`,
   `--body-file`) are read from and written to the invoking machine: inside
   an agent thread that is the thread's machine, so local paths just work.
   Outside a thread they target the server's machine; pass
   `--machine <id-or-name>` to address files on another enrolled machine.

5. When the work is ready for review, update the task:

   ```sh
   bb tasks update ABC-12 --status in_review
   ```

   Change task hierarchy with `bb tasks update ABC-12 --parent ABC-10`, using
   either a task key or ID for the parent. Promote a subtask to the top level
   with `bb tasks update ABC-12 --no-parent`; the two parent flags cannot be
   combined.

   Who does the task and which epic it belongs to are folders, not
   frontmatter: `<tasks>/<status>/` has neither, `<tasks>/<Assignee>/<status>/`
   has an assignee, `<tasks>/<Assignee>/<Epic>/<status>/` has both. Set them
   with `--assignee <name>` and `--epic <name>` on `create` or `update` — the
   file moves, the key, id and comments stay. `--no-assignee` returns the file
   to the root and drops the epic with it; `--no-epic` keeps the assignee. An
   epic without an assignee is refused. A new name is created by using it.

   The file itself is yours to change through the same command. `--slug
   <name>` renames the file (the id follows; subtasks keep pointing at it).
   `--key ABC-40` gives a keyless file a key or replaces one. `--no-key`
   takes a key off, but only for a task living in a branch: in the main
   checkout every task has a board name, and a removed one would come back
   with the very next write, so the command is refused there. A task that
   arrived in main by a merge gets its key on the first write of any kind —
   a status change, a field edit, a comment. To drop a duplicate or a stray
   file for good:

   ```sh
   bb tasks delete ABC-12 --yes
   ```

   Cancelling is a status (`--status canceled`), not a deletion. Never edit
   or move a task file by hand in a checkout the board publishes — the
   board is the file's writer, and a second writer makes the merge conflict
   on the task journal.

   If the work cannot proceed, leave the status accurate and comment with the
   specific blocker, what you tried, and what would unblock it. Do not mark a
   blocked task complete.

6. Delegated threads are attached automatically. If this thread was not
   delegated from Tasks, attach it yourself so the task shows the active work:

   ```sh
   bb tasks attach ABC-12
   ```

## Link tasks in responses

When your answer refers the user to a task — including a task you just
created — emit this leaf directive on its own line instead of writing the
key as plain text:

```md
::task{key="ABC-12"}
```

`key` is required, and it takes either form of address: a board key
(`ABC-12`) or a file slug (`scene-as-data-not-code`) for a task that has no
key yet. Optionally add `title="…"` as a display fallback shown
while the card loads and when the key no longer resolves. The rendered card
shows the live status, title, and priority, opens the task in the thread
side panel, and links to the full Tasks app. Emit one directive per line;
each renders its own card.

## Invariants

- Valid task statuses are `backlog`, `todo`, `in_progress`, `in_review`,
  `done`, and `canceled`.
- Use `in_review` when implementation is complete but still needs human or
  agent review. Use `done` only when the task's completion criteria are met.
- Write one comment per meaningful milestone. Combine related facts into a
  useful update; never spam progress pings, command-by-command narration, or
  repeated status messages.
- Comments should say what changed or was learned, what validation ran, and any
  remaining risk or blocker.
- Prefer stable task keys such as `ABC-12` for task commands; for a task that
  has none yet, its slug is the stable address and works everywhere a key
  does. Use `--json` for machine-readable output and human output for quick
  inspection.
