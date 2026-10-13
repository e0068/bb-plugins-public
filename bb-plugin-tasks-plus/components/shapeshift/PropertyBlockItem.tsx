// Vendored from Shapeshift generated/ at 99c0c0e — docs/decisions/tasks-plus-shapeshift-vendored.md. Copy again instead of editing by hand.
import type { ComponentType, ReactElement, ReactNode } from 'react';
import { Minus, type LucideIcon } from 'lucide-react';
import { paragraphs } from './paragraphs';
import { Button, type ButtonProps } from './Button';

type OvEntry = { readonly cls?: readonly string[]; readonly props?: Readonly<Record<string, unknown>>; readonly style?: string; readonly content?: string; readonly icon?: LucideIcon; readonly visible?: boolean; readonly component?: ComponentType<Record<string, unknown>>; readonly children?: ReactNode };
type Ov = Readonly<Record<string, OvEntry>>;

const forward = (source: Ov | undefined, id: string): Ov | undefined => {
  if (source === undefined) return undefined;
  const prefix = `${id}/`;
  const entries: [string, OvEntry][] = Object.entries(source)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, value]) => [key.slice(prefix.length), value]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const mergeEntry = (a: OvEntry | undefined, b: OvEntry | undefined): OvEntry => ({
  cls: [...(a?.cls ?? []), ...(b?.cls ?? [])],
  props: { ...(a?.props ?? {}), ...(b?.props ?? {}) },
  style: b?.style ?? a?.style,
  content: b?.content ?? a?.content,
  icon: b?.icon ?? a?.icon,
  visible: b?.visible ?? a?.visible,
  component: b?.component ?? a?.component,
  children: b?.children ?? a?.children,
});
const merge = (a: Ov, b: Ov): Ov => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return Object.fromEntries([...keys].map((k) => [k, mergeEntry(a[k], b[k])]));
};


export type PropertyBlockItemProps = {
  readonly name?: string;
  readonly value?: string;
  readonly ov?: Ov;
};

export const PropertyBlockItem: (props: PropertyBlockItemProps) => ReactElement = ({ name: p_name = 'name', value: p_value = 'Text · Текст', ov }: PropertyBlockItemProps) => {
  const OV_0: Ov = { 'label': { style: 'ss-s-text-inspector-label' } };
  const OV_2: Ov = { 'icon': { cls: ['ss-o-k-propertyBlockItem__remove-icon'] }, 'label': { visible: false } };
  return (
    <>{(ov?.['']?.visible ?? ov?.['root']?.visible ?? (true)) && (<div className={['ss-c', ov?.['']?.style ?? ov?.['root']?.style ?? ('ss-s-container-base'), 'ss-k-propertyBlockItem__root', ...(ov?.['root']?.cls ?? []), ...(ov?.['']?.cls ?? [])].filter((c): c is string => c !== undefined).join(' ')}>{(ov?.['']?.children ?? ov?.['root']?.children) === undefined ? (<>{(ov?.['name']?.visible ?? (true)) && (<Button kind={'quiet'} label={p_name} {...(ov?.['name']?.props as Partial<ButtonProps> | undefined)} ov={merge(merge(OV_0, (forward(ov, 'name') ?? {})), { '': { cls: ['ss-k-propertyBlockItem__name', ...(ov?.['name']?.cls ?? [])], style: ov?.['name']?.style } })} />)}{(ov?.['value']?.visible ?? (true)) && (<span className={['ss-t', ov?.['value']?.style ?? ('ss-s-text-inspector-label'), 'ss-k-propertyBlockItem__value', ...(ov?.['value']?.cls ?? [])].filter((c): c is string => c !== undefined).join(' ')}>{paragraphs(ov?.['value']?.content ?? (p_value))}</span>)}{(ov?.['remove']?.visible ?? (true)) && (<Button icon={Minus} kind={'quiet'} showIcon={true} {...(ov?.['remove']?.props as Partial<ButtonProps> | undefined)} ov={merge(merge(OV_2, (forward(ov, 'remove') ?? {})), { '': { cls: [...(ov?.['remove']?.cls ?? [])], style: ov?.['remove']?.style ?? 'ss-s-container-button-icon' } })} />)}</>) : (ov?.['']?.children ?? ov?.['root']?.children)}</div>)}</>
  );
};
