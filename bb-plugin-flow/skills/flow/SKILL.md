---
name: flow
description: How to work by Flow in bb — go through the stages of the thread's flow in order, talk to the owner only through ask_decision briefs, mark stages with flow_stage, let automations and action stages run, rework after a comment on an approval, and know where the data of the run is kept and where to look. The format of each part of a brief lives in the skill of its stage — flow-questions, flow-criteria, flow-stage-selection, flow-demo. Use it whenever a thread follows a flow, whenever you have a question, a clarification, a fork or a point of confusion for the owner, and when you are about to write "which is better — A or B?".
---

# Flow — working through a flow

A thread follows a flow: an ordered list of stages the owner set up on the Flow page in the bb left menu. You go through the stages in order and talk to the owner only through them. This skill says how to go through a flow; how to do a stage and fill its part of the brief is in the skill of that stage.

## Questions only as a brief

Every question to the owner, every clarification, fork and point of confusion goes only through the `ask_decision` tool. A question in prose in your reply is forbidden: the owner re-reads the turn to understand what they are choosing from, and a short "let's take the second one" gets misread.

Ask the moment the question arises, and decide yourself whether to stop. If you can go on without the answer — on the simplest option, named in a line — send `clarify` and keep working; if the work cannot go on without it, send `brief` and wait. There are two kinds:

- **`brief`** — gather everything that has piled up into one brief, do not ask one question per turn. After the call, paste the `::decision{id="…"}` line from the result into your reply as a standalone line — no quotes or backticks, with a blank line before and after — and do what the result says. Around the line write at most one sentence: the owner already sees the brief, do not retell it. In a thread with a flow only an approval stops you: questions, Definition of Done and stage selection do not hold the run — you go on by the recommended values, and the owner's answers, edits and comments arrive together with the next approval. With no approval ahead in the flow, the recommended values are your decision: formulate the items and pick the stages from the history of similar tasks, and go on.
- **`clarify`** — any question (`fork`, `pick`, `confirm`, `yesno`) with no `setup`, no prices and no outcome: a question you can continue without. Paste the directive line, write briefly what understanding you continue on, and continue; the answer arrives along the way. When the turn ends, paste the line once more in the final reply of the turn: bb folds replies between tool calls under "Worked for", and the card moves to the last copy of its line, so it stays in sight after the turn. Never repeat the line of a widget from an earlier turn — its card would move there. A clarify you fixed or decided yourself before the owner answered — close it with `resolves: ["dec_…"]` (the ids from its directive lines) in your next `ask_decision` call, of any kind: the widget collapses into a "Resolved: …" line without answer buttons. A clarify the owner has already answered cannot be closed this way.

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

Mark `recommended: true` on what you would pick yourself. Every text field takes markdown links; anything that lives in a file is named as a link to it.

**The answer** arrives as a message in the owner's interface language, which the owner picks in the plugin settings (System follows the browser). Its heading names the kind: "Answers to the questions "…":" (Russian «Ответы на вопросы «…»:»), "Demo "…" — continue." («Демонстрация «…» — продолжить.»), "Comments on the demo "…" — the … stage:" («Комментарии к демонстрации «…» — этап …:»), "Approval "…" — approved." («Утверждение «…» — утверждено.») and "Changes to the approval "…":" («Правки к утверждению «…»:»). It holds only the owner's answer: the questions with the chosen options, a "Run:" line with the run stages in order (an executor is named only when it is not you), an "Off the recommendation:" line when the owner changed it, the budget and "Definition of Done" («Прогон:», «Не по рекомендации:», «Бюджет — …», «Definition of Done — …»). A deviation from your recommendation is named plainly — do not argue with the choice, work by it. A flow the owner picked with the Flow button moves the thread there: the answer says so, and the stages of the new flow are in the turn instructions.

A chat message from the owner while your brief waits returns the brief to you: the message outranks the brief. Take it in and send the brief again, revised.

## Rules to memory and skills

When the owner states a working rule — "always …", "never …", "from now on …" — or you are about to save feedback to memory or a skill, do not write the file yourself: propose it with `propose_rule`, one rule per call. Search memory and skills for similar places first and pass them in `similar`, marking `same: true` where it already says the same. `content` is exactly what gets written — a whole new file (`mode: "create"`), the text appended to the end (`"append"`) or the text that takes the place of `replaces`, an exact fragment of the file found there once (`"replace"`) — and holds the rule `text` verbatim, because the owner may edit the rule before writing — a `content` without it gets `text` appended at its end, an omitted one is `text` alone; a new memory file also gets its `index` line for `MEMORY.md`. When a similar place contradicts the rule or the rule rewrites it, replace that place instead of appending next to it: the owner sees the removed lines with a minus and the new ones with a plus. Paste the directive line and keep working: on "Write" the plugin writes the file itself and the outcome arrives as a message — written, not written, or the file changed after the proposal, then reread it and propose again.

## Stages and their skills

The stages with ids, kinds, skills and executors come in the Flow instructions for every turn — read them there, not from memory. A thread follows the flow the owner picked in the new-thread composer; a thread without a pick follows the default flow, the first in the list; a thread created with "Automatic" gets its flow before its first turn — a model picks it by the flow descriptions, and the message waits in the queue meanwhile. In a thread with a flow, talk to the owner only through its stages; for anything the stages do not cover, send a `clarify` brief.

| Kind | What it is | Who does it |
| --- | --- | --- |
| **Built-in** | A stage that is a part of a brief. It has no executors and may stand in a flow any number of times, under ids like `select` and `select-2` | You, by its skill — the default one below or the skill the owner set on the stage |
| **Skill** | Work by a skill: a spec, a plan, the implementation, a review | You or one of its executors — an agent `agent:<name>` or a workflow `workflow:<name>` — by the stage's skill |
| **Automation** | Flow steps, scripts, Automations automations | Flow, by itself |
| **Action** | The same steps as an automation, one per button press above the composer | The owner |

The four built-in stages and the part of the brief each one fills:

| Stage | Default skill | Part of the brief |
| --- | --- | --- |
| Questions | `flow-questions` | `questions` — forks, picks, "did I get this right" |
| Definition of Done | `flow-criteria` | `scope` and `setup.criteria` — the items with their price |
| Stage selection | `flow-stage-selection` | `setup.stages` — the run, executors, shares, the budget |
| Demo | `flow-demo` | `outcome` instead of `setup` |

Load the skill of a stage when the run reaches it: the format of its part, its examples and its pricing are there, not here. The same skills work outside bb, where there is no `ask_decision`.

## Going through the flow

1. **Built-in stages that stand next to each other go into one brief.** Questions, Definition of Done and stage selection before the work are one brief, not three — load all their skills before you send it. `setup.stages` lists every stage of the flow, in the flow's order; otherwise the tool returns an error with the list.
2. **The answer launches the run.** Answering a brief with a stage in the run is the owner's consent to the stages they marked, with the chosen executors. Go through them in order without new briefs; decide implementation details yourself with the simple option and name them in the demo. The answer ends with a "Next — …" line that names the run and the approval stops. From then on new forks, criteria and stage choices go into a brief only by step 7; the tool refuses them otherwise.
3. **Mark skill stages.** Call `flow_stage` with `started` before the first action of a skill stage, and with `done` and `results` — `[{ label, target }]`, the file name or task key as label — when it is finished. Built-in stages are marked by the briefs themselves: you mark one only to roll back to it.
4. **Automations run by themselves.** An automation stage Flow runs once the nearest stage of the run before it is marked done; marking that stage waits until Flow has run it. The answer of `flow_stage` says whether it started and, if not, why and what to do: tell the owner only what that answer says, never that an automation runs when the answer says it did not start. When the answer hands you Flow's message, act on it in the same turn; when it says to end your turn, end it.
5. **Action stages are the owner's.** When the next stage is an action stage, mark the stage before it done and end your turn. Flow marks the action stage itself and wakes you when its last step passes.
6. **A demo stage does not stop you; an approval stage does.** Show every widget the moment the run reaches it — the demo when its stage comes, the question when it arises — and never lean on a widget you did not send: an approval has no card, only a comment field (and `outcome.nextFlow`, the flow you recommend for problems you found, which only an approval carries), so the owner judges it by the widgets right above it, and the tool refuses an approval while a demo stage before it has not been sent. On a demo stage send a brief carrying its `outcome`, by `flow-demo`, and go on to the next stage in the same turn: sending closes the stage. The demo widget has no buttons; when an approval stands ahead it has a comment field that goes with that approval, otherwise the owner comments in the chat; a change that asks for is rework by step 7 — go through the stages again in order up to the demo and send it again; a comment without a change — answer it and carry on. On an approval stage send its brief, by `flow-approve`, and end the turn: its answer carries the owner's answers, edits and comments on every widget since the previous approval. "Continue" moves the flow on; comments on the widgets come as a checklist — do each item, mark it with `flow_checklist`, and only then start the next stage, with no new approval; an unclear item is a question — go back to the Questions stage. A comment on the approval itself ("Send comments") is rework: show the widgets again, reworked.
7. **Rolling back** — mark the stage `started` with `flow_stage`; what that does to the stages after it is in the tool's instructions. A comment with a change — on an approval or in the chat — rolls back to the stage of the change. A new fork, criterion or stage choice after launch rolls back to Definition of Done and goes into one brief with it and the stage selection; do not re-ask what was accepted.

An answer that leaves no agent stage in the run does not reach you at all — the work is over, the stages close and the automations behind them run without you; a comment or an image in the answer reaches you as usual.

**Idle time.** Flow measures the time a stage stood waiting for the owner — a failed automation step until the owner retries or skips it, an action stage between presses — and shows it to the owner in the run summary. Stage minutes never include it. It helps the owner decide nothing, so it is not yours to report: not in the demo `notes`, not in the task report.

## Where the work runs

Under the brief, left of "Send" — and left of "Continue" on an approval — the owner picks where the work runs: in this thread or in a new thread of the same working tree and branch. The new thread is a sibling of this one, not its child, like bb's own handoff: it receives your answer as its first message, with a mention of this thread — and this thread stops there.

## What is kept where and where to look

| What | Where | How you use it |
| --- | --- | --- |
| The stages of this thread's flow | The Flow instructions of the turn | Ids, kinds, skills and executors; the source for `setup.stages` and `flow_stage` |
| All flows of the owner | The Flow page in the bb left menu; `read_flows` | Read a flow by tool; build or change one by `flow-create` |
| The task | `docs/tasks/<status>/<slug>.md` through `bb tasks` | Created on the task stage; the approved Definition of Done goes verbatim into its «Готово, когда» section; the review verdict and the report go into its comments |
| What a stage produced | The `results` of `flow_stage` | The banner above the composer links to them; the next brief shows them on done stages |
| The answered briefs of the run | A file per answered brief in `docs/flows/` (the folder is set in the plugin settings) | The plugin writes it; read it when you need what the owner answered earlier in the run |
| The history behind the prices | `docs/tasks/done/` — `estimate`, `minutes_actual`, review verdicts in the comments | Price items and stages by the fact of similar done tasks — see `flow-criteria` and `flow-stage-selection` |
| Project decisions behind fork answers | `docs/decisions/` | Written by `flow-questions` when an answer is a choice someone may want to undo |
| What users will read about a plugin change | `bb-plugin-<name>/changelog/<slug>.md` | Shown by `flow-demo` as a section of the demo |
