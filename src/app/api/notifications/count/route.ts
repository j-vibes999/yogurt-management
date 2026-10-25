import { NextResponse } from "next/server";
import { getNotificationsData } from "@/lib/db-data";
export async function GET() { const { alerts } = await getNotificationsData(); return NextResponse.json({ count: alerts.filter((a) => a.id !== "all-clear").length }); }
