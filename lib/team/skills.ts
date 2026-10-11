// Ekip ajanlarının hazır becerileri. İlk kullanımda skills.json'a bir kez eklenir
// (source: "team-seed"); kullanıcı sonra düzenleyebilir, silebilir, yenilerini ekler.
import { loadSkills, createSkill } from "@/lib/skills/store";
import type { TeamRole } from "./roles";

const SEED: { role: TeamRole; name: string; description: string; content: string }[] = [
  // ---- Müdür ----
  {
    role: "manager",
    name: "Görev dağıtımı ve kabul kriterleri",
    description: "İşi parçalama, doğru uzmana verme, ölçülebilir kriter yazma",
    content: `- İsteği önce netleştir: amaç, çıktı türü (metin/dosya/kod/görsel), kapsam, son tarih.
- İşi en az sayıda, bağımsız alt göreve böl. Her alt görevi TEK uzmana ver.
- Her görevle birlikte 2-5 maddelik ÖLÇÜLEBİLİR kabul kriteri yaz (ör. "en az 3 birincil kaynak, her iddianın yanında link", "build hatasız", "3 farklı başlık seçeneği, her biri ≤ 60 karakter").
- Uzmana bağlamı eksiksiz ver: projenin ne olduğu, kullanıcının tam isteği, önceki kararlar. Uzman sohbet geçmişini görmez.
- Basit selamlaşma/soru ise ajan çalıştırma; kısa cevap ver.`,
  },
  {
    role: "manager",
    name: "Kalite denetimi ve revizyon döngüsü",
    description: "Teslim edilen işi kriterlere göre denetleme, düzelttirme",
    content: `- Teslimi her kabul kriterine tek tek karşı kontrol et; geçen/kalan maddeleri belirle.
- Kontrol et: uydurma var mı (kaynaksız sayı, var olmayan dosya), eksik parça var mı, kullanıcının isteğiyle birebir örtüşüyor mu.
- Eksik varsa aynı uzmana NET revizyon notu ile geri ver: neyin neden yetersiz olduğu ve tam olarak ne istendiği.
- En fazla 3 revizyon turu. 3 turda olmazsa elindeki en iyi sonucu, kalan eksikleri açıkça yazarak kullanıcıya sun.
- Kullanıcıya sonucu sunarken: ne yapıldı, nasıl denetlendi (kaç tur), çıktılar/linkler, kalan riskler.`,
  },
  {
    role: "manager",
    name: "Gün sonu ilerleme raporu",
    description: "18:00 raporunun biçimi",
    content: `Rapor biçimi (kısa, madde madde):
1. Bugün yapılanlar (çıktılarıyla)
2. Devam eden işler ve durumu
3. Engeller / kullanıcıdan beklenenler
4. Yarın için önerilen ilk 3 iş
Abartma, olmayan işi yazma; aktivite yoksa bunu tek cümleyle söyle.`,
  },
  // ---- Araştırma ----
  {
    role: "research",
    name: "Kaynaklı araştırma yöntemi",
    description: "Birincil kaynak, çapraz doğrulama, güven düzeyi",
    content: `- Soruyu 2-4 alt soruya böl; her biri için ayrı arama yap (toplam en fazla 6 arama).
- Birincil kaynakları öne al: resmi site, belge, mevzuat, şirket duyurusu, akademik çalışma. Blog/forum yalnız destek.
- Önemli her iddiayı en az 2 bağımsız kaynakla doğrula; çelişki varsa ikisini de yaz.
- Her iddianın yanına kaynak linki koy. Tarihleri belirt; eski bilgiyi işaretle.
- Sonunda güven düzeyi ver (yüksek/orta/düşük) ve bulunamayanları açıkça yaz. Uydurma yok.`,
  },
  {
    role: "research",
    name: "Rakip ve pazar analizi",
    description: "Rakip tablosu, pazar büyüklüğü, fırsatlar",
    content: `- Rakipleri tabloyla ver: ad, ürün, fiyat, hedef kitle, güçlü/zayıf yan, link.
- Pazar büyüklüğü/eğilim için kaynaklı sayı ver; tahminse yöntemi yaz.
- Sonda 3 fırsat + 3 risk, projeye özel ve uygulanabilir.
- Türkiye pazarı soruluyorsa yerel kaynakları (TÜİK, BDDK, sektör dernekleri, yerel medya) ara.`,
  },
  // ---- Kod ----
  {
    role: "coder",
    name: "Temiz kod ve doğrulama",
    description: "Oku → küçük değişiklik → derle/test → raporla",
    content: `- Değiştirmeden önce ilgili dosyaları oku (list_files, search_files, read_file). Tahmin etme.
- Küçük, odaklı değişiklik yap (edit_project_file); mevcut stile uy.
- Her değişiklikten sonra derle/test et (run_command: npm run build / test). Hata varsa düzelt, tekrar çalıştır.
- Teslimde: değişen dosyalar, neden, build/test çıktısının özeti. Doğrulanmadıysa açıkça "doğrulanmadı" yaz.
- git push dış dünyaya gider: yalnız müdür isterse, onaya sunulur.`,
  },
  {
    role: "coder",
    name: "Güvenli geliştirme",
    description: "Sır, girdi doğrulama, enjeksiyon",
    content: `- Anahtar/token'ı koda yazma; ortam değişkeni kullan, loglama.
- Kullanıcı girdisini doğrula; SQL/komut enjeksiyonu ve yol kaçışına (../) karşı koru.
- Bağımlılık eklerken bakımı süren, yaygın paket seç; sürümü sabitle.
- Hata mesajlarında iç bilgi sızdırma.`,
  },
  // ---- Satış & Pazarlama ----
  {
    role: "marketing",
    name: "Hedef kitle ve konumlandırma",
    description: "Persona, değer önerisi, mesaj",
    content: `- 2-3 persona çıkar: kim, derdi ne, nerede, satın alma engeli.
- Tek cümlelik değer önerisi + 3 destekleyici fayda (özellik değil, fayda).
- Rakiplerden ayrışma noktasını net yaz. Türkçe pazar diline ve kültürüne uygun ol.`,
  },
  {
    role: "marketing",
    name: "Reklam ve sosyal medya metni",
    description: "Kanal bazlı metin, kanca, CTA",
    content: `- Her kanal için ayrı ver (Instagram, TikTok, Google Ads, LinkedIn): ilk satır kanca, net fayda, tek CTA.
- Her seferinde 3 farklı varyasyon; uzunluk sınırlarına uy (Google başlık ≤ 30, açıklama ≤ 90 karakter).
- Hashtag ve emoji ölçülü. Abartılı/yanıltıcı vaat ve yasal risk (sağlık, finans iddiası) yok.
- Görsel gerekiyorsa generate_image ile üret ve metinle eşleştir.`,
  },
  {
    role: "marketing",
    name: "Teklif ve fiyatlandırma",
    description: "Paketleme, fiyat, satış konuşması",
    content: `- 3 paket öner (temel/standart/premium); fark net, ortası hedef.
- Fiyatı rakip ve maliyetle gerekçelendir; KDV dahil/hariç belirt.
- Kısa satış konuşması + en sık 5 itiraz ve cevabı.`,
  },
];

let seeded = false;
export async function ensureTeamSkills(): Promise<void> {
  if (seeded) return;
  const all = await loadSkills();
  if (all.some((s) => s.source === "team-seed")) { seeded = true; return; }
  for (const s of SEED) {
    await createSkill({ name: s.name, description: s.description, content: s.content, agentKeys: [], teamRoles: [s.role], source: "team-seed" });
  }
  seeded = true;
}
