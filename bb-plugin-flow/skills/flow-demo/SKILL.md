---
name: flow-demo
description: The Demo stage — stop and show the owner everything done since the previous demo, with a link to every result and a live result in one click; the owner continues or sends a comment. In bb — a brief with outcome via ask_decision; in plain Claude Code — a report and AskUserQuestion. Use it on the Demo stage of a Flow and when the work has reached a point where the owner should see it. Этап Демонстрация — показать сделанное и живой результат.
---

# Demo

If the owner writes in Russian, read [ru.md](ru.md) in this folder instead — it is the same skill in Russian; otherwise follow this file.

The owner sees what was done and decides what next. A demo is a stop: after it the turn ends and waits for the answer.

## What to show

- Everything done since the previous demo, and for the first one — since the start of the work. In sections, briefly; one section per large part.
- A link to every result: a file, a task, a page, a PR.
- What was not done and why.
- **Code changed — a live result in one click.** Bring up what was made, check that it responds, and give a page or a launch command. A desktop app — a launch command.
- **A bb plugin** does not come up from a working tree by itself: bb loads a plugin from its install path. The install can be pointed at the worktree with one command, `bb plugin install --yes path:<worktree>`, but that is temporary and the install must be returned to its permanent source; `bb plugin remove` erases the plugin's database, do not run it. Simpler: until the merge and the plugin update step, the live result is the plugin's test run command and a screenshot; after — the plugin itself.
- **A bug was fixed — steps that show it is gone.** On the same input where it occurred, not on a convenient substitute.
- Only documents changed — there is no live result, say so.

## How to show

**In bb.** An `ask_decision` brief with `outcome` instead of setup:

- `stage` — this stage's id from the turn instructions; `final` — whether it is the last demo; `next` — the next stage, only when it is not the last.
- `done` — what closed since the previous demo; `pending` — what did not, with `why`; `sections` — report sections `{ title, text }`; `notes` — the important in one line: bug check steps, caveats; `tasks` — tasks without `note`: `done: true` — this demo shows the task's final result; before the call, set its status to In Review with `bb tasks update <key> --status in_review`, and it becomes done when the owner accepts the step; `done: false` — a task only created in this thread. The widget shows them under "Review" and "Created", each as its Tasks+ card that opens the task in the thread's side panel.
- The plugin changed — a section "Changelog" in `sections` with the text of the changelog entry as it is in the file `bb-plugin-<name>/changelog/<slug>.md`, Russian and English: the owner sees what users will read before the merge.
- `results` — at least one: `{ label, target }` — a file, path or address; `{ label, command }` — a command the owner runs with a button. Unless `documentsOnly: true`, the results hold a live one: an `http(s)` page or a command.
- A local server page is shared via `bb connect expose <port>`; without Connect — `http://localhost:<port>`.

The format is in the Flow plugin instructions and the tool description. After the call, paste the directive line as a standalone line and end the turn. On getting the answer, stop what you brought up and remove the share: `bb connect unexpose <port>`.

**In Claude Code.** A reply in sections: "Done", "Not done", "How to check". Every file, folder and address as a markdown link. The live result — the `http://localhost:<port>` address of the running server or exactly one launch command in a bash block. Then AskUserQuestion "What next?": "Continue" (Recommended), and the owner writes a comment in "Other". On getting the answer, stop what you brought up.

No AskUserQuestion — the same report ending with "continue or write a comment", and the turn ends.

## After the answer

- Continue — go to the next stage. The tasks under "Review" go to done: the automation step "Task → done" moves every task linked to the thread; one not linked to it, or a flow without that step, — set it done yourself: `bb tasks update <key> --status done`.
- A comment — the demo is not accepted and stays open: do not move on along the flow. Answer the comment. If it asks for a change, return the work to the stage where the change is made — in bb mark that stage started with flow_stage: Flow drops the done state of every stage after it — and go through those stages again in order, reviews and automations included, up to this demo: otherwise the change skips the review and the commit after it. A comment without a change — send the demo of this stage again.
