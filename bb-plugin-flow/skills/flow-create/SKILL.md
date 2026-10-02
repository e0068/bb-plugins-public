---
name: flow-create
description: 'Create or change a flow of the Flow plugin — a named table of stages a thread follows: built-in stages (Questions, Criteria, Stage selection, Demo), skill stages with executors, and automations — Flow steps, your own scripts as a "Script" step, or automations of the Automations plugin. In bb — with the read_flows and save_flow tools; without them — as a table for the Flow page. Use it when the owner asks "make a flow for …", "add a stage to the flow", "put an automation after review", "run a script after the stage", "make it the default flow", and when no flow fits the work. «Сделай flow», «заведи flow», «добавь в flow этап».'
---

# Creating a flow

If the owner writes in Russian, read [ru.md](ru.md) in this folder instead — it is the same skill in Russian; otherwise follow this file.

A flow is a table of stages: a thread following a flow gets the stages in its turn instructions, the brief shows them to the owner, and the progress bar above the composer marks the passed ones. The first flow in the list is the default one: threads without a chosen flow follow it.

## 1. Read what there is

**`read_flows` is available (a bb thread with the Flow plugin).** It returns the flows in order with their stages, the skill names of the catalog, executor ids and the step ids of the built-in automation. Put stages only from this catalog: a skill missing from the answer does not exist in a flow — `save_flow` will reject it.

The tools are missing in a thread started before the plugin was installed. Then — section 5.

A similar flow already exists — tell the owner and offer to change it rather than create a second one with the same meaning.

## 2. Break the work into stages

A stage is a step of work that has its own outcome or its own stop. The order in the table is the order in the run.

| What the work needs | Stage | In `save_flow` |
| --- | --- | --- |
| Settle forks before the start | Questions | `{ "kind": "questions" }` |
| Agree on "Done when" | Criteria | `{ "kind": "criteria" }` |
| Let the owner choose stages, executors and budget | Stage selection | `{ "kind": "select" }` |
| Show what was done and get "continue" or "rework" | Demo | `{ "kind": "demo" }` |
| A step by a skill | Skill stage | `{ "kind": "skill", "skill": "<skill from the catalog>", "name": "<stage name>" }` |
| A step without an agent | Automation | section 3 |

- Questions, Criteria and Stage selection stand at the start, in this order: the brief gathers them into one.
- A Demo goes after a stage whose outcome the owner must see before the work goes on, and at the end.
- A skill stage is a skill from the `read_flows` catalog for a work step. Which skills the owner puts on which steps — task, prototype, spec, plan, implementation, review, testing, research, reproduction, document draft — is visible in the stages of existing flows in `read_flows`: take it from there rather than picking one by a similar name. A step the work never has does not go into the flow: a step optional for a particular task is dropped at Stage selection, not removed from the flow.
- The flow description says only when to take the flow: "When to take" and "When not to take", two or three sentences. An agent chooses the flow for a thread created with "Automatic" by the descriptions, and they stand in the instructions of every such thread. Stages, their skills and executors are not retold in the description: the agent gets them from `choose_flow` and the owner sees them in the table.
- Stage executors are ids from the catalog: `"executors": ["agent:tester"]`. The thread's own agent can always execute any stage and is not listed. Add an executor when the work behind it is bigger than the cost of handing it to a subagent: implementation, review, test runs.
- A built-in stage gets its own skill in the `skill` field only if the owner named it; without the field — the kind's default skill.
- `id` and `name` may be omitted: the id comes from the kind or skill, the name is the English kind name or the skill name. Flow and stage names are in English, like the other flows, unless the owner named others.
- A stage can carry sub-stages that go on and off in the run together with it — say, a repoint automation before a demo and a restore after it. A sub-stage gets `"parent": "<owner stage id>"`, and the owner then needs an explicit `id`. Sub-stages stand right next to their owner: those above it run before it, those below run after. A sub-stage has no number and no sub-stages of its own; the owner is a top-level stage. The owner's checkbox in Stage selection and in the progress bar switches the whole set; a sub-stage also has its own. A flow with a sub-stage away from its owner is refused.

## 3. Automations

An automation is executed by Flow itself, without an agent: as soon as the agent marks the stage before it, Flow runs the automations standing in a row. A failed step stops the chain and waits for the owner's "Retry" or "Skip". Put an automation right after the stage it should follow.

**Flow's built-in automation** — `{ "kind": "skill", "name": "Publish", "automation": { "source": "flow", "steps": [...] } }`. Steps from `read_flows`, in execution order:

| id | What it does |
| --- | --- |
| `git.commit` | Commit |
| `git.fast-forward` | Fast-forward the thread branch onto main |
| `git.create-pr` | Open a PR via the GitHub API, without push |
| `bb.tasks-in-review` | Thread tasks → in_review |
| `files.bump-major`, `files.bump-minor`, `files.bump-patch` | Bump the version in `package.json` |
| `git.merge` | Merge the PR |
| `git.pull-main` | Pull the local main |
| `bb.reinstall` | Update bb plugins from git |
| `bb.tasks-done` | Thread tasks → done |
| `bb.archive` | Archive the thread |

**Script.** The needed step is missing — write a script and put it as a step of the same automation: step `"script:<id>"`, the script in `scripts` of the same stage.

```json
{ "kind": "skill", "name": "Lint and commit",
  "automation": { "source": "flow",
    "steps": ["script:lint", "git.commit"],
    "scripts": [{ "id": "lint", "name": "lint.sh", "content": "#!/bin/sh\nset -e\nnpm run lint\n" }] } }
```

- A script is stored as content in the flow itself, not as a file: `content` is the whole script, up to 200,000 characters. Editing a script is a new save of the flow.
- The first line is a shebang, otherwise the script runs through `sh`. Flow runs it in the thread's working tree; the thread and environment ids are in `BB_THREAD_ID` and `BB_ENVIRONMENT_ID`.
- Exit code 0 — the step passed, the last output line is shown under the step. Any other code — the step failed, the owner sees the tail of the output. A script running longer than 10 minutes is stopped.
- A script asks the terminal nothing and waits for no input: there is no one to answer it. Make a step that cannot be safely repeated idempotent — "Retry" will run it again.
- A script `id` is in Latin letters, unique among the stage's scripts; `name` is a file name, it labels the step on the page.
- Before saving, run the script by hand in the working tree and make sure its exit code and output are as needed.

**Undo steps.** A built-in automation may carry `undo` — steps of the same form as `steps`, its scripts taken from the same `scripts`. When the owner sends work back for rework and the agent starts a done stage again, every done automation after that stage loses its done state, and Flow runs the `undo` steps of each of them, the latest first, before its answer to the agent. Use it for an automation whose effect must not outlive a rework — for example a preview install that points a plugin at the thread's tree:

```json
{ "kind": "skill", "name": "PR and preview",
  "automation": { "source": "flow",
    "steps": ["git.commit", "git.create-pr", "script:preview"],
    "undo": ["script:restore"],
    "scripts": [{ "id": "preview", "name": "preview.sh", "content": "#!/bin/sh\nexec node scripts/flow/plugin-preview.mjs point\n" },
                { "id": "restore", "name": "restore.sh", "content": "#!/bin/sh\nexec node scripts/flow/plugin-preview.mjs restore\n" }] } }
```

A failed undo step does not stop the others and does not block the rework: the agent reads the failure in the answer and tells the owner.

**Action stage** — `{ "kind": "action", "name": "Publish", "automation": { "source": "flow", "steps": [...] } }`: the same steps, but executed not by Flow on its own but by the owner with a button in the progress banner, one step per press. The run stops at such a stage and waits for the owner; while a step runs the button shows a loader, a failed step shows the error and "Retry" — an Action has no "Skip". When the steps are over the stage is closed, automations standing in a row run by themselves, and before a skill stage Flow wakes the agent. Use an Action instead of an automation where the owner must decide: commit, PR, merge, deploy. This kind has no executors — with them `save_flow` rejects the stage.

**An Automations plugin automation** — when what is needed is already assembled there as a rule: `{ "kind": "skill", "automation": { "id": "<row id>", "name": "<row name>" } }`. Take the id and name from `pr_automation_read`; Automations must be enabled, otherwise the stage fails with that reason.

## 4. Save and check

`save_flow` — one flow per call: `{ "name", "description"?, "stages", "id"?, "position"? }`.

- Without `id` — a new flow; with the `id` of an existing one — a full replacement, so first take its stages and description from `read_flows` and send all of them: a description left out is erased.
- `position: 0` puts the flow first — the default flow. Change the default flow only if the owner said so.
- A rejection lists all problems at once, with stage numbers: fix them and send again. Nothing is saved on rejection.
- The answer is the saved flow and the order of all flows. Check the stages against what you assembled and that the other flows are in place.

To the owner in the report — the flow name, its stages in order in one line and its place in the list. An open Flow page shows the new flow by itself.

## 5. Without the tools

Plain Claude Code or a bb thread started before the plugin was installed: assemble a table — number, kind or skill, name, executors, automation with steps and script text — and ask the owner to build the flow on the Flow page: "New flow", stages via the buttons under the table, a script via "Add script…" in the automation steps menu.
