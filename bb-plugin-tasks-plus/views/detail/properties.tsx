import { useState, type FocusEvent, type KeyboardEvent, type ReactElement } from "react";
import { Plus } from "lucide-react";
import { isPropertyName, type Properties, type PropertyPatch } from "../../shared/properties.js";
import { Button } from "../../components/shapeshift/Button.js";
import { PropertyBlockItem } from "../../components/shapeshift/PropertyBlockItem.js";
import { ShapeshiftRoot } from "../../components/shapeshift/ShapeshiftRoot.js";

/**
 * The «Properties» grid of a record's card: a Shapeshift row per property of
 * the record — frontmatter keys the board does not model — edited in place.
 * A name or a value is edited by clicking its row; Enter or leaving the row
 * saves, Escape gives up; the minus removes. Every change is sent as a patch
 * of the names it touches, so two quick edits — or edits on two machines —
 * both land. See
 * docs/specs/tasks-svoi-polya-zapisi-iz-frontmatter-setka-svoistva-v-kart.md, node `grid`.
 */

// ---------------------------------------------------------------------------
// Core: what an edit does to the set, without a screen
// ---------------------------------------------------------------------------

/** The patch that puts the property that was `from` (null — a new one) under `name` with `value`; null when nothing changes. */
export function putPatch(properties: Properties, from: string | null, name: string, value: string): PropertyPatch | null {
  if (from === null) return { set: { [name]: value } };
  if (from === name && properties[name] === value) return null;
  return { ...(from === name ? {} : { rename: { [from]: name } }), set: { [name]: value } };
}

/** Why `name` cannot be the name of the property that was `from`, or null when it can. */
export function propertyProblem(properties: Properties, from: string | null, name: string): string | null {
  if (name.trim() === "") return "A property needs a name.";
  if (!isPropertyName(name)) return name.trim() !== name ? "A name cannot start or end with a space." : `“${name}” is a field of the board.`;
  if (name !== from && Object.hasOwn(properties, name)) return `The record already has “${name}”.`;
  return null;
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

/** The row being edited: which property it was (null — a new one) and what is typed. */
type Draft = { readonly from: string | null; readonly name: string; readonly value: string; readonly focus: "name" | "value" };

const FIELD = "ss-t ss-s-text-inspector-label min-w-0 rounded-sm px-1 outline-none ring-1 ring-transparent focus:ring-ring";

function DraftRow({ draft, problem, onChange, onCommit, onCancel }: {
  draft: Draft;
  problem: string | null;
  onChange: (draft: Draft) => void;
  onCommit: () => void;
  onCancel: () => void;
}): ReactElement {
  const keys = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onCommit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };
  // Leaving the row saves; moving between its two fields does not.
  const leave = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onCommit();
  };
  return (
    <div onBlur={leave}>
      <div className="ss-c ss-s-container-base ss-k-propertyBlockItem__root">
        <input
          aria-label="Property name"
          className={`${FIELD} ss-k-propertyBlockItem__name`}
          value={draft.name}
          autoFocus={draft.focus === "name"}
          placeholder="Name"
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          onKeyDown={keys}
        />
        <input
          aria-label={`Value of ${draft.name || "the new property"}`}
          className={`${FIELD} ss-k-propertyBlockItem__value`}
          value={draft.value}
          autoFocus={draft.focus === "value"}
          placeholder="Empty"
          onChange={(event) => onChange({ ...draft, value: event.target.value })}
          onKeyDown={keys}
        />
      </div>
      {problem === null ? null : (
        <p role="alert" className="ss-t ss-s-text-inspector-label text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}

export function PropertiesGrid({ properties, onSave }: { properties: Properties; onSave: (patch: PropertyPatch) => void }): ReactElement {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const open = (next: Draft) => {
    setDraft(next);
    setProblem(null);
  };
  const close = () => {
    setDraft(null);
    setProblem(null);
  };
  const commit = () => {
    if (draft === null) return;
    // A new row left without a name is no property: it goes quietly.
    if (draft.from === null && draft.name === "" && draft.value === "") return close();
    const found = propertyProblem(properties, draft.from, draft.name);
    if (found !== null) return setProblem(found);
    const patch = putPatch(properties, draft.from, draft.name, draft.value);
    if (patch !== null) onSave(patch);
    close();
  };

  const rows = Object.entries(properties);
  return (
    <section aria-label="Properties" className="mb-4">
      <ShapeshiftRoot className="flex flex-col gap-1">
        {rows.map(([name, value]) =>
          draft !== null && draft.from === name ? (
            <DraftRow key={name} draft={draft} problem={problem} onChange={setDraft} onCommit={commit} onCancel={close} />
          ) : (
            <div
              key={name}
              data-property={name}
              className="cursor-text"
              onClick={(event) => {
                if ((event.target as Element).closest("button")?.getAttribute("aria-label") === `Remove ${name}`) return;
                open({ from: name, name, value, focus: (event.target as Element).closest(".ss-k-propertyBlockItem__name") ? "name" : "value" });
              }}
            >
              <PropertyBlockItem
                name={name}
                value={value === "" ? " " : value}
                ov={{
                  name: { props: { "aria-label": `Rename ${name}` } },
                  remove: { props: { "aria-label": `Remove ${name}`, onPress: () => onSave({ remove: [name] }) } },
                }}
              />
            </div>
          ),
        )}
        {draft !== null && draft.from === null ? (
          <DraftRow draft={draft} problem={problem} onChange={setDraft} onCommit={commit} onCancel={close} />
        ) : null}
        <div className="flex">
          <Button kind="quiet" label="Add property" icon={Plus} showIcon onPress={() => open({ from: null, name: "", value: "", focus: "name" })} />
        </div>
      </ShapeshiftRoot>
    </section>
  );
}
