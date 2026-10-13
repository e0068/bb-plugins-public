// @vitest-environment node
// Обещания мешка пропсов: он повторяет ключи свежих пропсов, функции в нём зовут
// самую свежую версию, объекты читаются из свежих пропсов, подпись зависит только
// от значений.
import { describe, expect, it } from "vitest";

import { signatureOf, syncBag, type Bag } from "./props-bag";

const latestOf = (props: Bag) => ({ current: props });

describe("syncBag", () => {
  it("после синхронизации ключи мешка равны ключам пропсов", () => {
    const bag: Bag = { stale: 1 };
    syncBag(bag, latestOf({ label: "a", onClick: () => {}, menu: { items: [] } }));
    expect(Object.keys(bag).sort()).toEqual(["label", "menu", "onClick"]);
  });

  it("идемпотентна: повторный вызов с теми же пропсами ничего не меняет", () => {
    const bag: Bag = {};
    const latest = latestOf({ label: "a", value: 2 });
    syncBag(bag, latest);
    const snapshot = { ...bag };
    syncBag(bag, latest);
    expect(bag).toEqual(snapshot);
  });

  it("функция в мешке зовёт самую свежую функцию из пропсов", () => {
    const calls: string[] = [];
    const latest = { current: { onClick: () => calls.push("first") } as Bag };
    const bag: Bag = {};
    syncBag(bag, latest);
    latest.current = { onClick: () => calls.push("second") };
    syncBag(bag, latest);
    (bag.onClick as () => void)();
    expect(calls).toEqual(["second"]);
  });

  it("функция, исчезнувшая из пропсов, исчезает и из мешка", () => {
    const latest = { current: { onClick: () => {} } as Bag };
    const bag: Bag = {};
    syncBag(bag, latest);
    latest.current = {};
    syncBag(bag, latest);
    expect("onClick" in bag).toBe(false);
  });

  it("поле объекта читается из свежих пропсов, а сам объект в мешке не меняется", () => {
    const latest = { current: { menu: { title: "one" } } as Bag };
    const bag: Bag = {};
    syncBag(bag, latest);
    const view = bag.menu;
    latest.current = { menu: { title: "two" } };
    syncBag(bag, latest);
    expect(bag.menu).toBe(view);
    expect((bag.menu as { title: string }).title).toBe("two");
  });
});

describe("signatureOf", () => {
  it("не зависит от порядка ключей и от функций", () => {
    const a = signatureOf({ label: "x", value: 1, onClick: () => 1 });
    const b = signatureOf({ value: 1, label: "x", onClick: () => 2 });
    expect(a).toBe(b);
  });

  it("меняется при смене значения и при смене ответа get()", () => {
    const base = signatureOf({ label: "x", get: () => false });
    expect(signatureOf({ label: "y", get: () => false })).not.toBe(base);
    expect(signatureOf({ label: "x", get: () => true })).not.toBe(base);
  });
});
