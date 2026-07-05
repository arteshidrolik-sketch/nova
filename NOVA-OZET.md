# Nova — Proje Özeti

> Kişisel, çok-ajanlı **geliştirici asistanı**. Bir uygulama geliştiricisinin (ve
> hidrolik işletme sahibinin) işlerini tek arayüzde toplamak için inşa edildi:
> kod yazdırma, proje yönetimi, sürüm/store işleri — bulutta 7/24, telefondan da erişilebilir.

**Canlı adres:** https://nova.getdriver.com.tr
**Kaynak:** GitHub `arteshidrolik-sketch/nova` (özel) · Yerel: `C:\Users\info\Projeler\nova`

---

## 1. Nova Nedir?

Nova, Claude API üzerine kurulu bir web uygulaması. Sen Türkçe kendi cümlenle ne
istersen söylüyorsun; bir **orkestratör** mesajı doğru **uzman ajana** yönlendiriyor,
o da (gerekiyorsa) internette arıyor, proje dosyalarını okuyor/düzenliyor, belge
üretiyor ya da sürüm/store işlerinde yardım ediyor. Amaç: Claude Code + benzeri
araçlarla yapılan işleri **tek, havalı bir arayüzde** toplamak.

---

## 2. Teknoloji / Mimari

- **Next.js 16** (App Router, Turbopack) + **TypeScript** + **Tailwind v4** + **React 19**
- **Claude API** (`@anthropic-ai/sdk`) — ajana göre model seçimi
- **Yerel JSON depo** (`data/*.json`): sohbetler, görevler, projeler, beceriler, hafıza, loops, sürümler
- **Docker + Traefik** (otomatik HTTPS) · **Hostinger VPS** (Ubuntu 24.04)
- **Cloudflare Tunnel** (sabit adres + 443 engelini aşma)

**Önemli dosyalar:**
- `app/api/chat/route.ts` → sohbet orkestrasyonu (ajan seçimi, araçlar, akış döngüsü, arka plan run)
- `lib/agents/` → `orchestrator.ts` (yönlendirme), `prompts.ts` (sistem promptları), `models.ts` (ajan→model), `meta.ts`
- `lib/tools/` → `actions.ts` (GO-onaylı aksiyonlar), `projectFiles.ts` (okuma araçları)
- `lib/runs/store.ts` → arka plan iş kaydı (poll mimarisi)
- `components/` → `AppShell`, `Sidebar` (alt menü), `Workspace` (harita+sohbet), `Chat`, `AgentMap`, `Dashboard`, `Projects`, `NovaPlayground`

---

## 3. Ajanlar ve Model Yönlendirme

Orkestratör, mesajın içeriğine göre en uygun uzmanı seçer:

| Ajan | Ne yapar | Model |
|------|----------|-------|
| ✨ Genel | Sohbet, selamlaşma, genel sorular | Fable 5 |
| 💻 Geliştirici | Kod yazma, bug, implementasyon | Opus 4.8 |
| 🔍 Code Reviewer | Kod/diff inceleme, güvenlik | Opus 4.8 |
| 🔎 Araştırma | Güncel bilgi, karşılaştırma (web arama) | Sonnet 5 |
| 🚀 Release & Store | Sürüm notu, App Store/Play, ASO | Sonnet 5 |
| 📁 Proje/Operasyon | Planlama, takip, özetleme | Sonnet 5 |

- Router'ın kendisi hızlı/ucuz **Fable** ile karar verir.
- Üstteki/haritadaki rozet hangi ajanın ve hangi modelin devrede olduğunu gösterir (🧠 model etiketi).
- **Kritik bug düzeltildi:** Router, mesajlardaki ekstra alanlar (`agent`) yüzünden API hatası alıp hep "Genel"e düşüyordu → temizlenip düzeltildi, artık gerçek yönlendirme çalışıyor.

---

## 4. Özellikler

### Çalışma Alanı
- 🗺️ **Ajan haritası** (uzay temalı, NASA foto arka plan, kayan yıldızlar, ajan düğümleri)
- 💬 **Sohbet** okunur genişlikte altta + yanında **canlı pano** (saat, hava durumu, euro/dolar kuru)
- 📍 Menü, harita ile sohbet arasında yatay bar (dar ekranda yatay kaydırılır)
- 🖥️ **Ekran koruyucu modu:** 15 sn hareketsizlik → tam ekran uzay modu (sohbet akarken devreye girmez)
- 🎤 **Sesli giriş/çıkış** (Web Speech API), "Nova" ile uyandırma (wake-word), kadın Türkçe ses
- 📎 **Dosya ekleme:** resim, PDF, Word, Excel, metin (Office → sunucuda metne çevrilir)

### Projeler
Üç şekilde proje eklenir:
1. 🆕 **Prompt'tan başla** — proje adı + prompt (PDF yükle veya metin) → sunucuda klasör açılır, Nova promptu okuyup plana başlar
2. 📁 **Klasör yükle** — bilgisayardan normal bir uygulama klasörü seç (webkitdirectory), `node_modules/.git` atlanır
3. 📂 **Mevcut klasör** — sunucudaki bir klasörü "Gözat" ile bağla

- **Her projenin kendi sohbeti var** — projeyi aktif edince onun sohbeti açılır
- Proje bağlamı **bulunduğun sohbete göre** çözülür (GetDriver sohbetindeysen GetDriver aktif)
- Aktif projede ajanlar dosyaları okur (`list_files`/`read_file`/`search_files`) ve **GO-onaylı** düzenler (`write_project_file`/`edit_project_file`/`run_command`/`git_commit_push`)

### GO-onaylı görev sistemi
Yazma/tehlikeli aksiyonlar önce **"öneri"** olarak Görevler ekranına düşer; sen **GO** deyince uygulanır.

### Diğer katmanlar
- 🌐 **Web arama** (server-side `web_search`) — tüm ajanlar güncel bilgiye erişir
- 📄 **Belge üretimi** (Agent Skills: docx/xlsx/pptx/pdf)
- 🧩 **Beceriler** — ajanlara işe özel bilgi yüklenir
- 🔁 **Loops** (zamanlanmış iş akışları), 📋 Brifing, 🚀 Sürümler (release & store yardımcısı)
- 🎮 **NovaPlayground** — 3D yıldız tüneli + neon orb'lar + "Oyna" ile tam ekran orb-patlatma oyunu (ana arayüzü bozmadan)

### Mobil/Tablet
- Viewport meta, `h-dvh` (adres çubuğu taşması giderildi), dokunma polisajı, alt bar yatay kaydırma

---

## 5. Altyapı ve Deploy

### Yolculuk
1. Önce **yerel** çalıştı (`npm run dev`)
2. Bulut kararı: **Hostinger VPS** (Docker + Traefik), GitHub üzerinden deploy
3. **443 engeli:** VPS'in gelen HTTPS'i ağ katmanında sıfırlanıyordu (paket yakalamayla doğrulandı) → **Cloudflare Tunnel** ile aşıldı
4. **Sabit adres:** `getdriver.com.tr` Cloudflare'e taşındı (site + mail bozulmadan), **named tunnel** ile `nova.getdriver.com.tr` kuruldu

### Otomatik güvenli deploy
- Sunucuda **`nova-autodeploy`** (systemd watcher): yeni commit → `docker compose up -d --build` → **sağlık kontrolü** → sağlıksızsa **otomatik önceki sürüme geri döner**
- Container'da **healthcheck** (node fetch localhost:3000)
- Bozuk derleme eski sürümü çalışır bırakır → **güvenlik ağı**

### Güncelleme akışı (şimdiki çalışma şekli)
```
lokalde düzenle → npm run build (doğrula) → git push → sunucuda git pull → watcher derler + sağlık kontrolü → canlı
```

---

## 6. Nova'nın Beyni (Self-Development) — şimdilik kapalı

Bir deneme olarak Nova'yı **kendi kodunu geliştirebilir** hale getirdik:
- "ne var ne yok" adında sabit bir sohbet, Nova'nın kendi kaynağına (`/srv/nova-src`) bağlıydı
- GO beklemeden otonom: oku → düzenle → `npm run build` ile doğrula → düzelt → commit → deploy
- **Başarıyla kendi başına** 3D playground'u (416 satır) yazıp deploy etti 🎉

Ama karmaşık işlerde takılma/yavaşlık yaşandı (uzun sohbet bağlamı, güvenlik reddi vb.).
Bu yüzden **şimdilik kapatıldı** (`NOVA_BRAIN=1` env ile geri açılabilir). Geliştirmeye
şimdilik **Claude Code (asistan) ile** devam ediliyor; beyne sonra dönülecek.

---

## 7. Çözülen Büyük Sorunlar (kronolojik)

- **OneDrive kilitleme / EPERM** → proje OneDrive dışına taşındı (`C:\Users\info\Projeler\nova`)
- **443 ERR_CONNECTION_RESET** → Cloudflare Tunnel (VPS'in 443'üne dokunmadan)
- **Ajan yönlendirme hep "Genel"** → router'a giden mesajlardaki ekstra `agent` alanı temizlendi
- **0 baytlık dosya yazımı** → `max_tokens` 4096→16000 (büyük dosya kesilmesi), boş içerik koruması
- **`tool_use` 400 hatası** → araç çağrısı varsa her zaman `tool_result` üretilir
- **Model niyet anlatıp aracı çağırmıyor** → sert araç talimatı ("çağır, deyip durma")
- **Güvenlik reddi (boş yanıt)** → hafıza notundaki kimlik/token içeriği reddi tetikliyordu; refusal olursa **hafızasız tekrar dener**
- **Takılma / "network error"** → **arka plan run + poll mimarisi**: iş bağlantıdan ayrıldı, kopsa bile sürer
- **Uzun sohbette yavaşlama** → modele giden geçmiş **40k karakterle** sınırlandı
- **Mobil bozuk görünüm** → viewport + `h-dvh` + alt bar yatay kaydırma

---

## 8. Operasyon / Kısa Notlar

- **Canlı:** https://nova.getdriver.com.tr · giriş: `nova` + belirlenen şifre (Traefik basic-auth)
- **Sunucu:** Hostinger VPS · `/docker/nova` (Docker Compose) · projeler `/srv/projects/`
- **Auto-deploy log:** `/var/log/nova-autodeploy.log`
- **Sunucu compose** özel/skip-worktree (auth gömülü + mount + healthcheck) → repo compose değişikliği elle uygulanır
- **Acil geri dönüş:** `cd /docker/nova && git reset --hard <iyi-commit> && cp /root/nova-compose.yml docker-compose.yml && docker compose up -d --build`
- **Beyni geri açmak:** `/root/nova.env`'e `NOVA_BRAIN=1` ekle + yeniden başlat

---

## 9. Sıradaki / Fikirler

- 🎮 Oyun ince ayarı (orb sıklığı/hız/skor/renk)
- 📱 Mobilde kalan pürüzler
- 🧹 Arayüz sadeleştirme / yeni özellikler
- 🧠 Beyin (self-development) 2.0 — daha sağlam bağlam yönetimiyle geri dönüş

---

*Bu özet, Nova üzerinde şimdiye kadar yapılan tüm çalışmanın anlık görüntüsüdür.*
