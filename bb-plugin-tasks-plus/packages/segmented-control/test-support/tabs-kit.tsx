// Test infrastructure — the kit a plugin would build in its libraries.ts,
// imported from this package's own devDependencies. Outside test-support/
// the package imports Radix by type only (git-install.test.ts).
import * as Tabs from "@radix-ui/react-tabs";
import {
  SegmentedControl as KitSegmentedControl,
  type SegmentedControlProps,
  type TabsKit,
} from "../SegmentedControl";

export const testTabsKit: TabsKit = { Root: Tabs.Root, List: Tabs.List, Trigger: Tabs.Trigger };

/** The control with the test kit already in hand — tests speak about behaviour, not wiring. */
export function SegmentedControl<T extends string>(props: Omit<SegmentedControlProps<T>, "tabs">) {
  return <KitSegmentedControl tabs={testTabsKit} {...props} />;
}
