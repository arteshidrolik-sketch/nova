# Nova — Geliştirici Asistanı

Çok-ajanlı kişisel geliştirici asistanı. **Faz 1**: dashboard iskeleti + Claude API'ye bağlı streaming sohbet.

## Stack
Next.js (App Router) · TypeScript · Tailwind v4 · Claude API (`@anthropic-ai/sdk`)

## Kurulum

1. Bağımlılıklar zaten kurulu. Değilse:
   ```bash
   npm install
   ```

2. API anahtarını ayarla:
   ```bash
   cp .env.local.example .env.local
   ```
   Sonra `.env.local` içine `ANTHROPIC_API_KEY` değerini yaz.
   (Anahtar: https://console.anthropic.com)

3. Geliştirme sunucusunu başlat:
   ```bash
   npm run dev
   ```

4. Tarayıcıda aç: http://localhost:3000

## Test
- Sol menü görünmeli (Brifing, Sohbet, Görevler, Projeler, Sürümler, Loops, Ayarlar).
- Sağ tarafta sohbet ekranı. Bir mesaj yaz, **Enter**'a bas.
- Yanıt **kelime kelime akarak** (streaming) gelmeli.
- Hata olursa kırmızı uyarı mesajı çıkar (örn. anahtar yoksa).

## Yapı
```
app/
  layout.tsx          # kök layout
  page.tsx            # dashboard (Sidebar + Chat)
  globals.css         # koyu tema + Tailwind
  api/chat/route.ts   # Claude'a streaming proxy
components/
  Sidebar.tsx         # sol menü
  Chat.tsx            # sohbet arayüzü (client)
```

## Notlar
- Model `.env.local` içindeki `NOVA_MODEL` ile değişir (varsayılan `claude-opus-4-8`).
- Sırlar (`.env.local`) `.gitignore`'da — repoya gitmez.

## Sıradaki (Faz 2)
Orkestratör + uzman alt-ajanlar (Geliştirici, Code Reviewer, Araştırma...).
Bkz. `../.idea/nova-dev-asistan-promptlari.md`.
