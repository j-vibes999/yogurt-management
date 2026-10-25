"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { GlobalSearch } from "@/components/global-search";
import { ToastCenter } from "@/components/toast-center";
import { SHELL_INVALIDATE_EVENT } from "@/lib/operation-request";
import { Settings, LayoutDashboard, Map, Store, RefreshCw, Route, ReceiptText, Boxes, Factory, Refrigerator, CircleDollarSign, ChartNoAxesColumnIncreasing, Bell, Plus, Menu, ChevronDown, LogOut, X } from "lucide-react";

type IconName = "settings" | "dashboard" | "map" | "store" | "refill" | "route" | "settle" | "inventory" | "production" | "fridge" | "expense" | "report" | "bell" | "plus" | "menu";
type Role = "admin" | "production" | "driver";
type NavItem = { href: string; label: string; icon: IconName; roles?: Role[]; badgeKey?: "refill"|"driver"|"settlements"|"inventory" };
type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  { label: "ວຽກຫຼັກ", items: [
    { href: "/", label: "ມື້ນີ້", icon: "dashboard" },
    { href: "/stores", label: "ຮ້ານຄ້າ", icon: "store" },
    { href: "/map", label: "ແຜນທີ່", icon: "map" },
    { href: "/refills", label: "ເຕີມສິນຄ້າ", icon: "refill", badgeKey: "refill" },
    { href: "/driver", label: "ກວດຮ້ານ", icon: "route", roles: ["admin", "driver"], badgeKey: "driver" },
    { href: "/settlements", label: "ຮັບເງິນ", icon: "settle", roles: ["admin", "driver"], badgeKey: "settlements" },
  ]},
  { label: "ສາງ & ຜະລິດ", items: [
    { href: "/inventory", label: "ວັດຖຸດິບ", icon: "inventory", roles: ["admin", "production"], badgeKey: "inventory" },
    { href: "/production", label: "ຜະລິດ Yogurt", icon: "production", roles: ["admin", "production"] },
  ]},
  { label: "ການເງິນ", items: [
    { href: "/expenses", label: "ລາຍຈ່າຍ", icon: "expense", roles: ["admin"] },
    { href: "/reports", label: "ລາຍງານ", icon: "report", roles: ["admin"] },
  ]},
  { label: "ຈັດການລະບົບ", items: [
    { href: "/operations", label: "ຈັດການລະບົບ", icon: "settings", roles: ["admin"] },
  ]},
];

const allItems = navGroups.flatMap((group) => group.items);
const offlineNavigation = new Set(["/", "/stores", "/map", "/refills", "/driver", "/settlements", "/expenses", "/reports"]);
const mobileItems: NavItem[] = [
  { href: "/", label: "ມື້ນີ້", icon: "dashboard" },
  { href: "/stores", label: "ຮ້ານ", icon: "store" },
  { href: "/refills", label: "ເຕີມສິນຄ້າ", icon: "refill", roles: ["admin", "driver"] },
  { href: "/driver", label: "ກວດຮ້ານ", icon: "route", roles: ["admin", "driver"], badgeKey: "driver" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const icons = {
    settings: Settings, dashboard: LayoutDashboard, map: Map, store: Store, refill: RefreshCw,
    route: Route, settle: ReceiptText, inventory: Boxes, production: Factory, fridge: Refrigerator,
    expense: CircleDollarSign, report: ChartNoAxesColumnIncreasing, bell: Bell, plus: Plus, menu: Menu,
  } satisfies Record<IconName, typeof Settings>;
  const IconComponent = icons[name];
  return <IconComponent size={size} strokeWidth={1.9} aria-hidden="true" />;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(false);
  const sidebarId = useId();
  const quickId = useId();
  const accountId = useId();
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarCloseRef = useRef<HTMLButtonElement>(null);
  const sidebarOpenerRef = useRef<HTMLButtonElement>(null);
  const quickRef = useRef<HTMLDivElement>(null);
  const quickButtonRef = useRef<HTMLButtonElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const [session, setSession] = useState<{ fullName: string; role: Role } | null>(null);
  const [offline, setOffline] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const [navCounts, setNavCounts] = useState<Record<string, number>>({});
  const [routeMotion, setRouteMotion] = useState(false);
  useEffect(() => {
    setMenuOpen(false);
    setQuickOpen(false);
    setAccountOpen(false);
  }, [pathname]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1040px)");
    const update = () => {
      setMobileViewport(media.matches);
      if (!media.matches) setMenuOpen(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!quickOpen && !accountOpen) return;
    const dismissOutside = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (quickOpen && !quickRef.current?.contains(target)) setQuickOpen(false);
      if (accountOpen && !accountRef.current?.contains(target)) setAccountOpen(false);
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (accountOpen) {
        setAccountOpen(false);
        accountButtonRef.current?.focus();
      } else {
        setQuickOpen(false);
        quickButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissWithEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissWithEscape);
    };
  }, [quickOpen, accountOpen]);
  useEffect(() => {
    if (!menuOpen) return;
    // Capture the opener before making the main content inert, which may blur it.
    const previousFocus = sidebarOpenerRef.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    sidebarCloseRef.current?.focus();
    const keepFocusInSidebar = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const controls = sidebarRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]');
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keepFocusInSidebar);
    const scrollY = window.scrollY;
    const body = document.body;
    const html = document.documentElement;
    const previous = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow, htmlOverflow: html.style.overflow, htmlOverscroll: html.style.overscrollBehavior };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    const preventBackgroundTouch = (event: TouchEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".sidebar .nav")) return;
      event.preventDefault();
    };
    document.addEventListener("touchmove", preventBackgroundTouch, { passive: false });
    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      html.style.overflow = previous.htmlOverflow;
      html.style.overscrollBehavior = previous.htmlOverscroll;
      document.removeEventListener("touchmove", preventBackgroundTouch);
      document.removeEventListener("keydown", keepFocusInSidebar);
      window.scrollTo(0, scrollY);
      if (previousFocus?.isConnected && previousFocus.getClientRects().length) previousFocus.focus({ preventScroll: true });
    };
  }, [menuOpen]);
  useEffect(() => {
    if (pathname === "/login") return;
    setRouteMotion(true);
    const timer = window.setTimeout(() => setRouteMotion(false), 180);
    return () => window.clearTimeout(timer);
  }, [pathname]);
  useEffect(() => {
    if (pathname === "/login") return;
    let controller: AbortController | undefined;
    const refreshShell = () => {
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      fetch("/api/shell-state", { cache: "no-store", signal: requestController.signal })
      .then((r) => r.ok ? r.json() : null)
      .then(async (data) => {
        if (requestController.signal.aborted) return;
        if (!data) {
          const fallback = await fetch("/api/session", { cache: "no-store", signal: requestController.signal });
          if (fallback.ok) {
            const offline = await fallback.json();
            if (requestController.signal.aborted) return;
            if (offline.source === "offline") { setSession(offline); setOffline(true); }
          }
          return;
        }
        if (data.session) setSession(data.session);
        setOffline(false);
        setAlertCount(data.alertCount ?? 0);
        if (data.navCounts) setNavCounts(data.navCounts);
      })
      .catch((error) => { if (error?.name !== "AbortError") return null; });
    };
    refreshShell();
    window.addEventListener(SHELL_INVALIDATE_EVENT, refreshShell);
    return () => {
      controller?.abort();
      window.removeEventListener(SHELL_INVALIDATE_EVENT, refreshShell);
    };
  }, [pathname]);
  const visibleGroups = navGroups.map((group) => ({ ...group, items: group.items.filter((item) => (!offline || offlineNavigation.has(item.href)) && (!item.roles || (session && item.roles.includes(session.role)))) })).filter((group) => group.items.length);
  const current = allItems.find((item) => isActive(pathname, item.href));
  const currentGroup = navGroups.find((group) => group.items.some((item) => isActive(pathname, item.href)));
  const fullName = session?.fullName ?? "Owner";
  const roleLabel = session?.role === "driver" ? "ພະນັກງານສົ່ງ" : session?.role === "production" ? "ຝ່າຍຜະລິດ" : "ຜູ້ຈັດການ";
  const initial = Array.from(fullName)[0]?.toUpperCase() ?? "O";

  if (pathname === "/login") return <>{children}</>;

  return (
    <div className={`app-shell ${menuOpen ? "is-menu-open" : ""}`}>
      <button type="button" className={`sidebar-backdrop ${menuOpen ? "is-visible" : ""}`} aria-label="ປິດເມນູ" tabIndex={-1} aria-hidden="true" onClick={() => setMenuOpen(false)} />

      <aside className={`sidebar ${menuOpen ? "is-open" : ""}`} id={sidebarId} ref={sidebarRef} inert={mobileViewport && !menuOpen} role={menuOpen ? "dialog" : undefined} aria-modal={menuOpen || undefined} aria-label="ເມນູຫຼັກ">
        <div className="sidebar-head">
          <Link prefetch={false} href="/" className="brand" aria-label="Yogurt Manager" onClick={() => setMenuOpen(false)}>
            <span className="brand-mark"><BrandMark /></span>
            <span className="brand-copy"><strong>Yogurt Manager</strong><small>ລະບົບຈັດການໂຢເກີດ</small></span>
          </Link>
          <button className="sidebar-close" type="button" aria-label="ປິດເມນູ" ref={sidebarCloseRef} onClick={() => setMenuOpen(false)}><X size={20} aria-hidden="true" /></button>
        </div>

        <nav className="nav" aria-label="ເມນູຫຼັກ">
          {visibleGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link prefetch={false} key={item.href} href={item.href} className={active ? "is-active" : undefined} aria-current={active ? "page" : undefined} onClick={() => setMenuOpen(false)}>
                    <span className="nav-icon"><Icon name={item.icon} size={18} /></span>
                    <span className="nav-item-copy">{item.label}</span>{item.badgeKey && (navCounts[item.badgeKey] ?? 0) > 0 && <span className="nav-count-v1">{navCounts[item.badgeKey] > 99 ? "99+" : navCounts[item.badgeKey]}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="owner-avatar" aria-hidden="true">{initial}</div>
          <div><strong>{fullName}</strong><span>{roleLabel}</span></div>
          <form action="/api/auth/logout" method="post" className="logout-form"><button type="submit" title="ອອກຈາກລະບົບ" aria-label="ອອກຈາກລະບົບ"><LogOut size={18} aria-hidden="true" /></button></form>
          <span className="ພ້ອມໃຊ້ງານ-dot" title="ພ້ອມໃຊ້ງານ" />
        </div>
      </aside>

      <ToastCenter />
      <main className="main" inert={menuOpen}>
        <header className="topbar">
          <div className="topbar-left">
            <button className="menu-button" type="button" aria-label="ເປີດເມນູ" aria-expanded={menuOpen} aria-controls={sidebarId} onClick={(event) => { sidebarOpenerRef.current = event.currentTarget; setMenuOpen(true); }}><Icon name="menu" size={21} /></button>
            <div className="topbar-title">
              <span className="topbar-breadcrumb">{currentGroup?.label ?? "Yogurt Manager"}</span>
              <strong>{current?.label ?? "Yogurt Manager"}</strong>
            </div>
          </div>
          <GlobalSearch />
          <div className="topbar-actions">
            {pathname === "/" && !offline && <div className="quick-action-wrap-v4" ref={quickRef}>
              <button type="button" className="quick-action" ref={quickButtonRef} aria-expanded={quickOpen} aria-controls={quickId} onClick={() => { setAccountOpen(false); setQuickOpen((value) => !value); }}><Icon name="plus" size={16} /><span>ສ້າງລາຍການ</span></button>
              {quickOpen && (
                <div className="quick-action-menu-v4" id={quickId}>
                  {(session?.role === "admin" || session?.role === "driver") && <Link prefetch={false} href="/refills/new" onClick={() => setQuickOpen(false)}><span aria-hidden="true">↻</span><div><strong>ສ້າງຄຳຂໍເຕີມສິນຄ້າ</strong><small>ເຕີມສິນຄ້າໃຫ້ຮ້ານ</small></div></Link>}
                  {(session?.role === "admin" || session?.role === "production") && <Link prefetch={false} href="/inventory/receive" onClick={() => setQuickOpen(false)}><span aria-hidden="true">↓</span><div><strong>ຮັບວັດຖຸດິບ</strong><small>ຊື້ເຂົ້າສາງ</small></div></Link>}
                  {session?.role === "admin" && <Link prefetch={false} href="/expenses/new" onClick={() => setQuickOpen(false)}><span aria-hidden="true">₭</span><div><strong>ບັນທຶກລາຍຈ່າຍ</strong><small>ລາຍຈ່າຍປະຈຳວັນ</small></div></Link>}
                </div>
              )}
            </div>}
            <Link prefetch={false} href="/notifications" className="notification-button" aria-label={alertCount > 0 ? `ແຈ້ງເຕືອນ ${alertCount} ລາຍການ` : "ແຈ້ງເຕືອນ"}><Icon name="bell" size={19} />{alertCount > 0 && <span className="notification-badge-v5" aria-hidden="true">{alertCount > 9 ? "9+" : alertCount}</span>}</Link>
            <div className="account-menu" ref={accountRef}>
              <button type="button" className="topbar-profile-v36" ref={accountButtonRef} aria-label={`ເມນູບັນຊີ ${fullName}`} aria-expanded={accountOpen} aria-controls={accountId} onClick={() => { setQuickOpen(false); setAccountOpen((value) => !value); }}>
                <span className="topbar-avatar-v36" aria-hidden="true">{initial}</span>
                <span className="account-trigger-copy"><strong>{fullName}</strong><small>{roleLabel}</small></span>
                <ChevronDown className="topbar-chevron-v36" size={16} aria-hidden="true" />
              </button>
              {accountOpen && <div className="account-menu-panel" id={accountId}>
                <div className="account-menu-identity"><strong>{fullName}</strong><span>{roleLabel}</span></div>
                <form action="/api/auth/logout" method="post"><button type="submit"><LogOut size={17} aria-hidden="true" /><span>ອອກຈາກລະບົບ</span></button></form>
              </div>}
            </div>
          </div>
        </header>

        <div className={`page-stage ${routeMotion ? "is-route-entering-safe" : ""}`}>{children}</div>

        <nav className="mobile-bottom-nav" aria-label="ເມນູດ່ວນມືຖື">
          {mobileItems.filter((item) => !item.roles || (session && item.roles.includes(session.role))).map((item) => {
            const active = isActive(pathname, item.href);
            return <Link prefetch={false} key={item.href} href={item.href} className={active ? "is-active" : undefined} aria-current={active ? "page" : undefined}><span className="mobile-nav-icon-v11"><Icon name={item.icon} size={19}/></span><span className="mobile-nav-label-v11">{item.label}</span></Link>;
          })}
          <button type="button" onClick={(event) => { sidebarOpenerRef.current = event.currentTarget; setMenuOpen(true); }} aria-label="ເມນູອື່ນ" aria-expanded={menuOpen} aria-controls={sidebarId}><span className="mobile-nav-icon-v11"><Icon name="menu" size={19}/></span><span className="mobile-nav-label-v11">ອື່ນໆ</span></button>
        </nav>
      </main>
    </div>
  );
}
