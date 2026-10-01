import { describe, expect, it } from "vitest";
import { flowRoute } from "./flow-route";

describe("flowRoute — страница flow в плагине Flow", () => {
  it("ведёт на панель flows плагина flow с id в адресе", () => {
    expect(flowRoute("flow-mu5nydp60tjt")).toBe("/plugins/flow/flows/flow-mu5nydp60tjt");
  });

  it("id с разделителями кодируется и читается обратно", () => {
    for (const id of ["flow-a", "a/b", "с пробелом", "?#%"]) {
      const route = flowRoute(id);
      expect(route.startsWith("/plugins/flow/flows/")).toBe(true);
      expect(decodeURIComponent(route.slice("/plugins/flow/flows/".length))).toBe(id);
    }
  });
});
