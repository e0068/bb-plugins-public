// Источник логотипов провайдеров для корней поверхностей — полосы этапов, брифа,
// настроек: список провайдеров хоста; части берут логотип из `provider-logos.tsx`.
import { useMemo, type ReactNode } from "react";
import { experimental_useProviders } from "@get-bb/plugin-sdk/app";

import { ProviderLogosContext, type ProviderBrand } from "./provider-logos";

export function ProviderLogosProvider({ children }: { children: ReactNode }) {
  const { providers } = experimental_useProviders();
  const brands = useMemo(
    () => new Map<string, ProviderBrand>(providers.flatMap((p) => (p.logoUrl === null ? [] : [[p.id, { name: p.displayName, logoUrl: p.logoUrl }] as const]))),
    [providers],
  );
  return <ProviderLogosContext.Provider value={brands}>{children}</ProviderLogosContext.Provider>;
}
