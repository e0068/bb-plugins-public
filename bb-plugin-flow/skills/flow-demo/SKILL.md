---
name: flow-demo
description: The Demo stage — show the owner everything done since the previous demo, with a link to every result and a live result in one click, and go on without waiting; the demo has no buttons — its comment, when an approval stands ahead, goes with that approval. In bb — a brief with outcome via ask_decision; in plain Claude Code — a report and AskUserQuestion. Use it on the Demo stage of a Flow and when the work has reached a point where the owner should see it. Этап Демонстрация — показать сделанное и живой результат.
---

# Demo

If the owner writes in Russian, read [ru.md](ru.md) in this folder instead — it is the same skill in Russian; otherwise follow this file.

The owner sees what was done. A demo is a report, not a stop: in bb sending it closes the stage, and you go on to the next stage of the run at once. Only an approval stage holds the work. Send the demo the moment its stage comes — do not skip it or fold it into the approval: the owner sees an approval as a comment field only, and the tool refuses an approval while a demo stage before it has not been sent.

## What to show

- Everything done since the previous demo, and for the first one — since the start of the work. In sections, briefly; one section per large part.
- A link to every result: a file, a task, a page, a PR.
- What was not done and why.
- **Code changed — a live result in one click.** Bring up what was made, check that it responds, and give a page or a launch command. A desktop app — a launch command.
- **A bb plugin** does not come up from a working tree by itself: bb loads a plugin from its install path. The install can be pointed at the worktree with one command, `bb plugin install --yes path:<worktree>`, but that is temporary and the install must be returned to its permanent source; `bb plugin remove` erases the plugin's database, do not run it. Simpler: until the merge and the plugin update step, the live result is the plugin's test run command and a screenshot; after — the plugin itself.
- **The result will be opened on a device you have not seen — check it by emulation before the demo.** A phone, another browser, a dark theme: bring the result up in Browser Automation with that device emulated and walk the gesture or screen the work is for. "Not checked" stays only for what cannot be emulated, and names the reason.
- **A bug was fixed — steps that show it is gone.** On the same input where it occurred, not on a convenient substitute.
- Only documents changed — there is no live result, say so.

## How to show

**In bb.** An `ask_decision` brief with `outcome` instead of setup:

- `stage` — this stage's id from the turn instructions; in a flow with several demos — the id `flow_stage` named as the next stage, not the id of an earlier demo: a brief with another demo's id closes that one, leaves this one open, and the automation after it never starts; `final` — whether it is the last demo; `next` — the next stage, only when it is not the last.
- `done` — what closed since the previous demo; `pending` — what did not, with `why`; `sections` — report sections `{ title, text }`; `notes` — "Important to know": only what helps the owner make a decision, paragraphs split by a blank line — bug check steps, caveats that change their choice; how long a stage stood, how long the work took, what went as usual — not here; nothing to say — no field; `tasks` — tasks without `note`: `done: true` — this demo shows the task's final result; before the call, set its status to In Review with `bb tasks update <key> --status in_review`, and it becomes done at the end of the run; `done: false` — a task only created in this thread. The widget shows them under "Review" and "Created", each as its Tasks+ card that opens the task in the thread's side panel.
- The plugin changed — a section "Changelog" in `sections` with the text of the changelog entry as it is in the file `bb-plugin-<name>/changelog/<slug>.md`, Russian and English: the owner sees what users will read before the merge.
- A demo is a report: no `questions` and no `nextFlow` — the tool refuses both. A question goes as a `clarify`; moving the work into another flow is `nextFlow` on an approval (`flow-approve`), where the owner moves it with a button.
- `results` — at least one: `{ label, target }` — a file, path or address; `{ label, command }` — a command the owner runs with a button. Unless `documentsOnly: true`, the results hold a live one: an `http(s)` page or a command.
- A local server page is shared via `bb connect expose <port>`; without Connect — `http://localhost:<port>`.
- `documentsOnly: true` — only documents changed since the previous demo: a spec, a plan, a task, a prototype file with nothing to run; the card says there is no live link. When code changed, the tool rejects a demo without a live result.

**The live result.** The owner judges the work by seeing it run, not by reading about it. Web — start the dev server or a preview in the background, run `bb connect status --json`: when paired, `bb connect expose <port>` prints the share URL — give that; otherwise give `http://localhost:<port>` and say so in `notes`; link straight to the page where the change is visible, with the query or route that puts it in the right state. Desktop — build the app from this working tree and give `{ label, command }` that starts that build; one click on "Run in terminal" has to be enough. Before sending, request every page URL and send the demo only when it answers 200; a command you have run once yourself.

**A prototype — in the window of the widget.** An HTML prototype goes into `prototype: { url, title? }` of the demo outcome: the owner clicks it in a window under the demo card, as wide as the dialog, instead of opening a link. Serve the prototype folder (`python3 -m http.server <port>`), publish the port with `bb connect expose <port>` and put that `https://` address into `url`; without Connect — `http://localhost:<port>`. Above the window the widget lists the prototype's forks as rows of segments and the owner's comments; the choices and the comments reach you with the answer to the approval as the lines "Prototype choices: fork — value" and "Prototype comments: spot — text". The forks come from the page itself, by messages to `window.parent` — add them to the demo panel of the prototype:

- page → widget: `{ source: "bb-prototype", type: "ready", forks: [{ id, label, options: [{ value, label }] }] }` once on load; `{ source: "bb-prototype", type: "choice", fork, value }` on every switch in its own panel; `{ source: "bb-prototype", type: "picked", label }` — the name of the element clicked after `pick`, e.g. "the Send button";
- widget → page: `{ source: "bb-prototype", type: "restore", choices, embedded: true }` — the saved choice, apply it and hide your own demo panel; `{ source: "bb-prototype", type: "set", fork, value }` — a switch in the widget; `{ source: "bb-prototype", type: "pick" }` — the next click is not a click: name the element with `picked` instead.

```json
{
  "title": "Demo — prototype",
  "outcome": {
    "stage": "demo", "final": false, "next": "Spec",
    "done": ["The dispatch cell sits left of Send", "The prototype switches every open fork"],
    "pending": [{ "text": "The outcome section", "why": "doing it next" }],
    "sections": [{ "title": "Changelog", "text": "- ru: Ячейка отправки слева от «Отправить»\n  en: The dispatch cell sits left of Send" }],
    "notes": "Segments clip the label on a narrow feed.\n\nThe light theme is checked on screenshots only.",
    "tasks": [{ "key": "BBPL-1", "done": true }, { "key": "BBPL-2", "done": false }],
    "results": [{ "label": "localhost:5173", "target": "http://localhost:5173/settings" }, { "label": "Desktop app", "command": "cd app && npm run tauri dev" }, { "label": "prototype.html", "target": "docs/assets/x/prototype.html" }]
  }
}
```

After the call, paste the directive line as a standalone line and go on to the next stage in the same turn. When the turn ends, paste the line once more in the final reply of the turn, above the approval line or the brief line that ends the turn: bb folds replies between tool calls under "Worked for", and the card moves to the last copy of its line — without the repeat the owner sees the approval and not the demo. Leave what you brought up running — the owner may open it later; stop it and remove the share (`bb connect unexpose <port>`) when the run ends or a newer demo replaces it.

**In Claude Code.** A reply in sections: "Done", "Not done", "How to check". Every file, folder and address as a markdown link. The live result — the `http://localhost:<port>` address of the running server or exactly one launch command in a bash block. Then AskUserQuestion "What next?": "Continue" (Recommended), and the owner writes a comment in "Other". On getting the answer, stop what you brought up.

No AskUserQuestion — the same report ending with "continue or write a comment", and the turn ends.

## No comment on the demo itself

The demo widget is the report: no buttons. When an approval stands ahead, it has a comment field — the comment does not stop the run and arrives with that approval as a checklist item. The owner also comments on the approval stage that follows — a comment there is rework by `flow-approve` — or writes in the chat; a chat message can arrive at any moment, while you are on a later stage, too. Answer it. If it asks for a change, return the work to the stage where the change is made — roll back to it with flow_stage — and go through the stages after it again in order, reviews and automations included, up to this demo, and send the demo again: otherwise the change skips the review and the commit after it. A comment without a change — answer it in one sentence and carry on where you are.

The tasks under "Review" go to done at the end of the run: the automation step "Task → done" moves every task linked to the thread; one not linked to it, or a flow without that step, — set it done yourself: `bb tasks update <key> --status done`.

In Claude Code the demo ends the turn: "Continue" — go to the next stage; a comment — as above.
