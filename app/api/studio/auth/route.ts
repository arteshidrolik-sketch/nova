// Admin (Stüdyo) şifre doğrulaması — şifre sunucu ortamında (NOVA_ADMIN_PW), koda gömülü değil.
export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { pw?: string };
  const expected = process.env.NOVA_ADMIN_PW || "";
  const ok = !!expected && String(b.pw ?? "") === expected;
  return Response.json({ ok });
}
