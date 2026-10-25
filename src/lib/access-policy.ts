import type { UserRole } from "@/lib/auth-session";

export function rolesForPage(pathname:string):UserRole[]|null{
  if(pathname.startsWith('/uploads/receipts/')) return ['admin'];
  if(pathname.startsWith('/production')||pathname.startsWith('/inventory')) return ['admin','production'];
  if(pathname.startsWith('/driver')||pathname.startsWith('/settlements')) return ['admin','driver'];
  if(pathname.startsWith('/expenses')||pathname.startsWith('/reports')||pathname.startsWith('/audit-log')||pathname.startsWith('/operations')) return ['admin'];
  if(pathname.startsWith('/stores/new')||/^\/stores\/[^/]+\/edit$/.test(pathname)||pathname.startsWith('/fridges')) return ['admin'];
  if(pathname.startsWith('/refills/new')) return ['admin','driver'];
  return null;
}

export function rolesForApi(pathname:string,method:string):UserRole[]|null{
  if(pathname==='/api/health'||pathname==='/api/session') return null;
  if(pathname.startsWith('/api/metrics/web-vitals')||pathname.startsWith('/api/shell-state')||pathname.startsWith('/api/nav-counts')||pathname.startsWith('/api/notifications')||pathname.startsWith('/api/search')||pathname.startsWith('/api/map/search')||pathname.startsWith('/api/auth/logout')) return null;
  if(pathname.startsWith('/api/production-batches')||pathname.startsWith('/api/inventory/')||pathname.startsWith('/api/finished-goods/adjust')||pathname.startsWith('/api/recipes')) return ['admin','production'];
  if(pathname.startsWith('/api/refills')||pathname.startsWith('/api/restock-visits')||pathname.startsWith('/api/settlements')) return ['admin','driver'];
  if(pathname.startsWith('/api/materials')||pathname.startsWith('/api/products')) return ['GET','HEAD'].includes(method)?['admin','production']:['admin'];
  if(pathname.startsWith('/api/stores')) return ['GET','HEAD'].includes(method)?null:['admin'];
  if(pathname.startsWith('/api/fridges')||pathname.startsWith('/api/expenses')||pathname.startsWith('/api/expense-categories')||pathname.startsWith('/api/users')||pathname.startsWith('/api/daily-closing')||pathname.startsWith('/api/uploads/receipts')||pathname.startsWith('/api/receipts/')) return ['admin'];
  return ['admin'];
}
