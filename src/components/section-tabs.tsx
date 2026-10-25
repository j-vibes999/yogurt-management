"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

type SectionTab = { key: string; label: string; content: ReactNode };

export function SectionTabs({ tabs, defaultKey, label = "ໝວດຂໍ້ມູນ" }: { tabs: SectionTab[]; defaultKey?: string; label?: string }) {
  const id = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [key, setKey] = useState(defaultKey ?? tabs[0]?.key ?? "");
  const selectedIndex = Math.max(0, tabs.findIndex((tab) => tab.key === key));

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight": nextIndex = (index + 1) % tabs.length; break;
      case "ArrowLeft": nextIndex = (index - 1 + tabs.length) % tabs.length; break;
      case "Home": nextIndex = 0; break;
      case "End": nextIndex = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    setKey(tabs[nextIndex].key);
    buttons.current[nextIndex]?.focus();
  }

  if (!tabs.length) return null;

  return (
    <>
      <div className="section-tabs-v1" role="tablist" aria-label={label} aria-orientation="horizontal">
        {tabs.map((tab, index) => (
          <button
            type="button"
            role="tab"
            id={`${id}-tab-${index}`}
            aria-controls={`${id}-panel-${index}`}
            aria-selected={selectedIndex === index}
            tabIndex={selectedIndex === index ? 0 : -1}
            className={selectedIndex === index ? "is-active" : undefined}
            key={tab.key}
            ref={(element) => { buttons.current[index] = element; }}
            onClick={() => setKey(tab.key)}
            onKeyDown={(event) => navigate(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, index) => (
        <div
          className="section-tab-panel-v1"
          role="tabpanel"
          id={`${id}-panel-${index}`}
          aria-labelledby={`${id}-tab-${index}`}
          key={tab.key}
          hidden={selectedIndex !== index}
          tabIndex={selectedIndex === index ? 0 : undefined}
        >
          {selectedIndex === index ? tab.content : null}
        </div>
      ))}
    </>
  );
}
