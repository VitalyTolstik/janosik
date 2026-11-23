import { Component, type ReactNode } from "react";

/**
 * Local error boundary for the lazy saved-views menu (TASK-177.20).
 *
 * A rejected `savedviews` chunk is a secondary-feature failure: the board and
 * its filter must keep working. Letting the rejection bubble to the app-level
 * boundary would offer the destructive "erase local data" recovery for a
 * missing menu, so this boundary swallows it and keeps the reserved slot.
 */
export class SavedViewsMenuBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
