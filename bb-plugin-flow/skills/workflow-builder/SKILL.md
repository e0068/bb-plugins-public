---
name: workflow-builder
description: 'Build or change a Claude Code workflow (~/.claude/workflows/*.js) so the workflow builder opens it as a tree — through the workflow_read and workflow_write tools of the Flow plugin, never by writing the .js by hand. The format of the builder tree: phases, agent steps, parallel and pipeline groups, iteration over data, repeats, and the {{args}}, {{prev}}, {{item}} placeholders. Use it when asked to "make a workflow", "add a step to the workflow", "change the workflow prompt", "why does the builder show code only". «Собери workflow», «поправь workflow», «почему workflow code only».'
---

# Workflow builder

If the owner writes in Russian, read [ru.md](ru.md) in this folder instead — it is the same skill in Russian; otherwise follow this file.

A workflow is one .js file that Claude Code's `/workflows` runs. The builder — the Workflows section of Claude Config and the right panel that a workflow chip in Flow opens — shows it as a tree and edits it. It opens as a tree only a file it can rebuild byte for byte from that tree: the file carries the builder's mark at the end, and the tree compiled again must give the same text. Anything else opens read-only as code, with the reason: written by hand, or built by the builder and then edited by hand.

So a workflow is built and changed only through the tree, with two tools:

- `workflow_read { name }` — the file `~/.claude/workflows/<name>.js` as `{ path, tree }`, or `{ path, reason, note }` when the builder can't read it.
- `workflow_write { tree }` — checks the tree, compiles it and writes `~/.claude/workflows/<tree.name>.js`. A tree with problems is refused with every problem by node path, and nothing is written. A hand-written file of the same name is never overwritten.

## Order of work

1. Changing an existing workflow — `workflow_read` it first. A tree came back — change that tree and write it whole. A reason came back — the file is hand-written or edited by hand: the tool will not write over it; build a new workflow under another name, or tell the owner the file stays code.
2. A new workflow — make up the tree below and `workflow_write` it.
3. Never edit the .js with file tools afterwards: one edit turns it into "code only" for the builder.

## The tree

```json
{
  "name": "write-review",
  "description": "Writes the change, then reviews and tests it",
  "phases": [
    {
      "title": "Build",
      "mode": "pipeline",
      "steps": [
        { "type": "agent", "label": "writer", "agentType": "implementer", "prompt": "Implement {{args}}" },
        {
          "type": "container",
          "mode": "parallel",
          "steps": [
            { "type": "agent", "label": "reviewer", "agentType": "reviewer", "prompt": "Review what was written: {{prev}}" },
            { "type": "agent", "label": "tester", "agentType": "tester", "prompt": "Run the tests for: {{prev}}" }
          ]
        }
      ]
    }
  ]
}
```

- `name` — the file name: lowercase latin letters, digits and hyphens. `description` — one line; the list of workflows shows it.
- A phase — `{ title, mode?, steps }`. `mode`: `single` (one step, the default), `parallel` (steps run at once), `pipeline` (steps in order, each sees the previous one's result as `{{prev}}`). Phases do not pass results to each other: work whose step needs the previous step's answer is one phase in `pipeline` mode.
- An agent step — `{ type: "agent", label, agentType, prompt, model?, effort?, schema?, repeat? }`. `agentType` — the agent the step runs as (`implementer`, `reviewer`, `general-purpose`, a plugin agent `plugin:name`); a step without it leaves the workflow invalid in the builder. `model`, `effort` — only to override the agent's own. `schema` — a JSON schema of the answer when the next step needs fields, not text.
- A group — `{ type: "container", mode: "parallel" | "pipeline", steps }`, nested to any depth.
- Iteration — on a parallel group that is a stage of a pipeline: `iterateOver: "<field>"` runs the FIRST step once per element of `{{prev}}.<field>` — the previous stage's answer, so that stage needs a `schema` with that array field; the element is `{{item}}` in the step's prompt. `iterateInWaves: true` — the field is an array of arrays, run wave after wave; `maxParallel: N` caps simultaneous branches.
- Repeat — `repeat: { maxLoops, until }` on any step, group or phase: run the node up to `maxLoops` times, stop early once `until` — a JS expression over `result`, the node's last answer — is true.
- Placeholders in a prompt: `{{args}}` — the input of the run, anywhere; `{{prev}}` — the previous stage's result, only inside a pipeline stage and the nodes nested in it; `{{item}}` — the current element, only in the first step of an `iterateOver` group. Anywhere else the compiler would drop the placeholder, so `workflow_write` refuses such a tree and names the node.

What the tree cannot say — branching on a result, counters, budgets, loops over tasks with their own state — stays a hand-written workflow, read-only in the builder. Say so to the owner instead of squeezing it into the tree.
