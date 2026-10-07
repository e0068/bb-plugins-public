---
name: flow-stage-selection
description: The Stage selection stage — show the owner all stages of the work, mark the done ones, recommend which to take into the run and who executes them — yourself, a subagent, a pipeline, a workflow — and let them see the budget. The executor rule is whether the boundary between agents pays off. In bb — setup.stages of an ask_decision brief; in plain Claude Code — a multi-select AskUserQuestion. Use it on the Stage selection stage of a Flow, before work with more than one step, and when you wonder "hand it to a subagent or do it myself". Этап Выбор этапов — какие этапы в прогон, кто исполняет, бюджет.
---

# Stage selection

If the owner writes in Russian, read [ru.md](ru.md) in this folder instead — it is the same skill in Russian; otherwise follow this file.

The owner decides which stages go into the run, who executes them and what it costs. You show everything there is and recommend. Priorities of a recommendation, in descending order: leave no problems, save money, save time.

## Where the stages come from

**In bb.** The stages and their executors are listed in the turn instructions, in flow order. Send all of them, skipping none and reordering none. A thread created with "Automatic" first gets a flow: the agent picks it by the flow descriptions in the turn instructions.

**In Claude Code.** There is no list of flows and no flow-choosing tool here — stages by the owner's work steps: task, prototype, spec, plan, implementation, testing, review, demo. Testing goes before review: a run is cheap, and a review on a red base is not taken.

A step this task does not need is shown as not recommended rather than dropped. A task is always needed, except for a three-line edit without risk; a prototype — when it is not obvious how the thing will look; a spec — when logical nodes change: a part, a dependency or a seam appears or disappears; a plan — when someone other than you executes the work.

## What to say about each stage

- State: done — with links to the result; not done — with a recommendation to take it or not.
- Executor: yourself or one of the stage's executors — an agent, a workflow. Recommend the one that pays off, by the rule below.
- Cost: the stage's part of the scope in percent and its risk, a multiplier for an executor. A stage's part comes from the history of similar tasks; no history — say the figure is rough. The part is only the work beyond the Definition of Done items: checks already priced into an item are not counted again.

## Who executes — does the boundary pay off

A boundary between agents has a fixed price: the executor rereads the files and gets into the task anew. What it returns grows with the amount of work behind the boundary. The question is always the same: **is the work behind the boundary bigger than getting into it?** Bigger — hand it off. Smaller — do it yourself.

Three sources of gain, each working on its own; the more of them coincide, the sooner the boundary pays off:

1. **Context isolation.** The main agent pays for the whole prefix on every turn: twenty turns in, it has paid twenty times for the analysis done at the start. A subagent starts from a clean slate and holds only its own assignment.
2. **A model per role.** Implementation on Sonnet, review on read-only Opus, test runs on Haiku. The main agent on an expensive model pays its rate for everything, file reads and test runs included.
3. **Independent checking.** The checker did not see how the code was written, so it checks the result, not the intent. This is not a saving but a requirement: on any edit where you or a subagent made the decision, the result is checked by someone other than the author.

| What the work is | What executes it |
| --- | --- |
| An edit in one place; answering a question; reading and scouting a couple of files | Yourself. Explaining costs more than doing |
| A wide search across the repository where a conclusion is needed, not file dumps | One read-only scout subagent, one interaction |
| Work across several files, but in one go, without cycles | Yourself; review and acceptance by a separate checker |
| Work in several "done — checked — fixed" cycles, even as one group | A pipeline: implementation → run → review; a red run returns to implementation before reaching the review. Context isolation and a model per role pay for the boundary without any parallelism |
| Work that splits into groups not overlapping by files | The same pipeline, groups in parallel. Parallelism speeds it up, but it is not what makes the pipeline pay |

The subject of the work does not set the method. "This is logic programming, so it needs a pipeline" is wrong: a pipeline pays for volume and number of cycles, not for the subject.

**Workflow.** A pipeline is chosen — check whether a ready one is among the stage's executors or in `~/.claude/workflows/`. There is — name it to the owner and say what it consists of. There is not — two options with an estimate: build a new one, or run the same stages by hand, calling subagents one by one. Manual stages give the same gain from isolation and models; a workflow adds repeatability, parallel groups and resuming from the middle. On one group in two or three cycles the difference is small — do not start a workflow for the sake of a workflow.

**Skills and permissions — before launch.** Before recommending an executor, name the skills its work needs and check that the files are in place; a writing subagent needs its own worktree, a reading one does not; one that goes to the network needs to run outside the sandbox. A skill is missing — tell the owner which one and what will be worse without it, and offer three ways out: work without it, wait, create it as a separate task. You do not choose yourself.

## How to ask

**In bb.** Stages go into `setup.stages` of the same `ask_decision` brief as Questions and Definition of Done — all stages of the flow, in its order, with the ids from the turn instructions:

| Field | What it is |
| --- | --- |
| `id`, `state` | The stage id from the flow; `todo` — not done, `done` — done. Stages already passed are `done` and cannot be taken out |
| `results` | Only on a done skill stage: `[{ label, target }]`. `label` is the file name from `target` (with or without the extension, e.g. `spec.md`) or a task key like `BP-28`, not a document title; `target` is a path from the worktree root, an absolute path or a URL. Built-in and `todo` stages have none |
| `recommended` | `true` — you recommend taking a `todo` stage into the run |
| `executor` | `self` or the id of one of the stage's executors from the turn instructions |
| `share` | `{ percent, risk }` on every `todo` skill stage: its part of the scope and how it changes the risk |
| `factors` | `{ <executor id>: { factor, risk } }` — the multiplier and risk of each executor of the stage |

No `add` or `adds` on a stage, and none of the fields of old briefs — `artifacts`, `executor` and `checker` objects, `testing`, `budgetTarget`, `budgetMax`, the state `review`: stages replaced them, and the "Budget" button sums the forecast itself.

**A stage is a part of the scope.** `share.percent` is how much the stage costs beyond the Definition of Done items — the checks already priced into an item are not counted again: the stage that does the work itself is 100, a spec around 15, a review around 20, a task or a demo around 5. An executor in `factors` multiplies the stage's part: a subagent on a cheaper model below 1, a workflow with extra checks above 1 — always above zero; you yourself are 1. The plugin counts dollars and minutes: the scope — the Definition of Done items, priced by `flow-criteria` — counts once, and a stage in the run adds scope × percent × factor on top. The stage of the work itself is that scope: by you it adds nothing, by another executor only (factor − 1) × scope. The tool refuses a brief before launch with a `todo` skill stage without `share` or with a $0 / 0 min forecast. The whole forecast lands in the band of done tasks of the same estimate (the anchor is in `flow-criteria`); a forecast above it needs a reason named in the intro.

**The risk of a stage** is how the stage changes the risk of the whole work, not how much can break inside the stage itself. 1r ≈ 10% chance that a blocking defect reaches the owner. Only implementation raises it, and its risk goes on the Definition of Done items, spread across them — the stage of the work itself sends `share.risk` 0, the plugin does not count it; spec, plan, prototype, review and testing lower it; questions, Definition of Done, stage selection, demos, automations and action stages are 0. A check with a plus makes skipping checks look safer — never send one. The scale:

| Stage | Risk | What the number rests on |
| --- | --- | --- |
| Implementation, summed over the items | xs +1, s +3, m +5, l +6 | Measured: the first review found blocking defects in 43 of 83 done tasks with a verdict — s 3 of 10, m 17 of 33, l 22 of 37. xs has no reviewed tasks, +1 is an estimate |
| Review by another agent | About minus what implementation added (m −5, l −6) | Measured as the same numbers: those defects were caught by the review, not by the owner. Review yourself is half of it — not measured |
| Testing, tests before code | −1 to −2 | Estimate, not measured |
| Spec | −1 | Estimate, not measured: tasks with a spec failed the first review in 7 of 15, without one in 36 of 68 — the gap is within noise. A spec mostly saves a wrong direction, which the review verdict does not count |
| Plan | −1 | Estimate, not measured: all 6 tasks with a plan still failed the first review — a plan does not replace review |
| Prototype | −1 when the look is not obvious, otherwise 0 | Estimate, not measured |

For a change that is smaller or larger than its estimate, move along the scale and say why in the intro. Recount the measured lines from `docs/tasks/done/` when the history grows: tasks with `SATISFIED` in their comments, the share with `NOT SATISFIED` by `estimate`.

**What the owner sees.** The widget writes a price small as "+$2–4 –2r +20 min" (a part with no change is omitted; plus risk is red, minus green) next to the base of "Definition of Done", on the stage button — for the chosen executor — and next to the executors in the expanded list as the difference from you, and sums the run stages into the "Budget · target · up to ceiling" button — never below zero; what is already spent on the thread is not in the total — with a breakdown by columns time, risk, target, ceiling. The button's second line is the planned work time. The answer carries a line "Budget — forecast $18 · up to $31, risk +2, time +40 min" or "Budget — own price $25 · up to $40 (forecast …)". The plugin adds the time already spent on planning itself as the first breakdown line marked "already spent", for reference only; do not send it. Your recommendation is preselected on the stage button — in the run or not, and the executor — and the owner changes only what they disagree with; they see the ✦ of a recommendation in the expanded list. If in the previous answered brief of the thread the owner picked a stage's executor themselves, the plugin puts that carried choice in place of your recommendation. Recommend as usual.

After launch the tool accepts `setup.stages` only while a stage selection or Definition of Done stage is still `todo`; a brief without `setup.stages` in a launched thread shows no budget.

```json
{
  "title": "CEL-115 — tree in DevShell",
  "kind": "brief",
  "setup": {
    "stages": [
      { "id": "questions", "state": "todo" },
      { "id": "criteria", "state": "todo" },
      { "id": "select", "state": "todo" },
      { "id": "task", "state": "done", "results": [{ "label": "CEL-115", "target": "docs/tasks/in_progress/cel-115.md" }] },
      { "id": "prototype", "state": "done", "results": [{ "label": "prototype.html", "target": "docs/assets/cel-115/prototype.html" }] },
      { "id": "demo", "state": "done" },
      { "id": "spec", "state": "todo", "recommended": true, "share": { "percent": 15, "risk": -1 } },
      { "id": "plan", "state": "todo", "recommended": true, "executor": "agent:planner", "share": { "percent": 10, "risk": -1 }, "factors": { "agent:planner": { "factor": 0.8, "risk": 0 } } },
      { "id": "implement", "state": "todo", "recommended": true, "share": { "percent": 100, "risk": 0 } },
      { "id": "review", "state": "todo", "recommended": true, "executor": "agent:reviewer", "share": { "percent": 20, "risk": -2 }, "factors": { "agent:reviewer": { "factor": 1.2, "risk": -3 } } },
      { "id": "testing", "state": "todo", "recommended": true, "share": { "percent": 5, "risk": -2 } },
      { "id": "demo-2", "state": "todo", "recommended": true }
    ]
  }
}
```

The stages are a full flow: questions, Definition of Done, stage selection, task, HTML prototype, demo, spec, plan, implementation, review, testing and a second demo — the owner added the `agent:planner` executor to the plan and `agent:reviewer` to the review. On the 17-minute scope of the `flow-criteria` example with its recommended fork answer, the run stages add 17 × (0.15 + 0.10 × 0.8 + 0.20 × 1.2 + 0.05) ≈ 9 minutes. The order is that owner's flow, not a recommendation; the owner's stages may differ — take them from the instructions for the turn.

**In Claude Code.** Done stages as a line in the reply with links. Then a `multiSelect: true` question "Which stages to take into the run?": recommended stages first with "(Recommended)", cost and minutes in the description; the total of the recommended set in the question text. More than four options — group stages in order: "Spec and plan", "Implementation and review". Where a stage has a choice of executor — a second question "Who executes <stage>?" with the cost difference for each option.

No AskUserQuestion — a table of stages in the reply — stage, state, recommendation, executor, cost — with a request to answer, and the turn ends.

## After the answer

Go through the chosen stages in flow order. On a Demo stage, stop and show what was done. The rest — to the end without new questions, unless it became unclear how to proceed. A choice of the owner that differs from the recommendation is not argued; name its cost in the report in one line if it changed.
