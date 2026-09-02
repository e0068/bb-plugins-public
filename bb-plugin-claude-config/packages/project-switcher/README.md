# @bb-plugins/project-switcher

Presentational primitive shared by plugins that show a horizontal row of
project-picker buttons. Two plugins each have their own project switcher —
`bb-plugin-token-usage-header` (multi-select filter over a fetched thread
slice) and `bb-plugin-claude-config` (single-scope pick). What they share is
only the *presentation*: a wrapping row of buttons, the selected one(s)
highlighted, click dispatches a key. Selection semantics (single pick vs
multi-filter) and where the option list comes from stay in each plugin —
this package renders and dispatches clicks, nothing else.

## Usage

```tsx
import { ProjectSwitcher, type ProjectSwitcherOption } from "../packages/project-switcher/react";

const options: ProjectSwitcherOption[] = [
  { key: "", label: "All projects" },
  { key: "my-project", label: "my-project" },
  { key: null, label: "Threads" },
];

<ProjectSwitcher
  options={options}
  isSelected={(key) => (key === "" ? filter.size === 0 : filter.has(key))}
  onSelect={(key) => {
    if (key === "") {
      setFilter(new Set());
      return;
    }
    setFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }}
/>;
```

`option.key` may be `null` (e.g. a "no matching project" bucket) — the
component keys each button as `` `k:${String(option.key)}` `` (`null` →
`"k:null"`). This is safe for the real key spaces both consumers use (`""`,
BB project names, `null`); a project literally named `"null"` would collide,
but such a key never occurs.

Button styling mirrors this repo's shadcn-derived `Button` primitive at
`variant="default" | "outline"`, `size="sm"`, copied as a literal Tailwind
class string — this package has no dependency on any host plugin's
`components/ui/button.tsx`.
