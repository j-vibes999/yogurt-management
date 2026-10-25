// Route segment config must be written here literally; Next.js cannot read a re-exported `runtime`.
export const runtime = "nodejs";
export { GET, HEAD } from "@/app/api/receipts/[name]/route";
