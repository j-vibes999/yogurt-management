"use client";

import { useLayoutEffect, useRef } from "react";

function pagePosition() {
  const root = document.scrollingElement ?? document.documentElement;
  return { x: root.scrollLeft || window.scrollX || 0, y: root.scrollTop || window.scrollY || 0 };
}

export function useModalScrollLock(active: boolean) {
  const saved = useRef({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!active) return;

    saved.current = pagePosition();
    const { x, y } = saved.current;
    const body = document.body;
    const html = document.documentElement;
    const root = document.scrollingElement ?? html;
    const previous = {
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
      bodyOverflow: body.style.overflow,
      htmlOverflow: html.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
      rootScrollBehavior: (root as HTMLElement).style.scrollBehavior,
    };

    body.style.position = "fixed";
    body.style.top = `-${y}px`;
    body.style.left = `-${x}px`;
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";

    return () => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement) focused.blur();

      body.style.position = previous.bodyPosition;
      body.style.top = previous.bodyTop;
      body.style.left = previous.bodyLeft;
      body.style.right = previous.bodyRight;
      body.style.width = previous.bodyWidth;
      body.style.overflow = previous.bodyOverflow;
      html.style.overflow = previous.htmlOverflow;
      html.style.overscrollBehavior = previous.htmlOverscroll;
      (root as HTMLElement).style.scrollBehavior = "auto";

      const restore = () => {
        root.scrollLeft = x;
        root.scrollTop = y;
        window.scrollTo({ left: x, top: y, behavior: "auto" });
      };

      restore();
      requestAnimationFrame(() => requestAnimationFrame(restore));
      window.setTimeout(restore, 80);
      window.setTimeout(() => {
        restore();
        (root as HTMLElement).style.scrollBehavior = previous.rootScrollBehavior;
      }, 240);
    };
  }, [active]);
}

export function focusWithoutScroll(element: HTMLElement | null) {
  if (!element) return;
  try { element.focus({ preventScroll: true }); }
  catch { element.focus(); }
}
