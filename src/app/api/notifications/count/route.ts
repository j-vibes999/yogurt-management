import { NextResponse } from "next/server";
import { canRoleOpen } from "@/lib/access-policy";
import { getNotificationsData } from "@/lib/db-data";
import { getViewerRole } from "@/lib/server-session";
export async function GET() {
  const [{ alerts }, role] = await Promise.all([getNotificationsData(), getViewerRole()]);
  return NextResponse.json({ count: alerts.filter((a) => a.id !== "all-clear" && canRoleOpen(role, a.href)).length });
}
