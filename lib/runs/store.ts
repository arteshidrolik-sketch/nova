// Uzun süren sohbet işleri için arka plan "run" kaydı (bellek içi).
// Amaç: işi HTTP bağlantısından ayırmak. İstemci poll ile durumu alır; bağlantı
// kopsa bile iş sunucuda sürer ve istemci kaldığı yerden devam eder (takılmaz).

export type RunStatus = "running" | "done" | "error";

export type Run = {
  id: string;
  status: RunStatus;
  output: string;
  agent: string;
  model: string;
  error?: string;
  canceled?: boolean; // kullanıcı bu tek işi durdurdu (kill switch'ten farklı)
  createdAt: number;
  updatedAt: number;
};

const runs = new Map<string, Run>();
const MAX_AGE = 30 * 60 * 1000; // 30 dk sonra temizle

function sweep() {
  const now = Date.now();
  for (const [id, r] of runs) {
    if (now - r.updatedAt > MAX_AGE) runs.delete(id);
  }
}

export function createRun(id: string, agent: string, model: string): Run {
  sweep();
  const now = Date.now();
  const run: Run = {
    id,
    status: "running",
    output: "",
    agent,
    model,
    createdAt: now,
    updatedAt: now,
  };
  runs.set(id, run);
  return run;
}

export function appendRun(id: string, chunk: string): void {
  const r = runs.get(id);
  if (r) {
    r.output += chunk;
    r.updatedAt = Date.now();
  }
}

export function finishRun(id: string, status: RunStatus, error?: string): void {
  const r = runs.get(id);
  if (r) {
    r.status = status;
    if (error) r.error = error;
    r.updatedAt = Date.now();
  }
}

export function getRun(id: string): Run | undefined {
  return runs.get(id);
}

// Tek bir işi durdur (kullanıcı "Durdur" dedi). Sunucu döngüsü bunu görüp
// akışı keser → boşuna token yakılmaz.
export function cancelRun(id: string): void {
  const r = runs.get(id);
  if (r) {
    r.canceled = true;
    r.updatedAt = Date.now();
  }
}

export function isCanceled(id: string): boolean {
  return runs.get(id)?.canceled ?? false;
}
