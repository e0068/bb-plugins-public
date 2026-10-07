---
name: flow-criteria
description: The Definition of Done stage — agree the Definition of Done with the owner before the task is created and the work begins. In bb — setup.criteria items of an ask_decision brief; in plain Claude Code — a list and AskUserQuestion. Use it on the Definition of Done stage of a Flow and before any task whose work will later be accepted against it. Этап Definition of Done — критерии приёмки до начала работы.
---

# Definition of Done

If the owner writes in Russian, read [ru.md](ru.md) in this folder instead — it is the same skill in Russian; otherwise follow this file.

"Definition of Done" is what the work will be accepted by. The owner approves it before the task and before the first edit; an approved item is never changed by your hand. It is the only thing the owner approves before the work: a spec, a plan and a prototype are documents for agents — they are taken or dropped at stage selection, and no separate "yes" on their text is awaited.

## What makes a good item

- One item — one checkable statement. A checker must decide "yes" or "no" without asking the author.
- A change is written as a "before / after" pair, and "before" is measured before the first edit: "the screen opens in 4 s → under 1 s", not "the screen opens fast".
- The item's text reads by itself, without its before/after pair: a part of the brief widget shows only the text. Not "Under the table", but "Under the table one row: "Add stage" on the left, "Delete flow" on the right — instead of a strip of seven buttons".
- An item speaks of the result, not the method: "old flows open unchanged", not "added a fallback to the parser".
- An item is written in the owner's language: what they will see, be able to do or stop putting up with — "the restore step no longer fails red, no need to press Retry", not "npm ci installs dev packages". Packages, flags, file and test names stay out of the item — they belong in the report. Check before sending: would someone who never read the code understand the item?
- A signal is not a Definition of Done item. "The graph nodes are green" shows that something was done but not what exactly got better.
- Invariants of any task are not written into the Definition of Done unless the owner asks: the test base is green before and after, promise tests are written before the code and were red, the review was done by someone other than the author, docs are edited in the same diff when the design changes, the code branch is published as a PR, the task is in done with a report. They are always checked; the Definition of Done speaks of what is special about this work.
- For a research task the Definition of Done is the question to answer: "yes", "no" or a choice of option.

The Definition of Done rests on the answers of the Questions stage. A fork option that adds or removes items is marked so.

## How to agree

**In bb.** Items go into `setup.criteria` of the same `ask_decision` brief as Questions and Stage selection.

**What you understood — `scope`.** Every brief before the work is launched starts with `scope`: the minimal set of work you understood — every fork at its simplest answer — as a nested list (`"- item\n  - detail"`). The widget shows it first, above the questions, with the base price next to it. Its items are the first items of `criteria`.

**An item** is `{ "text", "add" }`; an item that changes something existing is `{ "text", "before", "after", "add" }` — the widget draws "before" and "after", and the owner edits only "after". At least one item. The owner removes an item with a cross, rewrites the text or adds an item of their own; the edits arrive in the answer as a line "Definition of Done — removed item 3 "…"; rewrote item 1 — "…"; added item "…"". Items that depend on a fork option go into that option's `criteria`, and the ones it strikes into its `removes` — see `flow-questions`.

**The price is counted from the scope.** An item's `add` is `{ "target", "max", "risk", "minutes" }`: what you, on the current model and effort, actively spend on that item, in dollars as target and ceiling and in whole minutes — both above zero. The minutes are your active time on the item together with its own tests and checks; waiting for the owner or an automation is not in them. The kept items are the base; an item the owner strikes leaves it. Scope = base + chosen options. The tool refuses a brief before launch without `scope` or with an unpriced item.

**Minutes are anchored to the fact.** A whole done task, all its stages included, took (median `minutes_actual` in `docs/tasks/done/`): xs 12 (3 tasks), s 17 (9), m 29 (24), l 50 (30) minutes; the plan of the same tasks was a median 1.75 times the fact (1.65 by totals), overestimated in 55 of 67. So the forecast of a brief — items plus stages — together with the planning already spent lands in the band of a task of the same estimate; a forecast above it needs a reason named in the intro. Before pricing, look at the fact of similar done tasks, not at their plan; recount the medians when the history grows.

**The risk of an item** is what implementing it adds: 1r ≈ 10% chance that a blocking defect reaches the owner. The implementation risk of the whole task is spread across its items — summed over the items, xs +1, s +3, m +5, l +6 (measured; the scale and what lowers it are in `flow-stage-selection`).

```json
{
  "title": "CEL-115 — tree in DevShell",
  "intro": "The CEL-114 spec is approved, the CEL-114 code is not merged yet. The task is m: the forecast is about 26 min, the m median is 29.",
  "kind": "brief",
  "scope": "- Build the DevShell tree from inheritanceStates, with layout tests\n  - rows show depth and object",
  "setup": {
    "criteria": [
      { "text": "The DevShell tree is built from the inheritanceStates of the CEL-114 spec", "add": { "target": 2, "max": 4, "risk": 4, "minutes": 10 } },
      { "text": "A tree row shows depth and object", "before": "A row is only the object name", "after": "Indent by depth and the object name", "add": { "target": 1, "max": 2, "risk": 1, "minutes": 5 } }
    ]
  }
}
```

The two items take 15 minutes with their tests, the recommended fork answer 2 more (the example in `flow-questions`), the stages of the run about 9 (the example in `flow-stage-selection`) — about 26 in all, near the m median.

**In Claude Code.** Items as a numbered list in the reply, changes as "before → after". Then AskUserQuestion: "Approve the Definition of Done" (Recommended) and "Correct them" — the owner writes the correction in "Other" or in the next message. After a correction show the list again and ask again.

No AskUserQuestion — the list at the end of the reply with a request to approve or correct, and the turn ends.

## After approval

The items go verbatim into the task's "Definition of Done" — its «Готово, когда» section. If it turns out mid-work that an item is unreachable or wrong, stop and offer the owner a new wording; never silently steer the work past the Definition of Done.
