// Görsel üretim işleri (bellek-içi). POST işi başlatır ve hemen jobId döner;
// üretim arka planda sürer; istemci GET ile yoklar. Böylece uzun üretim
// (soğuk başlatma / ilk model yükleme) proxy (Cloudflare 100sn) bağlantısını
// kesse bile iş kaybolmaz — görsel hazır olunca yoklamada gelir.
export type JobStatus = "starting" | "generating" | "done" | "error";
export type ImageJob = {
  id: string; status: JobStatus; ts: number;
  image?: string; seed?: number; usedPrompt?: string; error?: string; note?: string;
};

const JOBS = new Map<string, ImageJob>();
const TTL = 15 * 60_000; // 15 dk sonra temizle

function sweep() {
  const now = Date.now();
  for (const [id, j] of JOBS) if (now - j.ts > TTL) JOBS.delete(id);
}

export function createJob(id: string): void {
  sweep();
  JOBS.set(id, { id, status: "starting", ts: Date.now() });
}
export function updateJob(id: string, patch: Partial<ImageJob>): void {
  const j = JOBS.get(id);
  if (j) JOBS.set(id, { ...j, ...patch, ts: Date.now() });
}
export function getJob(id: string): ImageJob | null {
  return JOBS.get(id) ?? null;
}
