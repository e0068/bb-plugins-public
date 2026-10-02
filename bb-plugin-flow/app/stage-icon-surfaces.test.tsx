// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ProgressStage } from "../shared/contract";
import { StageIcon } from "./progress-banner";

afterEach(cleanup);

const row = (patch: Partial<ProgressStage> = {}): ProgressStage => ({ id: "spec", kind: "skill", name: "Spec", executor: "self", state: "todo", results: [], minutes: null, cost: null, ...patch });

describe("иконка этапа в полосе прогресса", () => {
  it("выбранная владельцем иконка стоит вместо иконки вида и логотипа исполнителя", () => {
    const { container } = render(<StageIcon stage={row({ icon: "Rocket", kind: "questions" })} />);
    expect(container.querySelector('[data-icon="Rocket"]')).not.toBeNull();
  });

  it("имя вне подборки — иконка по виду", () => {
    const { container } = render(<StageIcon stage={row({ icon: "NoSuchIcon", kind: "questions" })} />);
    expect(container.querySelector('[data-icon="NoSuchIcon"]')).toBeNull();
    expect(container.querySelector('[data-icon="MessageQuestion"]')).not.toBeNull();
  });
});
