// @vitest-environment node
import { describe, expect, it } from "vitest";

import { fileTarget, resultLink, stepDetail } from "./result-link";

describe("куда ведёт результат этапа", () => {
  it("адрес http и https — ссылка, путь от корня дерева — файл дерева, абсолютный путь — файл хоста", () => {
    expect(resultLink("https://github.com/e0068/bb-plugins/pull/1")).toEqual({ kind: "url", url: "https://github.com/e0068/bb-plugins/pull/1" });
    expect(resultLink("docs/specs/spec.md")).toEqual({ kind: "workspace", path: "docs/specs/spec.md" });
    expect(resultLink("/Users/me/.bb/thread-storage/thr_1/CEL-131/prototype.html")).toEqual({ kind: "absolute", path: "/Users/me/.bb/thread-storage/thr_1/CEL-131/prototype.html" });
  });

  it("абсолютный путь внутри хранилища треда открывается файлом хранилища, путь — от его корня", () => {
    const where = { threadId: "thr_1", hostId: "local", storageRootPath: "/Users/me/.bb/thread-storage/thr_1" };
    expect(fileTarget("/Users/me/.bb/thread-storage/thr_1/CEL-131/prototype.html", where)).toEqual({ kind: "thread-storage", threadId: "thr_1", path: "CEL-131/prototype.html" });
  });

  it("абсолютный путь вне хранилища, в том числе в соседнем треде с общим префиксом, — файл хоста", () => {
    const where = { threadId: "thr_1", hostId: "local", storageRootPath: "/Users/me/.bb/thread-storage/thr_1" };
    expect(fileTarget("/Users/me/.bb/thread-storage/thr_10/a.png", where)).toEqual({ kind: "host", hostId: "local", path: "/Users/me/.bb/thread-storage/thr_10/a.png" });
    expect(fileTarget("/tmp/report.md", where)).toEqual({ kind: "host", hostId: "local", path: "/tmp/report.md" });
  });

  it("корень хранилища со слешем на конце режет путь так же", () => {
    const where = { threadId: "thr_1", hostId: "local", storageRootPath: "/s/thr_1/" };
    expect(fileTarget("/s/thr_1/a/b.md", where)).toEqual({ kind: "thread-storage", threadId: "thr_1", path: "a/b.md" });
  });
});

describe("строка успеха шага", () => {
  it("адрес открывается ссылкой, схема из подписи убрана", () => {
    expect(stepDetail("https://github.com/o/r/pull/7")).toEqual({ kind: "link", url: "https://github.com/o/r/pull/7", label: "github.com/o/r/pull/7" });
  });

  it("не адрес — текст как есть", () => {
    expect(stepDetail("no linked tasks")).toEqual({ kind: "text", text: "no linked tasks" });
  });

  it("шаг, который ничего не сказал, не показывает пустоту", () => {
    expect(stepDetail(null)).toBeNull();
    expect(stepDetail("   ")).toBeNull();
  });
});
