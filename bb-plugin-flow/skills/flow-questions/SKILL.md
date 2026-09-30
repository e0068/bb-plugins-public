---
name: flow-questions
description: The Questions stage — ask the owner about whatever blocks the work: forks, picking several options, "did I get this right". In bb — one ask_decision brief; in plain Claude Code — AskUserQuestion. Use it on the Questions stage of a Flow and whenever a fork or a misunderstanding stands before the work and cannot be settled by the code, the task or a sensible default. Этап Вопросы — развилки, выбор нескольких, «правильно ли я понял».
---

# Questions

If the owner writes in Russian, read [ru.md](ru.md) in this folder instead — it is the same skill in Russian; otherwise follow this file.

The stage removes whatever the work cannot rightly start without. The owner answers once, and the work then follows the answer.

## What to ask

Only what the owner decides and what changes the result. A fact you can check in the code, the task or the docs — check it yourself. A choice with an accepted default — make it yourself and name it in the report.

| Kind | When | How |
| --- | --- | --- |
| Fork | Two or three paths, the choice changes the outcome | Every option says what happens, its cost and risk; your pick is marked recommended |
| Pick several | Several items can be taken | Several may be recommended |
| "Did I get this right" | The task reads ambiguously or is made of important nuances | One option "Yes"; the context says how you understood the task; the owner writes their own version. Done-when criteria do not go here — they are the Criteria stage |

Gather everything that has piled up in one go. Do not ask one question per turn.

## How to ask

**In bb.** Questions go into `questions` of an `ask_decision` brief: `fork`, `pick`, `confirm`. If the Criteria and Stage selection stages follow, their parts go into the same brief — one brief, not three. The brief format is in the Flow plugin instructions and the tool description. After the call, paste the directive line from the result as a standalone line and end the turn.

**In Claude Code.** Up to four questions per AskUserQuestion call, two to four options each. The recommended option goes first, with "(Recommended)" appended to its label. An option's description says what happens and how much costlier or riskier it is than the recommended one. "Did I get this right" is a question with "Yes" and "No, I'll correct it": the owner writes their own in "Other". More than four questions — a second call in the same turn.

No AskUserQuestion either — questions as a numbered list at the end of the reply, each with options and a recommendation, and the turn ends.

## After the answer

Work by the answer without arguing with the choice. If it differs from your recommendation and changes cost or risk, name that in the report in one line. A new question mid-work — only when it is unclear how to proceed without it.

The owner picked a fork option that someone may later want to undo — that is a project decision: in a repository with `docs/`, record it as a file in `docs/decisions/` — what was decided, why, what was rejected and on what grounds — and a line in `docs/INDEX.md`, before implementation. One decision — one file; an outdated one is revoked by a new record linking to the old, not by editing it retroactively. A choice without a rejected alternative, or one that changes together with the code, is not recorded: its place is a comment in the task or next to the code.
