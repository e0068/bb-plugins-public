// Граница ошибок: чужой компонент (встроенный список bb) упал при отрисовке — вместо него `fallback`, а не плашка «stopped working» хоста.
import { Component, type ReactNode } from "react";

type Props = { fallback: ReactNode; children: ReactNode };

export class RenderGuard extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
