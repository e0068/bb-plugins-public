# @bb-plugins/workflow-builder

The workflow builder shared by Claude Config (its Workflows section) and Flow (the right-panel opener of `.js` workflow files).

- `model.ts` — the tree (`workflow → phases → steps`), `compile` to a `.js` the engine runs with the builder mark, `recognize` back to the tree or the reason there is none (`hand-written`, `edited`), `checkTree` for a tree that comes as JSON from an agent.
- `outline-ops.ts`, `validity.ts`, `identity.ts` — pure operations over the tree.
- `store.ts` — `createEditorStore()`: the state of one open workflow; each builder gets its own.
- `react/` — `WorkflowEditor` (tree, node details, agent picker, "Compiles to", read-only code with the reason) and `EditorStoreContext`. No list and no save dialog: the consumer brings them and its buttons in `footer`.

Pure core and React only: no third-party imports beyond what bb shims (see `docs/decisions/packages-shared-code-must-be-pure-or-shimmed.md`). Plugins import it as `@bb-plugins/workflow-builder/<module>`.

`npm test` — the package's tests, including the layer test (`architecture.test.ts`).
