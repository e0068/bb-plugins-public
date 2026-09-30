---
name: flow-stage-selection
description: The Stage selection stage — show the owner all stages of the work, mark the done ones, recommend which to take into the run and who executes them — yourself, a subagent, a pipeline, a workflow — and let them see the budget. The executor rule is whether the boundary between agents pays off. In bb — setup.stages of an ask_decision brief; in plain Claude Code — a multi-select AskUserQuestion. Use it on the Stage selection stage of a Flow, before work with more than one step, and when you wonder "hand it to a subagent or do it myself". Этап Выбор этапов — какие этапы в прогон, кто исполняет, бюджет.
---

# Stage selection

If the owner writes in Russian, read [ru.md](ru.md) in this folder instead — it is the same skill in Russian; otherwise follow this file.

The owner decides which stages go into the run, who executes them and what it costs. You show everything there is and recommend. Priorities of a recommendation, in descending order: leave no problems, save money, save time.

## Where the stages come from

**In bb.** The stages and their executors are listed in the turn instructions, in flow order. Send all of them, skipping none and reordering none. A thread created with "Automatic" first gets a flow: the agent picks it by the flow descriptions in the turn instructions.

**In Claude Code.** There is no list of flows and no flow-choosing tool here — stages by the owner's work steps: task, prototype, spec, plan, implementation, review, testing, demo.

A step this task does not need is shown as not recommended rather than dropped. A task is always needed, except for a three-line edit without risk; a prototype — when it is not obvious how the thing will look; a spec — when logical nodes change: a part, a dependency or a seam appears or disappears; a plan — when someone other than you executes the work.

## What to say about each stage

- State: done — with links to the result; not done — with a recommendation to take it or not.
- Executor: yourself or one of the stage's executors — an agent, a workflow. Recommend the one that pays off, by the rule below.
- Cost: forecast dollars and ceiling, risk, minutes. A stage's cost comes from the history of similar tasks; no history — say the figure is rough.

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
| Work in several "done — checked — fixed" cycles, even as one group | A pipeline: implementation → review → run. Context isolation and a model per role pay for the boundary without any parallelism |
| Work that splits into groups not overlapping by files | The same pipeline, groups in parallel. Parallelism speeds it up, but it is not what makes the pipeline pay |

The subject of the work does not set the method. "This is logic programming, so it needs a pipeline" is wrong: a pipeline pays for volume and number of cycles, not for the subject.

**Workflow.** A pipeline is chosen — check whether a ready one is among the stage's executors or in `~/.claude/workflows/`. There is — name it to the owner and say what it consists of. There is not — two options with an estimate: build a new one, or run the same stages by hand, calling subagents one by one. Manual stages give the same gain from isolation and models; a workflow adds repeatability, parallel groups and resuming from the middle. On one group in two or three cycles the difference is small — do not start a workflow for the sake of a workflow.

**Skills and permissions — before launch.** Before recommending an executor, name the skills its work needs and check that the files are in place; a writing subagent needs its own worktree, a reading one does not; one that goes to the network needs to run outside the sandbox. A skill is missing — tell the owner which one and what will be worse without it, and offer three ways out: work without it, wait, create it as a separate task. You do not choose yourself.

## How to ask

**In bb.** Stages go into `setup.stages` of the same `ask_decision` brief as Questions and Criteria: `id`, `state`, `results` on a done skill stage, `recommended`, `executor`, `add` — the cost with the "self" executor, `adds` — only for the agents and workflows among the stage's executors. The widget sums the budget itself. The format is in the Flow plugin instructions and the tool description.

**In Claude Code.** Done stages as a line in the reply with links. Then a `multiSelect: true` question "Which stages to take into the run?": recommended stages first with "(Recommended)", cost and minutes in the description; the total of the recommended set in the question text. More than four options — group stages in order: "Spec and plan", "Implementation and review". Where a stage has a choice of executor — a second question "Who executes <stage>?" with the cost difference for each option.

No AskUserQuestion — a table of stages in the reply — stage, state, recommendation, executor, cost — with a request to answer, and the turn ends.

## After the answer

Go through the chosen stages in flow order. On a Demo stage, stop and show what was done. The rest — to the end without new questions, unless it became unclear how to proceed. A choice of the owner that differs from the recommendation is not argued; name its cost in the report in one line if it changed.
