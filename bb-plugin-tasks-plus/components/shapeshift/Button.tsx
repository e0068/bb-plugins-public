// Vendored from Shapeshift generated/ at 99c0c0e — docs/decisions/tasks-plus-shapeshift-vendored.md. Copy again instead of editing by hand.
import type { ComponentProps, ComponentType, ReactElement, ReactNode } from 'react';
import { Plus, type LucideIcon } from 'lucide-react';
import { Press as Fn_Press } from './press';
import { paragraphs } from './paragraphs';

type OvEntry = { readonly cls?: readonly string[]; readonly props?: Readonly<Record<string, unknown>>; readonly style?: string; readonly content?: string; readonly icon?: LucideIcon; readonly visible?: boolean; readonly component?: ComponentType<Record<string, unknown>>; readonly children?: ReactNode };
type Ov = Readonly<Record<string, OvEntry>>;


export type ButtonProps = {
  readonly label?: string;
  readonly showIcon?: boolean;
  readonly icon?: LucideIcon;
  readonly kind?: 'primary' | 'quiet';
  readonly ov?: Ov;
} & Omit<ComponentProps<typeof Fn_Press>, 'className' | 'classNames' | 'children' | 'data-chain' | 'onPointerDown'>;

export const Button: (props: ButtonProps) => ReactElement = ({ label: p_label = 'Кнопка', showIcon: p_showIcon = false, icon: p_Icon = Plus, kind: p_kind = 'primary', ov, ...rest }: ButtonProps) => {
  const classNames: Readonly<Record<string, string>> = { root: ['ss-c', ov?.['']?.style ?? ov?.['root']?.style ?? (p_kind === 'quiet' ? 'ss-s-container-button-ghost' : 'ss-s-container-button'), 'ss-k-button__root', ...(ov?.['root']?.cls ?? []), ...(ov?.['']?.cls ?? [])].filter((c): c is string => c !== undefined).join(' '), icon: ['ss-i', 'ss-k-button__icon', p_kind === 'quiet' ? 'ss-k-button--kind-quiet__icon' : undefined, ...(ov?.['icon']?.cls ?? [])].filter((c): c is string => c !== undefined).join(' '), label: ['ss-t', ov?.['label']?.style ?? ('ss-s-text-label'), 'ss-k-button__label', p_kind === 'quiet' ? 'ss-k-button--kind-quiet__label' : undefined, ...(ov?.['label']?.cls ?? [])].filter((c): c is string => c !== undefined).join(' ') };
  return (
    <>{(ov?.['']?.visible ?? ov?.['root']?.visible ?? (true)) && (<Fn_Press {...rest} className={['ss-c', ov?.['']?.style ?? ov?.['root']?.style ?? (p_kind === 'quiet' ? 'ss-s-container-button-ghost' : 'ss-s-container-button'), 'ss-k-button__root', ...(ov?.['root']?.cls ?? []), ...(ov?.['']?.cls ?? [])].filter((c): c is string => c !== undefined).join(' ')} classNames={classNames}>{(ov?.['']?.children ?? ov?.['root']?.children) === undefined && ((ov?.['icon']?.visible ?? (p_showIcon)) && (<span className={['ss-i', 'ss-k-button__icon', p_kind === 'quiet' ? 'ss-k-button--kind-quiet__icon' : undefined, ...(ov?.['icon']?.cls ?? [])].filter((c): c is string => c !== undefined).join(' ')}>{(() => { const Icon_0 = ov?.['icon']?.icon ?? (p_Icon); return <Icon_0 />; })()}</span>))}{(ov?.['']?.children ?? ov?.['root']?.children) === undefined && ((ov?.['label']?.visible ?? (true)) && (<span className={['ss-t', ov?.['label']?.style ?? ('ss-s-text-label'), 'ss-k-button__label', p_kind === 'quiet' ? 'ss-k-button--kind-quiet__label' : undefined, ...(ov?.['label']?.cls ?? [])].filter((c): c is string => c !== undefined).join(' ')}>{paragraphs(ov?.['label']?.content ?? (p_label))}</span>))}{ov?.['']?.children ?? ov?.['root']?.children}</Fn_Press>)}</>
  );
};
