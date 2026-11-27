import type { KeyboardEvent, RefObject } from "react";

import { inspectorPanelId, inspectorTabId } from "@/hooks/use-board-inspector";
import { useI18n } from "@/i18n";
import { INSPECTOR_TABS, type InspectorTab } from "@/utils/board-panel-storage";

export function InspectorTabs({
  tab,
  onChange,
  tabRef,
}: {
  tab: InspectorTab;
  onChange: (tab: InspectorTab) => void;
  tabRef: RefObject<HTMLButtonElement>;
}) {
  const { t } = useI18n();

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    let next: number;
    const index = INSPECTOR_TABS.indexOf(tab);
    const last = INSPECTOR_TABS.length - 1;
    switch (event.key) {
      case "ArrowRight":
        next = index === last ? 0 : index + 1;
        break;
      case "ArrowLeft":
        next = index === 0 ? last : index - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    const choice = INSPECTOR_TABS[next];
    onChange(choice);
    event.currentTarget
      .querySelector<HTMLButtonElement>(`#${inspectorTabId(choice)}`)
      ?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={t("inspector.title")}
      onKeyDown={navigate}
      className="shrink-0 border-b px-4"
    >
      {INSPECTOR_TABS.map((choice) => (
        <button
          key={choice}
          ref={choice === tab ? tabRef : undefined}
          id={inspectorTabId(choice)}
          type="button"
          role="tab"
          aria-selected={choice === tab}
          aria-controls={inspectorPanelId(choice)}
          tabIndex={choice === tab ? 0 : -1}
          className="inspector-tab border-b-2 border-transparent px-2 text-ui-body font-medium focus-visible:outline-ring aria-selected:border-primary"
          onClick={() => onChange(choice)}
        >
          {t("people.title")}
        </button>
      ))}
    </div>
  );
}
