---
name: flow-criteria
description: The Criteria stage — agree "Done when" with the owner before the task is created and the work begins. In bb — setup.criteria items of an ask_decision brief; in plain Claude Code — a list and AskUserQuestion. Use it on the Criteria stage of a Flow and before any task whose work will later be accepted against it. Этап Критерии — «Готово, когда» до начала работы.
---

# Criteria

If the owner writes in Russian, read [ru.md](ru.md) in this folder instead — it is the same skill in Russian; otherwise follow this file.

"Done when" is what the work will be accepted by. The owner approves it before the task and before the first edit; an approved item is never changed by your hand. It is the only thing the owner approves before the work: a spec, a plan and a prototype are documents for agents — they are taken or dropped at stage selection, and no separate "yes" on their text is awaited.

## What makes a good item

- One item — one checkable statement. A checker must decide "yes" or "no" without asking the author.
- A change is written as a "before / after" pair, and "before" is measured before the first edit: "the screen opens in 4 s → under 1 s", not "the screen opens fast".
- An item speaks of the result, not the method: "old flows open unchanged", not "added a fallback to the parser".
- A signal is not a criterion. "The graph nodes are green" shows that something was done but not what exactly got better.
- Invariants of any task are not written as criteria unless the owner asks: the test base is green before and after, promise tests are written before the code and were red, the review was done by someone other than the author, docs are edited in the same diff when the design changes, the code branch is published as a PR, the task is in done with a report. They are always checked; a criterion speaks of what is special about this work.
- For a research task the criterion is the question to answer: "yes", "no" or a choice of option.

Criteria rest on the answers of the Questions stage. A fork option that adds or removes items is marked so.

## How to agree

**In bb.** Items go into `setup.criteria` of the same `ask_decision` brief as Questions and Stage selection. A string is a plain item; `{ text, before, after }` is a change; `add` is the item's share of the stage cost. Items that depend on a fork option go into that option's `criteria`, and the ones it strikes into `removes`. The format is in the Flow plugin instructions and the tool description.

**In Claude Code.** Items as a numbered list in the reply, changes as "before → after". Then AskUserQuestion: "Approve the criteria" (Recommended) and "Correct them" — the owner writes the correction in "Other" or in the next message. After a correction show the list again and ask again.

No AskUserQuestion — the list at the end of the reply with a request to approve or correct, and the turn ends.

## After approval

The items go into the task's "Done when" section verbatim. If it turns out mid-work that an item is unreachable or wrong, stop and offer the owner a new wording; never silently steer the work past a criterion.
