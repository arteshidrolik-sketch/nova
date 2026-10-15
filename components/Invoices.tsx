"use client";

// Fatura sekmesi — kesin çözüm hattı:
// 1) Fotoğraf/PDF yükle → (büyük fotoğraflar okunabilirlik için bantlara bölünür)
// 2) Sunucu Claude'a şema-zorunlu okutur, aritmetik sağlama yapar
// 3) Kullanıcı alanları KONTROL EDİP kaydeder (insan onayı)
// 4) Defter birikir → tek tıkla Excel (Faturalar + Kalemler sayfaları)
import { useCallback, useEffect, useRef, useState } from "react";

type Item = {
  aciklama: string;
  miktar: number | null;
  birim: string | null;
  birim_fiyat: number | null;
  kdv_orani: number | null;
  tutar: number | null;
};
type Fields = {
  fatura_no: string | null;
  tarih: string | null;
  satici: string | null;
  satici_vkn: string | null;
  alici: string | null;
  alici_vkn: string | null;
  para_birimi: string | null;
  kalemler: Item[];
  mal_hizmet_toplam: number | null;
  iskonto: number | null;
  kdv_toplam: number | null;
  genel_toplam: number | null;
};
type Rec = Fields & {
  id: string;
  createdAt: number;
  kaynak: string;
  uyarilar: string[];
};

const EMPTY_ITEM: Item = {
  aciklama: "",
  miktar: null,
  birim: null,
  birim_fiyat: null,
  kdv_orani: null,
  tutar: null,
};

function readAsDataURL(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}

// Büyük fatura fotoğrafları: görüntü API tarafında ~1568px'e küçültüldüğünden
// küçük rakamlar okunmaz olur. Çözüm: uzun görselleri ÜST ÜSTE BİNEN yatay
// bantlara bölüp her bandı tam çözünürlükte göndermek. (EXIF dönüklüğü de
// burada düzeltilir.)
async function toPages(
  file: File,
): Promise<{ data: string; mediaType: string }[]> {
  if (file.type === "application/pdf") {
    const url = await readAsDataURL(file);
    return [{ data: url.split(",")[1], mediaType: "application/pdf" }];
  }
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const { width: w, height: h } = bmp;
  const LIMIT = 2200; // bu boyuta kadar tek parça yeterli
  const bands: { data: string; mediaType: string }[] = [];
  const draw = (sy: number, sh: number): string => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = sh;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(bmp, 0, sy, w, sh, 0, 0, w, sh);
    return c.toDataURL("image/jpeg", 0.92);
  };
  if (Math.max(w, h) <= LIMIT || h <= w) {
    bands.push({ data: draw(0, h).split(",")[1], mediaType: "image/jpeg" });
  } else {
    // dikey uzun fotoğraf: %12 bindirmeli bantlar (satırlar bölünmesin)
    const bandH = Math.min(1900, Math.ceil(h / Math.ceil(h / 1900)));
    const overlap = Math.round(bandH * 0.12);
    let y = 0;
    while (y < h && bands.length < 4) {
      const sh = Math.min(bandH, h - y);
      bands.push({ data: draw(y, sh).split(",")[1], mediaType: "image/jpeg" });
      if (y + sh >= h) break;
      y += bandH - overlap;
    }
  }
  bmp.close();
  return bands;
}

function fmtMoney(n: number | null, pb: string | null): string {
  if (n === null) return "—";
  return `${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${pb ?? "TRY"}`;
}

export default function Invoices() {
  const [records, setRecords] = useState<Rec[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // durum metni
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Fields | null>(null);
  const [draftWarns, setDraftWarns] = useState<string[]>([]);
  const [draftSource, setDraftSource] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await fetch("/api/invoice").then((r) => r.json());
      setRecords(Array.isArray(d.invoices) ? d.invoices : []);
    } catch {
      setRecords([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleFile(file: File | undefined | null) {
    if (!file) return;
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      setError("Fatura fotoğrafı (JPG/PNG) ya da PDF yükle.");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError(`${file.name} çok büyük (en fazla 12 MB).`);
      return;
    }
    setError(null);
    setDraft(null);
    try {
      setBusy("Görüntü hazırlanıyor…");
      const pages = await toPages(file);
      setBusy("Fatura okunuyor (10–30 sn)…");
      const r = await fetch("/api/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, pages }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      setDraft(d.fields as Fields);
      setDraftWarns(Array.isArray(d.uyarilar) ? d.uyarilar : []);
      setDraftSource(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Okuma hatası");
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    setBusy("Kaydediliyor…");
    try {
      const r = await fetch("/api/invoice", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: draft, kaynak: draftSource }),
      });
      if (!r.ok) throw new Error("Kaydedilemedi");
      setDraft(null);
      setDraftWarns([]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kayıt hatası");
    } finally {
      setBusy(null);
    }
  }

  async function del(id: string) {
    if (!confirm("Bu fatura kaydı silinsin mi?")) return;
    await fetch(`/api/invoice?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    load();
  }

  const setF = (patch: Partial<Fields>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));
  const setItem = (i: number, patch: Partial<Item>) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            kalemler: d.kalemler.map((k, j) => (j === i ? { ...k, ...patch } : k)),
          }
        : d,
    );
  const numVal = (s: string): number | null => {
    if (!s.trim()) return null;
    const n = Number(s.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  const inputCls =
    "w-full rounded-lg border bg-transparent px-2 py-1.5 text-sm outline-none";
  const inputStyle = {
    borderColor: "var(--border)",
    color: "var(--text)",
    background: "var(--bg-panel)",
  };
  const labelCls = "mb-1 block font-mono text-[11px] uppercase tracking-wider";

  return (
    <div className="mx-auto h-full w-full max-w-5xl overflow-y-auto px-4 py-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
            🧾 Fatura
          </h2>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Fotoğraf/PDF at → Nova okusun → kontrol et, kaydet → tek tıkla Excel.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={load}
            className="rounded-lg border px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            ↻ Yenile
          </button>
          {records.length > 0 && (
            <a
              href="/api/invoice?excel=1"
              className="btn-grad rounded-lg px-3 py-1.5 text-sm font-medium text-black"
              style={{ background: "var(--grad)" }}
            >
              📊 Excel indir
            </a>
          )}
        </div>
      </div>

      {/* Yükleme alanı */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFile(e.dataTransfer.files?.[0]);
        }}
        onClick={() => fileRef.current?.click()}
        className="glow-focus mb-4 cursor-pointer rounded-xl border border-dashed py-8 text-center"
        style={{ borderColor: "var(--border-strong)", color: "var(--text-muted)" }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {busy ? (
          <div className="text-sm" style={{ color: "var(--accent)" }}>
            <span className="typing align-middle">
              <span />
              <span />
              <span />
            </span>{" "}
            {busy}
          </div>
        ) : (
          <>
            <div className="text-3xl">🧾</div>
            <p className="mt-2 text-sm" style={{ color: "var(--text)" }}>
              Fatura fotoğrafını ya da PDF&apos;ini buraya bırak / tıkla seç
            </p>
            <p className="mt-1 text-xs">
              Telefon fotoğrafı da olur — büyük görseller otomatik netleştirilir.
            </p>
          </>
        )}
      </div>

      {error && (
        <div
          className="mb-4 rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "#ff5c7a", color: "#ff5c7a" }}
        >
          ⚠ {error}
        </div>
      )}

      {/* Okunan fatura — kontrol formu */}
      {draft && (
        <div
          className="card mb-5 rounded-xl border p-4"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
              Okunan fatura — kontrol et, gerekirse düzelt, sonra kaydet
            </h3>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {draftSource}
            </span>
          </div>

          {draftWarns.length > 0 && (
            <div
              className="mb-3 rounded-lg border px-3 py-2 text-xs leading-relaxed"
              style={{ borderColor: "#ffb454", color: "#ffb454" }}
            >
              {draftWarns.map((w, i) => (
                <div key={i}>⚠ {w}</div>
              ))}
            </div>
          )}

          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            {(
              [
                ["Fatura No", "fatura_no"],
                ["Tarih", "tarih"],
                ["Satıcı", "satici"],
                ["Satıcı VKN", "satici_vkn"],
                ["Alıcı", "alici"],
                ["Alıcı VKN", "alici_vkn"],
              ] as const
            ).map(([label, key]) => (
              <div key={key}>
                <label className={labelCls} style={{ color: "var(--text-muted)" }}>
                  {label}
                </label>
                <input
                  className={inputCls}
                  style={inputStyle}
                  value={draft[key] ?? ""}
                  onChange={(e) => setF({ [key]: e.target.value || null })}
                />
              </div>
            ))}
          </div>

          <div className="mb-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left font-mono text-[11px] uppercase tracking-wider"
                  style={{ color: "var(--text-muted)" }}
                >
                  <th className="py-1 pr-2">Ürün</th>
                  <th className="w-20 py-1 pr-2">Miktar</th>
                  <th className="w-16 py-1 pr-2">Birim</th>
                  <th className="w-24 py-1 pr-2">Birim Fiyat</th>
                  <th className="w-16 py-1 pr-2">KDV</th>
                  <th className="w-24 py-1 pr-2">Tutar</th>
                  <th className="w-8 py-1" />
                </tr>
              </thead>
              <tbody>
                {draft.kalemler.map((k, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-2">
                      <input
                        className={inputCls}
                        style={inputStyle}
                        value={k.aciklama}
                        onChange={(e) => setItem(i, { aciklama: e.target.value })}
                      />
                    </td>
                    {(
                      [
                        ["miktar", k.miktar],
                        ["birim", k.birim],
                        ["birim_fiyat", k.birim_fiyat],
                        ["kdv_orani", k.kdv_orani],
                        ["tutar", k.tutar],
                      ] as const
                    ).map(([key, val]) => (
                      <td key={key} className="py-1 pr-2">
                        <input
                          className={inputCls}
                          style={inputStyle}
                          defaultValue={val ?? ""}
                          onBlur={(e) =>
                            setItem(
                              i,
                              key === "birim"
                                ? { birim: e.target.value || null }
                                : { [key]: numVal(e.target.value) },
                            )
                          }
                        />
                      </td>
                    ))}
                    <td className="py-1 text-center">
                      <button
                        onClick={() =>
                          setF({ kalemler: draft.kalemler.filter((_, j) => j !== i) })
                        }
                        title="Satırı sil"
                        style={{ color: "#ff5c7a" }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tutar sütununun altı: KDV'li fiyat (kalemlerden canlı) + toplam fiyat */}
          <div className="mb-3 flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <span className={labelCls + " !mb-0"} style={{ color: "var(--text-muted)" }}>
                KDV&apos;li Fiyat
              </span>
              <span
                className="w-40 rounded-lg border px-2 py-1.5 text-right text-sm"
                style={{ ...inputStyle, color: "var(--accent)" }}
              >
                {(() => {
                  const kdvli = draft.kalemler.reduce(
                    (a, k) =>
                      a + (k.tutar ?? 0) * (1 + (k.kdv_orani ?? 0) / 100),
                    0,
                  );
                  const fallback =
                    draft.kalemler.reduce((a, k) => a + (k.tutar ?? 0), 0) +
                    (draft.kdv_toplam ?? 0);
                  const v = draft.kalemler.some((k) => k.kdv_orani !== null)
                    ? kdvli
                    : fallback;
                  return fmtMoney(Math.round(v * 100) / 100, draft.para_birimi);
                })()}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={labelCls + " !mb-0"} style={{ color: "var(--text-muted)" }}>
                Toplam Fiyat
              </span>
              <input
                className="w-40 rounded-lg border px-2 py-1.5 text-right text-sm outline-none"
                style={inputStyle}
                defaultValue={draft.genel_toplam ?? ""}
                onBlur={(e) => setF({ genel_toplam: numVal(e.target.value) })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={() => setF({ kalemler: [...draft.kalemler, { ...EMPTY_ITEM }] })}
              className="rounded-lg border px-3 py-1.5 text-xs"
              style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            >
              + Satır ekle
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setDraft(null);
                  setDraftWarns([]);
                }}
                className="rounded-lg border px-4 py-1.5 text-sm"
                style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
              >
                Vazgeç
              </button>
              <button
                onClick={saveDraft}
                disabled={!!busy}
                className="btn-grad rounded-lg px-4 py-1.5 text-sm font-medium text-black"
                style={{ background: "var(--grad)" }}
              >
                ✓ Deftere kaydet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Defter */}
      {records.length === 0 && !draft ? (
        <div
          className="rounded-xl border border-dashed py-10 text-center text-sm"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          Defter boş — ilk faturayı yukarıdan yükle.
        </div>
      ) : (
        records.length > 0 && (
          <ul className="flex flex-col gap-2">
            {records.map((r) => (
              <li
                key={r.id}
                className="card rounded-xl border px-3 py-2.5"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">🧾</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                      {r.satici ?? "Satıcı yok"}{" "}
                      <span style={{ color: "var(--text-muted)" }}>
                        · {r.fatura_no ?? "no yok"} · {r.tarih ?? "tarih yok"}
                      </span>
                    </div>
                    <div className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                      {r.kalemler.length} kalem · KDV {fmtMoney(r.kdv_toplam, r.para_birimi)}
                      {r.uyarilar.length > 0 && (
                        <span style={{ color: "#ffb454" }}> · ⚠ {r.uyarilar.length} uyarı</span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-sm font-semibold" style={{ color: "var(--accent)" }}>
                    {fmtMoney(r.genel_toplam, r.para_birimi)}
                  </div>
                  <button
                    onClick={() => del(r.id)}
                    title="Sil"
                    className="shrink-0 px-1"
                    style={{ color: "#ff5c7a" }}
                  >
                    🗑
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
