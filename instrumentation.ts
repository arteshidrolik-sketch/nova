// Sunucu açılışında bir kez çalışır. Loop'ları zamanlamak için hafif bir
// in-process scheduler kurar (dakikada bir cron kontrolü).
// Kapatmak için .env.local'a NOVA_SCHEDULER=off ekle.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NOVA_SCHEDULER === "off") return;

  // Dev HMR'da çift interval kurulmasını engelle
  const g = globalThis as unknown as { __novaScheduler?: boolean };
  if (g.__novaScheduler) return;
  g.__novaScheduler = true;

  const { LOOPS } = await import("@/lib/loops/registry");
  const { getLoopState } = await import("@/lib/loops/store");
  const { runLoop } = await import("@/lib/loops/run");
  const { cronMatches } = await import("@/lib/loops/cron");

  setInterval(async () => {
    const now = new Date();
    for (const loop of LOOPS) {
      try {
        const st = await getLoopState(loop.id);
        if (!st.enabled) continue;
        if (!cronMatches(loop.schedule, now)) continue;
        // aynı dakikada tekrar çalıştırma
        if (st.lastRunTs && Date.now() - st.lastRunTs < 60_000) continue;
        await runLoop(loop.id);
      } catch {
        /* zamanlanmış hata sessiz; UI'da lastStatus=failed görünür */
      }
    }
  }, 60_000);
}
