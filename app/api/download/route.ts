// Üretilen görseli indirmek için proxy (Content-Disposition: attachment).
// Cross-origin fal URL'lerini güvenle indirilebilir yapar. SSRF'e karşı sadece
// fal.media host'una izin verilir (açık proxy değil).
export const runtime = "nodejs";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const target = u.searchParams.get("url") || "";
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("Geçersiz URL", { status: 400 });
  }
  if (parsed.protocol !== "https:" || !/(^|\.)fal\.media$/.test(parsed.hostname)) {
    return new Response("İzin verilmeyen kaynak", { status: 403 });
  }
  let r: Response;
  try {
    r = await fetch(parsed.toString());
  } catch {
    return new Response("Görsel alınamadı", { status: 502 });
  }
  if (!r.ok) return new Response("Görsel alınamadı", { status: 502 });
  const ct = r.headers.get("content-type") || "image/jpeg";
  const ext = ct.includes("png")
    ? "png"
    : ct.includes("webp")
      ? "webp"
      : ct.includes("gif")
        ? "gif"
        : "jpg";
  const buf = await r.arrayBuffer();
  return new Response(buf, {
    headers: {
      "Content-Type": ct,
      "Content-Disposition": `attachment; filename="nova-gorsel.${ext}"`,
      "Cache-Control": "no-store",
    },
  });
}
