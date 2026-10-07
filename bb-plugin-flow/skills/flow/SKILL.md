---
name: flow
description: How to work by Flow in bb — go through the stages of the thread's flow in order, talk to the owner only through ask_decision briefs, mark stages with flow_stage, let automations and action stages run, rework after a demo comment, and know where the data of the run is kept and where to look. The format of each part of a brief lives in the skill of its stage — flow-questions, flow-criteria, flow-stage-selection, flow-demo. Use it whenever a thread follows a flow, whenever you have a question, a clarification, a fork or a point of confusion for the owner, and when you are about to write "which is better — A or B?".
---

# Flow — working through a flow

A thread follows a flow: an ordered list of stages the owner set up on the Flow page in the bb left menu. You go through the stages in order and talk to the owner only through them. This skill says how to go through a flow; how to do a stage and fill its part of the brief is in the skill of that stage.

## Questions only as a brief

Every question to the owner, every clarification, fork and point of confusion goes only through the `ask_decision` tool. A question in prose in your reply is forbidden: the owner re-reads the turn to understand what they are choosing from, and a short "let's take the second one" gets misread.

There are two kinds of brief:

- **`brief`** — you wait for the answer. Gather everything that has piled up into one brief, do not ask one question per turn. After the call, paste the `::decision{id="…"}` line from the result into your reply as a standalone line — no quotes or backticks, with a blank line before and after — and end the turn. Around the line write at most one sentence: the owner already sees the brief, do not retell it.
- **`clarify`** — one `yesno` question with "Yes" and "No" and no `setup`: a clarification you can continue without. Paste the directive line, write briefly what understanding you continue on, and continue; the answer, if the owner gives one, arrives along the way.

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

**The answer** arrives as a "Brief … — answer:" message in the owner's interface language, which the owner picks in the plugin settings (System follows the browser). It holds only the owner's answer: the questions with the chosen options, a "Run:" line with the run stages in order (an executor is named only when it is not you), an "Off the recommendation:" line when the owner changed it, the budget and "Definition of Done". With a Russian interface the same message reads "Бриф … — ответ:" with «Прогон:», «Не по рекомендации:», «Бюджет — …» and «Definition of Done — …». A deviation from your recommendation is named plainly — do not argue with the choice, work by it. A demo answer is "Brief … — continue." with the next stage, or "Brief … — comment on the … stage:" with the comment.

A chat message from the owner while your brief waits returns the brief to you: the message outranks the brief. Take it in and send the brief again, revised.

## Stages and their skills

The stages with ids, kinds, skills and executors come in the Flow instructions for every turn — read them there, not from memory. A thread follows the flow the owner picked in the new-thread composer; a thread without a pick follows the default flow, the first in the list; a thread created with "Automatic" first gets a flow through `choose_flow`. In a thread with a flow, talk to the owner only through its stages; for anything the stages do not cover, send a `clarify` brief.

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
2. **The answer launches the run.** Answering a brief with a stage in the run is the owner's consent to the stages they marked, with the chosen executors. Go through them in order without new briefs; decide implementation details yourself with the simple option and name them in the demo. The answer ends with a "Next — …" line that names the run and the demo stops. From then on the tool accepts `setup.stages` only while a stage selection or Definition of Done stage is still `todo`, and `setup.criteria` only while a Definition of Done stage is `todo`.
3. **Mark skill stages.** Call `flow_stage` with `started` before the first action of a skill stage, and with `done` and `results` — `[{ label, target }]`, the file name or task key as label — when it is finished. Built-in stages are marked by the briefs themselves: do not mark them.
4. **Automations run by themselves.** An automation stage Flow runs once the nearest stage of the run before it is marked done; marking that stage waits until Flow has run it. The answer of `flow_stage` says whether it started and, if not, why and what to do: tell the owner only what that answer says, never that an automation runs when the answer says it did not start. When the answer hands you Flow's message, act on it in the same turn; when it says to end your turn, end it.
5. **Action stages are the owner's.** When the next stage is an action stage, mark the stage before it done and end your turn. Flow marks the action stage itself and wakes you when its last step passes.
6. **Stop on every demo stage in the run** with a brief carrying its `outcome`, by `flow-demo`. "Continue" moves the flow on. A comment does not accept the demo: answer it; a change it asks for is rework — mark the stage where the change is made started with `flow_stage`: Flow drops the done state of every stage after it, and the undo steps of the done automations it reopens run first. Go through those stages again in order, automations included, up to the demo, and send it again. A comment without a change — send the same demo again.
7. **Another brief only if it is really unclear how to proceed** — an item contains a question, the edits contradict each other or the rest of the brief — and only about that; do not re-ask what was accepted.

An answer that leaves no agent stage in the run does not reach you at all — the work is over, the stages close and the automations behind them run without you; a comment or an image in the answer reaches you as usual.

**Idle time.** Flow measures the time a stage stood waiting for the owner — a failed automation step until the owner retries or skips it, an action stage between presses — and names it in the answer of `flow_stage` and in the reply it wakes you with. Carry it into the demo `notes` and the task report: a line per stage that stood, with its minutes. Stage minutes never include it.

## Where the work runs

Under the brief, left of "Send" — and left of "Continue" on a demo — the owner picks where the work runs: in this thread or in a new thread of the same working tree and branch. The new thread is a sibling of this one, not its child, like bb's own handoff: it receives your answer as its first message, with a mention of this thread — and this thread stops there.

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
