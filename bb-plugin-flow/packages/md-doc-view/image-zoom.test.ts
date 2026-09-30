// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { zoomTargetOf } from "./image-zoom";

// The engine's own markup: a block picture is a wrap holding the <img>, the
// menu button and, below them, the caption row (kasimov.js, decorateImages).
function block(inner: string): HTMLElement {
  const node = document.createElement("span");
  node.className = "mde-imgblock";
  node.innerHTML = inner;
  return node;
}

const RASTER =
  '<span class="mde-ctl mde-imgwrap">' +
  '<img class="mde-ctl mde-imgpic" src="shot.png" alt="the shot">' +
  '<span class="mde-ctl mde-imgmenubtn">⋯</span>' +
  "</span>" +
  '<span class="mde-ctl mde-imgcaprow"><span class="mde-imgcap">the shot</span></span>';

describe("zoomTargetOf", () => {
  it("a click on the picture gives its address and its caption", () => {
    const img = block(RASTER).querySelector("img");
    expect(zoomTargetOf(img)).toEqual({ src: "shot.png", alt: "the shot" });
  });

  it("a picture without a caption gives an empty alt, not null", () => {
    const node = block('<img class="mde-ctl mde-imgpic" src="shot.png" alt="">');
    expect(zoomTargetOf(node.querySelector("img"))).toEqual({ src: "shot.png", alt: "" });
  });

  it("a click beside the picture inside the same block gives nothing", () => {
    const node = block(RASTER);
    expect(zoomTargetOf(node.querySelector(".mde-imgmenubtn"))).toBeNull();
    expect(zoomTargetOf(node.querySelector(".mde-imgcap"))).toBeNull();
  });

  it("an inline SVG is not a picture to unfold — it has no address", () => {
    const node = block(
      '<span class="mde-ctl mde-imgsvg"><svg><circle cx="1" cy="1" r="1"></circle></svg></span>',
    );
    expect(zoomTargetOf(node.querySelector("circle"))).toBeNull();
    expect(zoomTargetOf(node.querySelector("svg"))).toBeNull();
  });

  it("a picture with no address gives nothing", () => {
    const node = block('<img class="mde-ctl mde-imgpic" src="" alt="x">');
    expect(zoomTargetOf(node.querySelector("img"))).toBeNull();
  });

  it("nothing, plain text and a document give nothing", () => {
    expect(zoomTargetOf(null)).toBeNull();
    expect(zoomTargetOf(document.createTextNode("text"))).toBeNull();
    expect(zoomTargetOf(document.createElement("p"))).toBeNull();
  });
});

// Whatever the engine wraps a picture in — and it wraps it in a span, and the
// span in a block, and rebuilds all of it on every keystroke — the answer is
// about the picture, not about how deep the click landed inside it.
describe("zoomTargetOf — the same picture at any depth", () => {
  it("a click anywhere inside the picture's own subtree gives the picture", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 6 }), fc.webPath(), (depth, path) => {
        const src = `img${path}.png`;
        let node: HTMLElement = document.createElement("div");
        const img = document.createElement("img");
        img.className = "mde-ctl mde-imgpic";
        img.setAttribute("src", src);
        img.setAttribute("alt", "cap");
        node.appendChild(img);
        for (let i = 0; i < depth; i++) {
          const wrap = document.createElement("span");
          wrap.className = "mde-ctl mde-imgwrap";
          wrap.appendChild(node);
          node = wrap;
        }
        expect(zoomTargetOf(img)).toEqual({ src, alt: "cap" });
      }),
    );
  });

  it("a click at any depth OUTSIDE a picture gives nothing", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 6 }), (depth) => {
        const root = document.createElement("div");
        root.innerHTML = '<img class="mde-ctl mde-imgpic" src="a.png" alt="a">';
        let leaf: HTMLElement = document.createElement("em");
        let node: HTMLElement = leaf;
        for (let i = 0; i < depth; i++) {
          const wrap = document.createElement("span");
          wrap.appendChild(node);
          node = wrap;
        }
        root.appendChild(node);
        expect(zoomTargetOf(leaf)).toBeNull();
      }),
    );
  });
});
