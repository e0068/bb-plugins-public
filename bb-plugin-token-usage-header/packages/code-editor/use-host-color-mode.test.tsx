import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useHostColorMode } from "./use-host-color-mode";

function Probe() {
  return <span>{useHostColorMode()}</span>;
}

afterEach(() => {
  document.documentElement.style.colorScheme = "";
});

describe("useHostColorMode", () => {
  it("берёт схему, объявленную хостом", async () => {
    document.documentElement.style.colorScheme = "dark";
    render(<Probe />);
    expect(await screen.findByText("dark")).toBeInTheDocument();
  });

  it("светлая схема хоста читается так же", async () => {
    document.documentElement.style.colorScheme = "light";
    render(<Probe />);
    expect(await screen.findByText("light")).toBeInTheDocument();
  });

  // Хост может ничего не объявлять — тогда единственный честный ответ даёт
  // системная настройка, а не догадка в пользу светлой темы.
  it("без объявления хоста падает на системную настройку", async () => {
    render(<Probe />);
    expect(await screen.findByText("light")).toBeInTheDocument();
  });

  it("следит за сменой темы на лету", async () => {
    document.documentElement.style.colorScheme = "light";
    render(<Probe />);
    expect(await screen.findByText("light")).toBeInTheDocument();

    document.documentElement.style.colorScheme = "dark";
    await waitFor(() => expect(screen.getByText("dark")).toBeInTheDocument());
  });
});
