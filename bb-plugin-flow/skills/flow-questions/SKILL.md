---
name: flow-questions
description: 'The Questions stage — ask the owner about whatever blocks the work: forks, picking several options, "did I get this right". In bb — one ask_decision brief; in plain Claude Code — AskUserQuestion. Use it on the Questions stage of a Flow and whenever a fork or a misunderstanding stands before the work and cannot be settled by the code, the task or a sensible default. Этап Вопросы — развилки, выбор нескольких, «правильно ли я понял».'
---

# Questions

If the owner writes in Russian, read [ru.md](ru.md) in this folder instead — it is the same skill in Russian; otherwise follow this file.

The stage removes whatever the work cannot rightly start without. The owner answers once, and the work then follows the answer.

## What to ask

Only what the owner decides and what changes the result. A fact you can check in the code, the task or the docs — check it yourself. A choice with an accepted default — make it yourself and name it in the report. Anything so unclear that it cannot be phrased even as a Definition of Done item is a question.

| Kind | When | How |
| --- | --- | --- |
| Fork | Two or more paths, the choice changes the outcome | Every option says what happens, its cost and risk; your pick is marked recommended |
| Pick several | Several items can be taken | Several may be recommended |
| "Did I get this right" | The task reads ambiguously or is made of important nuances | One option "Yes"; the context says how you read the ambiguous point — the brief's scope already says what you understood, the question does not retell it; the owner writes their own version. Definition of Done items do not go here — they belong to the Definition of Done stage |

Gather everything that has piled up in one go. Do not ask one question per turn.

## How to ask

**A question reads by itself.** The open brief shows the owner the questions with their options; the title and intro of the brief are not seen next to them. So the question and its context name the problem in plain words — what is broken or what is being chosen and how it affects the user — not a process step. Not "What do we do with the review?", but "On a phone, a search erased to empty closed the field together with the keyboard; I fixed it, the reviewer has not seen the fix — check again?". Before sending, re-read each question apart from the intro: is it clear from it alone what it is about and how the options differ.

**In bb.** Questions go into `questions` of an `ask_decision` brief. If the Definition of Done and Stage selection stages follow, their parts go into the same brief — one brief, not three. After the call, paste the directive line from the result as a standalone line and end the turn.

| `kind` | When | What is required |
| --- | --- | --- |
| `fork` | Two or more ways, the choice changes the outcome, one answer | Every option has a `description` — a paragraph about what happens and the risks in prose — and an `add`; before launch one option is the simplest at 0. The old `cost` (up to 40 characters) and `risk` `XS`…`XXL` pair is accepted only on an option without `add`. At most one recommended |
| `pick` | Several answers from a set: which edits to make, what to do after approval | Every option has a `description`; `add` — if the option changes the budget or risk. Several may be recommended |
| `confirm` | "Did I get this right" about one reading the `scope` leaves open | Exactly one "Yes" option; `context` says how you read that point as a nested list — the `scope` above already says what you understood, so the question does not retell it. The owner writes disagreement as their own answer |

A question `id` does not start with `setup.`. Do not save on text length: the wording, description and price are shown in full. The owner can answer any question in their own words.

**A fork is priced from its simplest answer.** Before the work is launched, every fork with prices has an option that costs 0 — the simplest answer, whose work is already in `setup.criteria` (see `flow-criteria`). Every other option's `add` is the price of its own `criteria`, counted from zero, in the same `{ "target", "max", "risk", "minutes" }` as an item: an answer that builds on the simple one costs only what it adds, an answer that replaces it costs its whole work and lists the replaced items of the simple answer in `removes` — the plugin subtracts their price itself, so the option never subtracts it again. The recommended answer is not the anchor: when you recommend a richer answer, it is priced above zero like any other. A minus in dollars or minutes means a richer answer sits in the base, and the tool refuses it; an option's risk may go either way. Example: the base item "the chart filter also narrows the table" costs `{ "target": 1, "max": 2 }` and is the simple answer, "Shared filter" costs 0; "Own table filter" costs its whole work `{ "target": 2, "max": 4 }` with the item "the table has its own filter" and `removes` of the base item, so choosing it moves the scope by +$1–2. In a brief in the middle of the work the base is the approved scope, so both answers of a fork may add to it.

**`hides`** — mark a question that only matters for one of the answers to another question with the option field `hides`: an array of `id`s of questions of the same brief, placed below, that lose their meaning with this choice; you cannot hide a question above or the option's own question. The owner does not see hidden questions, does not answer them, and they are not in the answer; the owner does not see the mark either.

**criteria on an option** — "Definition of Done" items that only matter for one answer, an array of strings: they stand in the "Definition of Done" list while the option is chosen, and an item of an option the owner drops themselves stays in the list struck through until the brief is answered, so the owner sees what their refusal took away. An option the owner never touched shows nothing. The answer names the live ones as items of the chosen options and the struck ones as dropped, so an item that depends on one answer goes on the option, not into setup.criteria — that way the list settles itself and nobody edits it twice. Do not repeat them in `setup.criteria` or price them twice.

**`removes`** — an option that makes items of `setup.criteria` pointless — "look first", "postpone" — lists their indexes from zero: the widget strikes them out while the option is chosen and brings them back when it is not, and the answer names them as removed. Do not count those items in the option's `add`: the plugin subtracts the shares of the items in removes itself.

```json
{
  "title": "CEL-115 — tree in DevShell",
  "kind": "brief",
  "questions": [
    {
      "id": "when", "kind": "fork", "question": "What should CEL-115 build on, and when to implement it?",
      "context": "The CEL-115 spec relies on inheritanceStates from the CEL-114 spec.",
      "options": [
        { "id": "now", "action": "Spec now, code after CEL-114", "recommended": true,
          "description": "I write the spec on the CEL-111 branch and start the code once CEL-114 is merged. Risk: the spec needs fixing if CEL-114 changes in review.",
          "add": { "target": 1, "max": 1, "risk": 1, "minutes": 2 } },
        { "id": "wait", "action": "Wait for all of CEL-114",
          "description": "I start nothing until CEL-114 is approved and implemented.",
          "add": { "target": 0, "max": 0, "risk": 3 } }
      ]
    },
    {
      "id": "vocabulary", "kind": "pick", "question": "Which vocabulary edits to make?",
      "options": [
        { "id": "row", "action": "Add \"Tree row\"", "recommended": true, "description": "The view the tree draws each row with: depth and the shown object." },
        { "id": "leaf", "action": "Remove \"Branch\" and \"Leaf\"", "description": "\"Tree row\" replaces both words." }
      ]
    },
    {
      "id": "reading", "kind": "confirm", "question": "Did I get this right?",
      "context": "- The plus that creates something new\n  - sits only in the first row\n  - as in the prototype",
      "options": [{ "id": "yes", "action": "Yes", "recommended": true }]
    }
  ]
}
```

**In Claude Code.** Up to four questions per AskUserQuestion call, two to four options each. The recommended option goes first, with "(Recommended)" appended to its label. An option's description says what happens and how much costlier or riskier it is than the recommended one. "Did I get this right" is a question with "Yes" and "No, I'll correct it": the owner writes their own in "Other". More than four questions — a second call in the same turn.

No AskUserQuestion either — questions as a numbered list at the end of the reply, each with options and a recommendation, and the turn ends.

## After the answer

Work by the answer without arguing with the choice. If it differs from your recommendation and changes cost or risk, name that in the report in one line. A new question mid-work — only when it is unclear how to proceed without it.

The owner picked a fork option that someone may later want to undo — that is a project decision: in a repository with `docs/`, record it as a file in `docs/decisions/` — what was decided, why, what was rejected and on what grounds — and a line in `docs/INDEX.md`, before implementation. One decision — one file; an outdated one is revoked by a new record linking to the old, not by editing it retroactively. A choice without a rejected alternative, or one that changes together with the code, is not recorded: its place is a comment in the task or next to the code.
