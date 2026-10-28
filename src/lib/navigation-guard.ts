type LinkOptions = { target?: string; download?: boolean };
type LinkClick = { button: number; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean };

export function shouldWarnForLink(current: string, href: string, link: LinkOptions, event: LinkClick): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || link.download || (link.target && link.target !== "_self")) return false;
  try {
    const from = new URL(current);
    const to = new URL(href, from);
    return ["http:", "https:"].includes(to.protocol) && (from.origin !== to.origin || from.pathname !== to.pathname || from.search !== to.search);
  } catch { return false; }
}
