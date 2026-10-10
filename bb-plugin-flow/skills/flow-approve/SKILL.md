---
name: flow-approve
description: "The Approval stage — the only stage of a Flow that holds the work. Show the owner what is being approved and wait: Approve without a comment lets the run go on, a comment sends the work back to the stage before. In bb — a brief with outcome via ask_decision; in plain Claude Code — a summary and AskUserQuestion. Use it on the Approval stage of a Flow. Этап Утверждение — единственная остановка, утвердить без комментария или вернуть."
---

# Approval

If the owner writes in Russian, read [ru.md](ru.md) in this folder instead — it is the same skill in Russian; otherwise follow this file.

An approval is the only stage that holds the work. Everywhere else a comment does not stop you: ask about what is unclear and carry on with what is clear. On an approval you stop, and the run goes on only after Approve without a comment.

## What to show

- **After a stage with a widget** — Questions, Definition of Done, Stage selection, a demo — the approval comes right after that stage's widgets, as the last of them. Its `done` names what the owner is approving: the agreed Definition of Done items, the chosen stages, the demo shown.
- **After a skill stage** — a spec, a plan, code — the approval is a summary in three `sections`:
  - "Approved earlier" — what the previous approvals of this run approved, briefly; none — no section.
  - "Done since the last approval" — what you did since then, and for the first approval — since the start of the work.
  - "Next" — what you will do after Approve, stage by stage.
- A link to everything being approved: the task, the spec, the plan, the PR.

## How to show

**In bb.** An `ask_decision` brief with `outcome`, like a demo:

- `stage` — this approval stage's id from the turn instructions; `final: false`; `next` — the stage after it.
- `done` — what is being approved; `pending` — what is not done yet and why.
- `sections` — the summary after a skill stage.
- `results` — at least one link to what is approved. An approval needs no live result.

The widget has the "Comment" field and the Approve button; with a comment written the button becomes Send. After the call, paste the directive line as a standalone line and end the turn.

**In Claude Code.** The same summary in sections, every file as a markdown link, then AskUserQuestion "Approve?": "Approve" (Recommended), and the owner writes a comment in "Other".

## After the answer

- Approve without a comment — go on to the next stage.
- A comment — not approved: the run stays. Rework the stage before this approval as the comment asks — in bb, if that stage is done, roll back to it with flow_stage — go through the stages after it again in order, and send this approval again.
