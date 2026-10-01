import { describe, expect, it } from "vitest";
import { planned } from "../test-support/planned.js";

const connectPath = "./database-connect.js";
const { tokenSource, planConnect } = await planned<typeof import("./database-connect.js")>(() => import(/* @vite-ignore */ connectPath));

describe("which token opens the database", () => {
  it("the one typed wins, then the one in the address, then the one saved for that address", () => {
    expect(tokenSource({ token: "typed" }, { token: "in-address" }, "saved")).toEqual({ kind: "given", token: "typed" });
    expect(tokenSource({}, { token: "in-address" }, "saved")).toEqual({ kind: "given", token: "in-address" });
    expect(tokenSource({ token: null }, { token: null }, "saved")).toEqual({ kind: "given", token: "saved" });
  });

  it("with none of them, the service mints one through Turso", () => {
    expect(tokenSource({}, { token: null }, null)).toEqual({ kind: "mint" });
    expect(tokenSource({ token: "  " }, { token: null }, null)).toEqual({ kind: "mint" });
  });
});

describe("what connecting does with the database it opened", () => {
  const folder = { id: "01HZZZZZZZZZZZZZZZZZZZZZP1", name: "Tasks", prefix: "TSK" };
  const empty = { board: null, taskCount: 0 };
  const holding = { board: { name: "Remote", prefix: "REM" }, taskCount: 4 };

  it("moves a folder board into an empty database under the folder board's own name and prefix", () => {
    expect(planConnect({ moveFrom: folder, name: "ignored", prefix: "IGN" }, empty)).toEqual({ kind: "move", boardId: folder.id, name: "Tasks", prefix: "TSK" });
  });

  it("refuses to move into a database that holds a board or tasks", () => {
    expect(planConnect({ moveFrom: folder }, holding)).toMatchObject({ kind: "refuse", code: "database_not_empty" });
    expect(planConnect({ moveFrom: folder }, { board: null, taskCount: 1 })).toMatchObject({ kind: "refuse", code: "database_not_empty" });
  });

  it("takes the name and prefix of the board the database already holds", () => {
    expect(planConnect({ moveFrom: null, name: "Mine", prefix: "MIN" }, holding)).toEqual({ kind: "adopt", name: "Remote", prefix: "REM" });
    expect(planConnect({ moveFrom: null }, holding)).toEqual({ kind: "adopt", name: "Remote", prefix: "REM" });
  });

  it("starts an empty database with the name and prefix given", () => {
    expect(planConnect({ moveFrom: null, name: " Remote ", prefix: "rem" }, empty)).toEqual({ kind: "fresh", name: "Remote", prefix: "REM" });
  });

  it("refuses an empty database without a name or a prefix to give its board", () => {
    expect(planConnect({ moveFrom: null }, empty)).toMatchObject({ kind: "refuse", code: "folder_connect_failed" });
    expect(planConnect({ moveFrom: null, name: "Remote", prefix: "" }, empty)).toMatchObject({ kind: "refuse", code: "folder_connect_failed" });
  });
});
