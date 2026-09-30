// Layer 2 — the picture unfolded over bb. Neither the engine nor kit has a
// full-screen viewer, so this is the plugin's own: a Radix dialog, the primitive
// the design system leaves to Radix (memory/wiki/plugin-dependency-stack.md),
// with the picture as its whole content.
//
// Three ways out, all the same way out: a second click on the picture, a click
// beside it, and Escape. The sheet covers the window and closes on any click
// inside it, so "beside the picture" needs no geometry — the backdrop keeps its
// own handler for the case where the sheet does not reach an edge.
import * as Dialog from "@radix-ui/react-dialog";

import type { ZoomTarget } from "./image-zoom";
import { portalScope } from "./portal-scope";

export interface ImageZoomProps {
  /** The picture to unfold; null — nothing is unfolded. */
  target: ZoomTarget | null;
  onClose: () => void;
}

export function ImageZoom({ target, onClose }: ImageZoomProps) {
  return (
    <Dialog.Root open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay {...portalScope} className="mdo-zoom-overlay" onClick={onClose} />
        <Dialog.Content
          {...portalScope}
          className="mdo-zoom"
          aria-describedby={undefined}
          onClick={onClose}
          // The picture is the content; moving focus into it would only take
          // the outline away from where the reader was.
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          {target !== null && (
            <img className="mdo-zoom-pic" src={target.src} alt={target.alt} />
          )}
          {/* A dialog owes a11y a name. With a caption it is the caption, under
              the picture the way the document puts it; without one the name is
              there but not on screen, because the document shows none either. */}
          {target !== null && target.alt !== "" ? (
            <Dialog.Title className="mdo-zoom-cap">{target.alt}</Dialog.Title>
          ) : (
            <Dialog.Title className="mdo-zoom-name">Image</Dialog.Title>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
