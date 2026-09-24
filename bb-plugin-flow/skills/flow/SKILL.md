---
name: flow
description: How to talk to the owner through the ask_decision tool — as a brief in the thread, not in prose. A brief holds questions, "Done when" items, the work stages of the thread's flow — what is done, what to take into the run and who executes — and a budget with recommendations; a demo brief shows what the stages since the previous demo did. Use it whenever you have a question, a clarification, a fork or a point of confusion; when you want to offer options, learn the budget and the stage executors, reach a demo stage of the flow, or agree on the "Done when" criteria before creating a task; when you are about to write "which is better — A or B?".
---

# Flow — questions as a brief

Every question to the owner, every clarification, fork and point of confusion goes only through the `ask_decision` tool. A question in prose in your reply is forbidden: the owner re-reads the turn to understand what they are choosing from, and a short "let's take the second one" gets misread.

## How to ask

1. Gather everything that has piled up so far into **one** brief. Do not ask one question per turn.
2. `setup` holds no questions: show what there is and mark what you recommend. Work stages with state, links and executors, and "Done when" items — each in its own field; the widget sums the budget from the adds.
3. The second part, `questions`, holds only real questions: `fork`, `pick`, `confirm`.
4. Set `recommended: true` on what you would pick yourself. In `pick` and on stages several may be recommended, elsewhere at most one.
5. Call the tool and paste the `::decision{id="…"}` line from the result into your reply as a standalone line — no quotes or backticks, with a blank line before and after.
6. For `kind: "brief"`, end the turn right after the line. The answer arrives as a "Brief … — answer:" message, and any deviation from your recommendation is named in it plainly — do not argue with the choice, work by it.

The widget draws the brief top to bottom: questions, "Done when", stage buttons and the budget button. Anything so unclear that it cannot be phrased even as a criteria item is a question.

The answer comes in the owner's interface language, which the owner picks in the plugin settings (System follows the browser). With a Russian interface the same message reads "Бриф … — ответ:" with the sections «Этапы работ:», «Бюджет — …», «Готово, когда — …» and «Дальше — …»; the structure is the same.

## Criteria before the task

While there is no task yet, send its "Done when" as items in `setup.criteria` — the task stage is `state: "todo"` meanwhile. The owner removes an item with a cross, rewrites the text or adds an item of their own; the edits arrive in the answer as a line "Done when — removed item 3 "…"; rewrote item 1 — "…"; added item "…"".

## Work stages and stage kinds

The owner sets the work stages on the Flow page in the bb left menu, one table per flow. The order in the table is the stage order. A thread follows the flow the owner picked in the new-thread composer; a thread without a pick follows the default flow, the first in the list. In a thread with a flow, talk to the owner only through its stages; for anything the stages do not cover, send a `clarify` brief.

A stage has a kind. A **skill** stage has a skill, a name and who besides you may execute it (agents `agent:<name>` and workflows `workflow:<name>`); its skill is loaded when the run reaches the stage, exactly like a built-in one's — the stage's work lives in the skill, not in the stage name. Four **built-in** kinds have no executors, and each may stand in a flow any number of times, under ids like `select` and `select-2`. The work of a built-in stage lives in its skill — `flow-questions`, `flow-criteria`, `flow-stage-selection`, `flow-demo` by default, or the skill the owner set on the stage; the Flow instructions name it, load it when the run reaches the stage. The same skills work outside bb, where there is no `ask_decision`:

- **Questions** — ask the owner with `ask_decision` the questions that block the work.
- **Criteria** — agree "Done when" as `setup.criteria` before you create the task.
- **Stage selection** — send `setup.stages`: the owner picks which stages go into the run and who executes them, and sees the budget. Stages already passed are `done` and cannot be taken out.
- **Demo** — stop and send a brief with `outcome` for this stage: briefly show everything done since the previous demo (the first demo — since the flow started).

An **action** stage carries the same steps as an automation — Flow steps, scripts, Automations automations — but the owner runs them, one step per button press above the composer. Do not run it, do not mark it: when the next stage is an action stage, mark the stage before it done and end your turn. Flow marks the action stage itself and, when its last step passes, wakes you to carry on.

Questions, criteria and stage selection that stand next to each other go into **one** brief. A done built-in stage needs no `results`. The list of stages with ids and kinds comes in the Flow instructions for every turn; send all of them in `setup.stages`, in that order, otherwise the tool returns an error with the list. The tool no longer accepts the old `artifacts`, `executor`, `checker` and `testing`, nor the stage state `review`.

One brief per run. The owner's answer is consent to the stages they marked for the run, with the chosen executors: go through them in order without new briefs, and stop only on the demo stages in the run. The answer ends with a "Next — …" line that names the run and the demo stops. Decide implementation details yourself with the simple option and name them in the demo.

Answering a brief with a stage in the run **launches** the thread. From then on the tool accepts `setup.stages` only while a stage selection or criteria stage is still `todo` in them, and `setup.criteria` only while a criteria stage is `todo` — a later stage selection or criteria stage of the flow. Otherwise you send questions or a demo `outcome`; a brief without `setup.stages` in a launched thread shows no budget.

## Demo

`outcome` replaces the first part on a demo stage:

```json
{
  "title": "Demo — prototype",
  "outcome": {
    "stage": "demo", "final": false, "next": "Spec",
    "done": ["The dispatch cell sits left of Send", "The prototype switches every open fork"],
    "pending": [{ "text": "The outcome section", "why": "doing it next" }],
    "notes": "Segments clip the label on a narrow feed.\n\nThe light theme is checked on screenshots only.",
    "tasks": [{ "key": "BBPL-1", "done": true }, { "key": "BBPL-2", "done": false, "note": "another thread runs it" }],
    "results": [{ "label": "localhost:5173", "target": "http://localhost:5173/settings" }, { "label": "Desktop app", "command": "cd app && npm run tauri dev" }, { "label": "prototype.html", "target": "docs/assets/x/prototype.html" }]
  }
}
```

Flow measures the time a stage stood waiting for the owner — a failed automation step until the owner retries or skips it, an action stage between presses — and names it in the answer of `flow_stage` and in the reply it wakes you with. Carry that idle time into the flow report: a line per stage that stood, with its minutes, in the `notes` of the demo and in the report of the task. Stage minutes never include it, so without the line the hours a broken automation ate leave no trace.

`stage` is the id of a demo stage of the flow, `final` says whether this is the last demo of the work, `next` names the stage after it (only when `final` is false). `done` and `pending` cover every stage since the previous demo — the first demo covers the whole flow so far, including the answers to questions and the stage selection. `notes` is what else the owner should know, split into paragraphs with a blank line. `tasks` are the task keys with their state, `results` are links to every result, at least one. A result is `{ label, target }` — a file, a path or a page URL — or `{ label, command }` — a launch command the card shows as a command block with a "Run in terminal" button. The widget draws a card with the comment field attached. The owner either continues or sends a comment. A comment does not accept the demo: it stays open and the flow does not go further — answer the comment, rework what it asks for, and send the demo again; only "Continue" on a demo moves the flow on. An answer that leaves no agent stage in the run does not reach you at all — the work is over, the stages close and the automations behind them run without you; a comment or an image in the answer reaches you as usual.

### Live result

The owner judges the work by seeing it run, not by reading about it. When code changed since the previous demo, the demo carries at least one live result — an http(s) page URL or a `command` — otherwise the tool rejects it:

- **Web** — a bug fix, a feature, a refactoring of anything that runs in a browser. Start the dev server or a preview in the background, run `bb connect status --json`: when paired, `bb connect expose <port>` prints the share URL — give that; otherwise give `http://localhost:<port>` and say so in `notes`. Link straight to the page where the change is visible, with the query or route that puts it in the right state.
- **Desktop** — build the app from this working tree and give `{ label, command }` that starts that build, e.g. `open -a /path/to/Build.app` or `npm run tauri dev`. One click on "Run in terminal" has to be enough: no manual steps before it.
- **Check before sending** — request every page URL and send the demo only when it responds with 200; a command you have run once yourself.
- **A bug** — put in `notes` the steps on the live result that showed the bug before and show it is gone now.
- **Only documents** — a spec, a plan, a task, a prototype file with nothing to run: set `documentsOnly: true`; the card says there is no live link.
- **After the answer** — the owner continues or sends a comment: stop the servers and apps you started for the demo and run `bb connect unexpose <port>`. The demo you send again after a comment starts them again.

## Where the work runs

Under the brief, left of "Send" — and left of "Continue" on a demo — the owner picks where the work runs: in this thread or in a new thread of the same working tree and branch. The new thread is a sibling of this one, not its child, like bb's own handoff: it receives your answer as its first message, with a mention of this thread — and this thread stops there.

Another new brief only if something in the answer is really unclear: an item contains a question, the edits contradict each other or the rest of the brief, or it is unclear how to proceed. Such a brief is only about what is unclear; do not re-ask what was accepted.

## First part — `setup`

| Field | What it is | What is required |
| ---- | ----- | --------- |
| `stages` | Work stages of the thread's flow — all of them, in their order | A stage has the `id` from the flow and `state`: `todo` — not done, `done` — done. A done skill stage has `results: [{ label, target }]`; built-in stages and `todo` ones have none. `label` is the file name from `target` (with or without the extension, e.g. `spec.md`) or a task key like `BP-28`, not a document title; `target` is a path from the worktree root, an absolute path (for example in the thread storage) or a URL. `recommended: true` — you recommend taking a `todo` stage into the next run. `executor` — `self` or the id of a stage executor from the settings. `add` — the stage's add when you execute it yourself; `adds` — the difference of each executor by its id |
| `criteria` | "Done when" — one checkable statement per item | At least one item: a string or `{ "text", "add" }`; an item that changes something existing is `{ "text", "before", "after", "add" }` — the widget draws "before" and "after", and the owner edits only "after" |
| `artifacts`, `executor`, `checker`, `testing`, `budgetTarget`, `budgetMax` | Fields of old briefs | Do not send: stages replaced documents, executor, review and testing, and the "Budget" button sums the forecast from the `add` values |

**The `add`** is `{ "target", "max", "risk", "minutes" }`: how much a stage, item or option adds to the budget in dollars, as target and ceiling, to risk as an integer and to time in whole minutes. One work has one price: the price of the work is on the stages. An item's `add` is its share inside the stages, not on top of them — it does not raise the budget, and an item the owner removes subtracts its share from the stages in the run. An option's `add` is its difference from the recommended option: the recommended one is usually zero. Every part goes both ways: a third-party reviewer lowers risk, a workflow may save time. Saving money is negative numbers, `max` is not below `target`: saving $2 to $4 is `{ "target": -4, "max": -2 }`. For a stage executor, the add in `adds` is **the difference from executing the stage yourself**.

**The risk of a stage** is how the stage changes the risk of the whole work, not how much can break inside the stage itself. 1r ≈ 10% chance that a blocking defect reaches the owner. Only implementation raises it; spec, plan, prototype, review and testing lower it; questions, criteria, stage selection, demos, automations and action stages are 0. A check with a plus makes skipping checks look safer — never send one. The scale:

| Stage | Risk | What the number rests on |
| --- | --- | --- |
| Implementation | xs +1, s +3, m +5, l +6 | Measured: the first review found blocking defects in 43 of 83 done tasks with a verdict — s 3 of 10, m 17 of 33, l 22 of 37. xs has no reviewed tasks, +1 is an estimate |
| Review by another agent | About minus what implementation added (m −5, l −6) | Measured as the same numbers: those defects were caught by the review, not by the owner. Review yourself is half of it — not measured |
| Testing, tests before code | −1 to −2 | Estimate, not measured |
| Spec | −1 | Estimate, not measured: tasks with a spec failed the first review in 7 of 15, without one in 36 of 68 — the gap is within noise. A spec mostly saves a wrong direction, which the review verdict does not count |
| Plan | −1 | Estimate, not measured: all 6 tasks with a plan still failed the first review — a plan does not replace review |
| Prototype | −1 when the look is not obvious, otherwise 0 | Estimate, not measured |

For a change that is smaller or larger than its estimate, move along the scale and say why in the intro. Recount the measured lines from `docs/tasks/done/` when the history grows: tasks with `SATISFIED` in their comments, the share with `NOT SATISFIED` by `estimate`.

The widget writes an add small as "+$2–4 –2r +20 min" (a part with no change is omitted; plus risk is red, minus green) on the stage button — for the chosen executor — and next to the executors in the expanded list, and sums the run stages minus the shares of removed items and the chosen options into the "Budget · target · up to ceiling" button — never below zero; what is already spent on the thread is not in the total — with a breakdown by columns time, risk, target, ceiling. The button's second line is the planned work time. The answer carries a line "Budget — forecast $18 · up to $31, risk +2, time +40 min" or "Budget — own price $25 · up to $40 (forecast …)". The plugin adds the time already spent on planning itself as the first breakdown line marked "already spent", for reference only; do not send it.

The widget draws the labels. Your recommendation is preselected on the stage button — in the run or not, and the executor — and the owner changes only what they disagree with; they see the ✦ of a recommendation in the expanded list. If in the previous answered brief of the thread the owner picked a stage's executor themselves, the plugin puts that carried choice in place of your recommendation. Recommend as usual.

## Second part — `questions`

| `kind` | When | What is required |
| --- | --- | --- |
| `fork` | A fork: two or more ways, the choice changes the outcome, one answer | Every option has a `description` — a paragraph about what happens and the risks in prose — and an `add`. The old `cost` (up to 40 characters) and `risk` `XS`…`XXL` pair is accepted only on an option without `add` |
| `pick` | Several answers from a set: which edits to make, what to do after approval | Every option has a `description`; `add` — if the option changes the budget or risk |
| `confirm` | "Did I get this right" | Exactly one "Yes" option; `context` says what exactly you understood. The owner writes disagreement as their own answer |
| `yesno` | Only in a `clarify` brief: a clarification you can continue without | Exactly two options, "Yes" and "No"; a clarification has no `setup` |

Mark a question that only matters for one of the answers to another question with the option field `hides` — an array of `id`s of questions of the same brief, placed below, that lose their meaning with this choice: you cannot hide a question above or the option's own question. The owner does not see hidden questions, does not answer them, and they are not in the answer; the owner does not see the mark either.

Put "Done when" items that only matter for one answer in criteria on an option — an array of strings: they stand in the "Done when" list while the option is chosen, and an item of an option the owner drops themselves stays in the list struck through until the brief is answered, so the owner sees what their refusal took away. An option the owner never touched shows nothing. The answer names the live ones as items of the chosen options and the struck ones as dropped, so an item that depends on one answer goes on the option, not into setup.criteria — that way the list settles itself and nobody edits it twice. Do not repeat them in `setup.criteria` or price them twice. An option that makes items of `setup.criteria` pointless — "look first", "postpone" — lists their indexes from zero in `removes`: the widget strikes them out while the option is chosen and brings them back when it is not, and the answer names them as removed. Do not count those items in the option's `add`: the plugin subtracts the shares of the items in removes itself.

The owner can answer any question in their own words. A question id does not start with `setup.`. Do not save on text length: the wording, description and price are shown in full.

## Example brief

```json
{
  "title": "CEL-115 — tree in DevShell",
  "intro": "The CEL-114 spec is approved, the CEL-114 code is not merged yet.",
  "kind": "brief",
  "setup": {
    "stages": [
      { "id": "questions", "state": "todo" },
      { "id": "criteria", "state": "todo" },
      { "id": "select", "state": "todo" },
      { "id": "task", "state": "done", "results": [{ "label": "CEL-115", "target": "docs/tasks/in_progress/cel-115.md" }] },
      { "id": "prototype", "state": "done", "results": [{ "label": "prototype.html", "target": "docs/assets/cel-115/prototype.html" }] },
      { "id": "demo", "state": "done" },
      { "id": "spec", "state": "todo", "recommended": true, "add": { "target": 4, "max": 7, "risk": -1, "minutes": 20 } },
      { "id": "plan", "state": "todo", "recommended": true, "executor": "agent:planner", "add": { "target": 3, "max": 5, "risk": -1, "minutes": 15 }, "adds": { "agent:planner": { "target": 2, "max": 4, "risk": -1, "minutes": -5 } } },
      { "id": "implement", "state": "todo", "recommended": true, "add": { "target": 10, "max": 18, "risk": 5, "minutes": 60 } },
      { "id": "review", "state": "todo", "recommended": true, "executor": "agent:reviewer", "adds": { "agent:reviewer": { "target": 3, "max": 5, "risk": -5, "minutes": 15 } } },
      { "id": "testing", "state": "todo", "recommended": true, "add": { "target": 1, "max": 3, "risk": -2, "minutes": 20 } },
      { "id": "demo-2", "state": "todo", "recommended": true, "add": { "target": 1, "max": 2, "risk": 0, "minutes": 5 } }
    ],
    "criteria": [
      { "text": "The DevShell tree is built from the inheritanceStates of the CEL-114 spec", "add": { "target": 4, "max": 7, "risk": 2 } },
      { "text": "A tree row shows depth and object", "before": "A row is only the object name", "after": "Indent by depth and the object name", "add": { "target": 2, "max": 3, "risk": 1 } },
      "Tree layout tests are green"
    ]
  },
  "questions": [
    {
      "id": "when", "kind": "fork", "question": "What should CEL-115 build on, and when to implement it?",
      "context": "The CEL-115 spec relies on inheritanceStates from the CEL-114 spec.",
      "options": [
        { "id": "now", "action": "Spec now, code after CEL-114", "recommended": true,
          "description": "I write the spec on the CEL-111 branch and start the code once CEL-114 is merged. Risk: the spec needs fixing if CEL-114 changes in review.",
          "add": { "target": 2, "max": 4, "risk": 1 } },
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
      "context": "The plus that creates something new sits only in the first row — as in the prototype.",
      "options": [{ "id": "yes", "action": "Yes", "recommended": true }]
    }
  ]
}
```

The stages in the example are the default flow: questions, criteria, stage selection, task, HTML prototype, demo, spec, plan, implementation, review, testing and a second demo — the brief comes before the run, so questions, criteria and stage selection go together; the owner added the `agent:planner` executor to the plan and `agent:reviewer` to the review. The owner's stages may differ — take them from the instructions for the turn.

## Example clarification

A clarification does not stop the work: you continue on your own understanding, and the answer, if the owner gives one, arrives along the way.

```json
{
  "title": "Light theme",
  "kind": "clarify",
  "questions": [
    {
      "id": "light", "kind": "yesno", "question": "Take the screenshots in the light theme too?",
      "options": [
        { "id": "yes", "action": "Yes", "recommended": true },
        { "id": "no", "action": "No" }
      ]
    }
  ]
}
```

After the call, paste the directive line into your reply, write briefly what understanding you continue on, and continue.
