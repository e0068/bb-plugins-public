// bb's compact Home as plugin tests rebuild it, and a reader of what the
// section's arbitrary variants put on bb's own boxes. jsdom lays nothing out,
// so a variant — `[<host selector with &>]:<utility>` — is read by running its
// selector against the rebuilt Home.

export const SCROLLER = "root-compose-compact-scroll-viewport";

/**
 * bb 0.45's compact Home around a plugin section: the scroller, the box bb
 * holds at the scroller's height and pushes its content to the foot of, the
 * column with Recents and the plugin sections, the spacer under the composer,
 * and the composer with the fade bb lays over the rows passing under it.
 */
export function compactHome045(): { scroller: HTMLElement; slotBox: HTMLElement; fade: HTMLElement } {
  const home = document.createElement("div");
  home.dataset.testid = "root-compose-compact-home";
  home.innerHTML = `
    <div data-testid="${SCROLLER}" class="absolute inset-x-0 bottom-0 overflow-y-auto overscroll-contain">
      <div data-testid="root-compose-compact-scroll-content" class="flex min-h-full flex-col justify-end">
        <div data-testid="root-compose-compact-recents-offset"></div>
        <div class="mx-auto w-full max-w-[760px] px-4">
          <section class="md:hidden" data-root-compose-mobile-recents=""></section>
          <div class="mt-6 space-y-6" data-testid="plugin-homepage-sections">
            <section class="space-y-3"><div class="contents" data-slot-box=""></div></section>
          </div>
        </div>
        <div data-testid="root-compose-compact-bottom-spacer"></div>
      </div>
    </div>
    <div data-testid="root-compose-compact-composer" class="absolute inset-x-0 bottom-0 z-10">
      <div data-testid="root-compose-compact-fade"></div>
      <div class="bg-background pb-4"></div>
    </div>`;
  document.body.append(home);
  return {
    scroller: home.querySelector<HTMLElement>(`[data-testid=${SCROLLER}]`)!,
    slotBox: home.querySelector<HTMLElement>("[data-slot-box]")!,
    fade: home.querySelector<HTMLElement>("[data-testid=root-compose-compact-fade]")!,
  };
}

/** Every utility the section's arbitrary variants put on `box`, read off the classes under `root`. */
export function utilitiesOn(box: Element, root: HTMLElement): string[] {
  const utilities: string[] = [];
  const owners = [root, ...Array.from(root.querySelectorAll<HTMLElement>("[class]"))];
  owners.forEach((owner, index) => {
    owner.setAttribute("data-variant-owner", String(index));
    for (const token of owner.classList) {
      const variant = /^\[(.+)\]:(.+)$/.exec(token);
      if (variant === null) continue;
      const selector = variant[1]!.replaceAll("_", " ").replaceAll("&", `[data-variant-owner="${index}"]`);
      if (Array.from(document.querySelectorAll(selector)).includes(box)) utilities.push(variant[2]!);
    }
  });
  return utilities;
}
