// Vendored from Shapeshift generated/ at 99c0c0e — docs/decisions/tasks-plus-shapeshift-vendored.md. Copy again instead of editing by hand.
import type { ReactElement, ReactNode } from 'react';
import { ModesContext } from './paragraphs';
import './system.css';

export type ModesRootProps = {
  readonly brand?: 'A' | 'B' | 'S';
  readonly theme?: 'Light' | 'Dark';
  readonly language?: 'RU' | 'EN';
  readonly density?: 'Compact' | 'Comfortable';
  readonly breakpoint?: 'Mobile' | 'Desktop';
  readonly children?: ReactNode;
};

export const ModesRoot = ({ brand = 'A', theme = 'Light', language = 'RU', density = 'Compact', breakpoint = 'Mobile', children }: ModesRootProps): ReactElement => (
  <ModesContext.Provider value={{ brand, theme, language, density, breakpoint }}>
    <div className="ss-root" data-ss-brand={brand} data-ss-theme={theme} data-ss-language={language} data-ss-density={density} data-ss-breakpoint={breakpoint}>{children}</div>
  </ModesContext.Provider>
);
