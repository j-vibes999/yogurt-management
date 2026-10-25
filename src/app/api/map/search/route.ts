import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = String(url.searchParams.get("q") ?? "").trim();
  if (!query) return NextResponse.json({ results: [] });
  if (query.length > 180) return NextResponse.json({ error: "ຄຳຄົ້ນຫາຍາວເກີນໄປ" }, { status: 400 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const endpoint = new URL("https://nominatim.openstreetmap.org/search");
    endpoint.searchParams.set("format", "jsonv2");
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("countrycodes", "la");
    endpoint.searchParams.set("limit", "5");
    endpoint.searchParams.set("addressdetails", "0");

    const response = await fetch(endpoint, {
      headers: {
        "User-Agent": "YogurtSuperWeb/1.0 local-business-map",
        "Accept-Language": "lo,en;q=0.8",
        Accept: "application/json",
      },
      signal: controller.signal,
      next: { revalidate: 3600 },
    });
    if (!response.ok) throw new Error(`Nominatim ${response.status}`);
    const payload = await response.json() as Array<{ place_id: number; display_name: string; lat: string; lon: string }>;
    const results = payload
      .filter((item) => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)))
      .map(({ place_id, display_name, lat, lon }) => ({ place_id, display_name, lat, lon }));
    return NextResponse.json({ results });
  } catch (error) {
    console.error("[map-search] failed", error);
    return NextResponse.json({ error: "ບໍລິການຄົ້ນຫາແຜນທີ່ບໍ່ພ້ອມໃຊ້ຊົ່ວຄາວ" }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
