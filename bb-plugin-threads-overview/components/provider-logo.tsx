// The provider mark at the left of a thread row.
//
// The host serves each provider's logo as a currentColor SVG. Inside an <img>
// currentColor collapses to black and the mark vanishes on a dark theme, so the
// SVG masks a painted box instead: the provider's declared brand tint through
// light-dark(), which follows the document's color-scheme, or the row's own
// text color when the provider declares none. An unresolved provider keeps an
// empty box of the same size, so titles stay in one column.
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export interface ProviderBrand {
  readonly name: string;
  readonly logoUrl: string | null;
  readonly tint: { readonly light: string; readonly dark: string } | null;
}

export function ProviderLogo({
  provider,
  className,
}: {
  provider: ProviderBrand | null;
  className?: string;
}) {
  if (provider === null || provider.logoUrl === null) {
    return <span aria-hidden className={cn("size-4 shrink-0", className)} />;
  }
  const mask = `url("${provider.logoUrl}") center / contain no-repeat`;
  const tint =
    provider.tint === null
      ? undefined
      : `light-dark(${provider.tint.light}, ${provider.tint.dark})`;
  const style: CSSProperties = {
    mask,
    WebkitMask: mask,
    backgroundColor: tint ?? "currentColor",
  };
  return (
    <span
      role="img"
      aria-label={provider.name}
      data-logo-url={provider.logoUrl}
      data-tint={tint}
      className={cn("inline-block size-4 shrink-0", className)}
      style={style}
    />
  );
}
