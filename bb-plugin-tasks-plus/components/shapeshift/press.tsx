// The `press` effect of Shapeshift without React Aria, which Tasks+ does not ship: a native button that sets the
// same state attributes — `data-hovered`, `data-pressed`, `data-focus-visible`, `data-disabled` — that system.css
// paints the component's states by. Stands in for src/2-functions/effects/Press.tsx of Shapeshift; see
// docs/specs/tasks-plus-vendorennyi-nabor-shapeshift.md, node `pressNode`.
import { useState, type ReactElement, type ReactNode } from 'react';

export type PressProps = {
  readonly className: string;
  readonly classNames?: Readonly<Record<string, string>>;
  readonly children?: ReactNode;
  readonly onPress?: () => void;
  readonly isDisabled?: boolean;
  readonly 'aria-label'?: string;
  readonly title?: string;
};

type PressState = { readonly hovered: boolean; readonly pressed: boolean; readonly focusVisible: boolean };

const IDLE: PressState = { hovered: false, pressed: false, focusVisible: false };

/** A state attribute is present when on and absent when off, as React Aria sets them. */
const flag = (on: boolean): '' | undefined => (on ? '' : undefined);

export const Press = ({ className, children, onPress, isDisabled = false, title, 'aria-label': ariaLabel }: PressProps): ReactElement => {
  const [state, setState] = useState<PressState>(IDLE);
  const set = (patch: Partial<PressState>) => setState((current) => ({ ...current, ...patch }));
  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel}
      title={title}
      disabled={isDisabled}
      data-hovered={flag(state.hovered && !isDisabled)}
      data-pressed={flag(state.pressed && !isDisabled)}
      data-focus-visible={flag(state.focusVisible)}
      data-disabled={flag(isDisabled)}
      onPointerEnter={() => set({ hovered: true })}
      onPointerLeave={() => set({ hovered: false, pressed: false })}
      onPointerDown={() => set({ pressed: true })}
      onPointerUp={() => set({ pressed: false })}
      onKeyUp={(event) => event.key === 'Tab' && set({ focusVisible: true })}
      onBlur={() => set({ focusVisible: false })}
      onClick={() => onPress?.()}
    >
      {children}
    </button>
  );
};
