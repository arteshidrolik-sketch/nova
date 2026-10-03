"""Viral Yorum — "ilk saniyeler + seslendirilen komik yorumlar" Reels kurucu.

  python yorumlu.py <is.json> <cikti.mp4>

is.json:
  {"video": "kaynak.mp4", "kaynak": "@hesap", "baslik": "En komik yorumlar 😂",
   "klip_sure": 4, "ses_seviyesi": 0.15, "seslendir": true, "ses_hizi": 1.15, "ses_id": null,
   "yorumlar": [{"metin": "…", "begeni": "12,4 B", "oku": "…(isteğe bağlı: okunacak metin)"},
                {"metin": "Yücel'in yorumu", "sayfa": true}, …]}
  "sayfa": true → sayfanın kendi yorumu: koyu, sarı çerçeveli kart, "sanal_dilenciyim · Sayfa" adıyla.

Akış: kaynak videonun ilk <klip_sure> saniyesi kendi sesiyle oynar; sonra video NET olarak
devam eder, sesi kısılır ve yorum kartları sırayla alt bölümde belirir. Her yorum ElevenLabs
ile seslendirilir; kart, seslendirme bitene kadar ekranda kalır.
Yorum sahiplerinin adı ve fotoğrafı gösterilmez (yalnız renkli bir daire).
Seslendirmeler iş klasöründe `ses/` altında saklanır; metin değişmedikçe yeniden üretilmez.
Çıktı Instagram Reels ölçülerindedir: 1080x1920, 30 fps, 8 bit H.264, AAC 48 kHz.
"""
import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1080, 1920
HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = os.path.join(HERE, "fonts")  # Noto Sans (OFL) — iki ortamda aynı görünüm
ENV_FILE = os.path.join(HERE, "..", "..", ".env.local")  # yerelde nova/.env.local; sunucuda ortam değişkenleri
EMOJI = re.compile("[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U00002B00-\U00002BFF\U0001F1E6-\U0001F1FF"
                   "\u200d\ufe0f\u2764\u203c\u2049\u00a9\u00ae]+")
COLORS = ["#F97316", "#0EA5E9", "#A855F7", "#10B981", "#EF4444", "#EAB308", "#EC4899", "#6366F1"]
CARD_BOTTOM = 470  # kartın alt kenarının ekran altına uzaklığı (Reels açıklama alanının üstü)
PAGE_NAME = os.environ.get("IG_PAGE_NAME", "sanal_dilenciyim")


def tool(name):
    """ffmpeg/ffprobe: PATH'te, yoksa bu bilgisayardaki kurulum yerinde."""
    p = shutil.which(name)
    if p:
        return p
    win = rf"C:\Users\info\tools\ffmpeg\bin\{name}.exe"
    if os.path.exists(win):
        return win
    sys.exit(f"{name} bulunamadı")


FF, FP = tool("ffmpeg"), tool("ffprobe")


def env() -> dict:
    """Önce ortam değişkenleri (sunucu), yoksa nova/.env.local (yerel)."""
    out = {}
    if os.path.exists(ENV_FILE):
        for line in open(ENV_FILE, encoding="utf-8"):
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                out[k] = v.strip()
    for k in ("ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"):
        if os.environ.get(k):
            out[k] = os.environ[k]
    return out


_WEIGHTS = {"regular": "NotoSans-Regular.ttf", "semibold": "NotoSans-SemiBold.ttf", "bold": "NotoSans-Bold.ttf"}


def font(weight, size):
    return ImageFont.truetype(os.path.join(FONT_DIR, _WEIGHTS[weight]), size)


class Emoji:
    """Renkli emoji yazı tipi. Windows: Segoe UI Emoji (her boyut). Linux: Noto Color Emoji
    (yalnız 109 px bitmap) → 109'da çizilip istenen boyuta ölçeklenir."""

    _path = None

    def __init__(self, size):
        if Emoji._path is None:
            cands = [r"C:\Windows\Fonts\seguiemj.ttf"] + glob.glob("/usr/share/fonts/**/NotoColorEmoji*.ttf", recursive=True)
            Emoji._path = next((c for c in cands if os.path.exists(c)), "")
        self.size = size
        self.native = 109 if "Noto" in Emoji._path else size
        self.f = ImageFont.truetype(Emoji._path, self.native) if Emoji._path else None
        self.k = size / self.native

    def length(self, text):
        if not self.f:
            return 0
        return ImageDraw.Draw(Image.new("RGBA", (4, 4))).textlength(text, font=self.f) * self.k

    def paste(self, img, xy, text):
        if not self.f or not text:
            return
        w = int(self.length(text) / self.k) + 8
        tmp = Image.new("RGBA", (w, int(self.native * 1.3)), (0, 0, 0, 0))
        ImageDraw.Draw(tmp).text((0, 0), text, font=self.f, embedded_color=True)
        if self.k != 1:
            tmp = tmp.resize((max(1, int(tmp.width * self.k)), max(1, int(tmp.height * self.k))), Image.LANCZOS)
        img.alpha_composite(tmp, (int(xy[0]), int(xy[1])))


def runs(text):
    """Metni (parça, emoji_mi) çiftlerine böler."""
    out, pos = [], 0
    for m in EMOJI.finditer(text):
        if m.start() > pos:
            out.append((text[pos:m.start()], False))
        out.append((m.group().replace("\ufe0f", ""), True))
        pos = m.end()
    if pos < len(text):
        out.append((text[pos:], False))
    return out


def width(draw, text, f, fe):
    return sum(fe.length(t) if e else draw.textlength(t, font=f) for t, e in runs(text))


def draw_text(img, draw, xy, text, f, fe, fill):
    x, y = xy
    for t, e in runs(text):
        if e:
            fe.paste(img, (x, y + fe.size * 0.12), t)
            x += fe.length(t)
        else:
            draw.text((x, y), t, font=f, fill=fill)
            x += draw.textlength(t, font=f)
    return x


def wrap(draw, text, f, fe, max_w):
    lines, cur = [], ""
    for word in text.split():
        test = f"{cur} {word}".strip()
        if width(draw, test, f, fe) <= max_w or not cur:
            cur = test
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def _shadowed(cw, ch, m, radius):
    img = Image.new("RGBA", (cw + 2 * m, ch + 2 * m), (0, 0, 0, 0))
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((m, m + 10, m + cw, m + ch + 10), radius, fill=(0, 0, 0, 170))
    return Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(14)))


def page_card(metin, path):
    """Sayfanın kendi yorumu (Yücel'in yazdığı): koyu kart, adı görünür — videonun altındaki
    yorumlardan ayırt edilsin diye farklı görünür."""
    cw, pad, av, m = 800, 30, 58, 30
    f, fe, fn, fb = font("semibold", 38), Emoji(36), font("bold", 27), font("bold", 21)
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    tx = pad + av + 22
    lines = wrap(probe, metin, f, fe, cw - tx - pad)
    lh = 54
    ch = pad + 42 + lh * len(lines) + pad
    img = _shadowed(cw, ch, m, 34)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((m, m, m + cw, m + ch), 34, fill=(24, 24, 27, 245), outline="#FACC15", width=4)
    x, y = m + pad, m + pad
    d.ellipse((x, y, x + av, y + av), fill="#FACC15")
    Emoji(34).paste(img, (x + 12, y + 10), "🥺")
    d.text((m + tx, y - 2), PAGE_NAME, font=fn, fill="#FACC15")
    nw = d.textlength(PAGE_NAME, font=fn)
    bw = d.textlength("Sayfa", font=fb) + 24
    d.rounded_rectangle((m + tx + nw + 14, y + 2, m + tx + nw + 14 + bw, y + 34), 16, fill="#FACC15")
    d.text((m + tx + nw + 26, y + 3), "Sayfa", font=fb, fill="#18181B")
    ty = y + 42
    for ln in lines:
        draw_text(img, d, (m + tx, ty), ln, f, fe, "#FAFAFA")
        ty += lh
    img.save(path)


def card(i, metin, begeni, path):
    """Küçük, Instagram yorumu görünümlü kart (kimliksiz)."""
    cw, pad, av, m = 800, 30, 58, 30
    f, fe, fs, fse = font("semibold", 38), Emoji(36), font("regular", 26), Emoji(24)
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    tx = pad + av + 22  # metin avatarın sağından başlar
    lines = wrap(probe, metin, f, fe, cw - tx - pad)
    lh = 54
    ch = pad + 30 + lh * len(lines) + (46 if begeni else 6) + pad
    img = _shadowed(cw, ch, m, 34)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((m, m, m + cw, m + ch), 34, fill=(255, 255, 255, 245))
    x, y = m + pad, m + pad
    d.ellipse((x, y, x + av, y + av), fill=COLORS[i % len(COLORS)])  # kimliksiz avatar
    d.rounded_rectangle((m + tx, y + 4, m + tx + 170, y + 22), 9, fill="#D4D4D8")  # gizlenmiş ad
    ty = y + 30
    for ln in lines:
        draw_text(img, d, (m + tx, ty), ln, f, fe, "#111111")
        ty += lh
    if begeni:
        draw_text(img, d, (m + tx, ty + 8), f"❤️ {begeni}", fs, fse, "#71717A")
    img.save(path)


def pill(text, path, size=44, fg="#FFFFFF", bg=(0, 0, 0, 170)):
    f, fe = font("semibold", size), Emoji(size - 4)
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    tw = int(width(probe, text, f, fe))
    px, py = int(size * 0.8), int(size * 0.45)
    img = Image.new("RGBA", (tw + 2 * px, size + 2 * py + 12), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, img.width - 1, img.height - 1), img.height // 2, fill=bg)
    draw_text(img, d, (px, py - 6), text, f, fe, fg)
    img.save(path)


def probe_duration(path):
    r = subprocess.run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    return float(r.stdout.strip())


def video_size(path):
    r = subprocess.run([FP, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                        "-of", "csv=p=0:s=x", path], capture_output=True, text=True)
    w, h = r.stdout.strip().split("x")[:2]
    return int(w), int(h)


def has_audio(path):
    r = subprocess.run([FP, "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    return bool(r.stdout.strip())


TONES = {
    # Yücel (2026-10-03): "heyecansız olmasın; okurken kendisi de eğlensin, sonunda gülsün, kahkaha atsın."
    # (2026-10-03, ikinci düzeltme) "çok zorlama, samimiyet yok; gülmeyi maksimum abart" →
    # gülerek başla, metinden sonra gerçek "hahaha" + kahkaha; son yorumda katıla katıla.
    "eglenceli": ("[giggling] ", "! Hahaha! [laughs harder]", "! Hahahahaha! [bursts out laughing] [wheezing]"),
    "duz": ("", "", ""),
}


def tone_text(text, tone, last):
    pre, end, end_last = TONES.get(tone, TONES["eglenceli"])
    body = text.rstrip(" .!?…")
    if not pre and not end:
        return text
    return f"{pre}{body}{end_last if last else end}"


def speak(text, out, voice_id, tone="eglenceli", last=False):
    """ElevenLabs ile seslendirir (emoji'ler okunmaz). Ton etiketleri okunmaz, sese yansır."""
    e = env()
    clean = re.sub(r"\s+", " ", EMOJI.sub("", text)).strip()
    expressive = tone != "duz"
    payload = {"text": tone_text(clean, tone, last), "model_id": "eleven_v3", "language_code": "tr"}
    if expressive:
        payload["voice_settings"] = {"stability": 0.0}  # "Creative": duyguyu daha güçlü verir
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id or e['ELEVENLABS_VOICE_ID']}?output_format=mp3_44100_128",
        data=json.dumps(payload).encode(),
        headers={"xi-api-key": e["ELEVENLABS_API_KEY"], "Content-Type": "application/json"})
    last = None
    for attempt in range(4):  # bağlantı kopmalarına karşı birkaç kez dene
        try:
            data = urllib.request.urlopen(req, timeout=180).read()
            open(out, "wb").write(data)
            return
        except urllib.error.HTTPError as err:
            sys.exit(f"Seslendirme hatası ({err.code}): {err.read()[:300]!r}")
        except (urllib.error.URLError, ConnectionError, TimeoutError) as err:
            last = err
            time.sleep(3 * (attempt + 1))
    sys.exit(f"Seslendirme servisine bağlanılamadı: {last}")


def main():
    job = json.load(open(sys.argv[1], encoding="utf-8"))
    out = sys.argv[2]
    base = os.path.dirname(os.path.abspath(sys.argv[1]))
    src = job["video"] if os.path.isabs(job["video"]) else os.path.join(base, job["video"])
    K = float(job.get("klip_sure", 4))
    duck = float(job.get("ses_seviyesi", 0.15))
    voiced = job.get("seslendir", True)
    speed = float(job.get("ses_hizi", 1.15))  # seslendirme hızı (1 = olduğu gibi)
    ys = job["yorumlar"]
    n = len(ys)
    tmp = tempfile.mkdtemp(prefix="yorumlu-")
    vdir = os.path.join(base, "ses")
    os.makedirs(vdir, exist_ok=True)

    # 1) Seslendirmeler ve zaman çizelgesi
    starts, durs, voices = [], [], []
    t = K + 0.25
    for i, y in enumerate(ys):
        if voiced:
            say = y.get("oku") or y["metin"]
            tone = job.get("ton", "eglenceli")
            last = i == n - 1
            key = hashlib.md5(f"{job.get('ses_id')}|{tone}|{last}|{say}".encode()).hexdigest()[:10]
            vp = os.path.join(vdir, f"y{i + 1}-{key}.mp3")
            if not os.path.exists(vp) or os.path.getsize(vp) < 1000:  # yoksa ya da yarım kaldıysa üret
                speak(say, vp, job.get("ses_id"), tone, last)
            vd = probe_duration(vp) / speed
            voices.append(vp)
            d = max(1.8, vd + 0.55)
        else:
            d = float(job.get("yorum_sure", 2.8))
        starts.append(t)
        durs.append(d)
        t += d
    T = t + 0.6

    # 2) Girdiler
    args = [FF, "-y", "-loglevel", "error", "-stream_loop", "-1", "-i", src]
    for i, y in enumerate(ys):
        p = os.path.join(tmp, f"k{i}.png")
        if y.get("sayfa"):
            page_card(y["metin"], p)
        else:
            card(i, y["metin"], y.get("begeni", ""), p)
        args += ["-loop", "1", "-t", f"{T}", "-i", p]
    hp, fp_ = os.path.join(tmp, "baslik.png"), os.path.join(tmp, "kaynak.png")
    pill(job.get("baslik", "En komik yorumlar 😂"), hp, 44)
    pill(f"🎥 {job['kaynak']}", fp_, 30, bg=(0, 0, 0, 120))
    args += ["-loop", "1", "-t", f"{T}", "-i", hp, "-loop", "1", "-t", f"{T}", "-i", fp_]
    for _ in ys:  # kart başına kısa "pop" sesi
        args += ["-f", "lavfi", "-t", "0.09", "-i", "sine=frequency=1150:sample_rate=48000"]
    for vp in voices:
        args += ["-i", vp]

    # 3) Görüntü: video net devam eder; kartlar alt bölümde, aşağıdan kayarak gelir.
    #    Dikey kaynak ekranı doldurur; yatay/kare kaynak tam genişlikte sığdırılır,
    #    üstü ve altı videonun bulanık, koyu hâliyle dolar (kırpılıp bozulmasın diye).
    sw, sh_ = video_size(src)
    if sw / sh_ <= 0.65 or job.get("yerlesim") == "doldur":
        fc = [f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps=30,setsar=1,"
              f"trim=0:{T},setpts=PTS-STARTPTS[bg]"]
    else:
        fc = [f"[0:v]fps=30,trim=0:{T},setpts=PTS-STARTPTS,split[s1][s2]",
              f"[s1]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=30:3,"
              f"eq=brightness=-0.22:saturation=0.8,setsar=1[fill]",
              f"[s2]scale={W}:-2,setsar=1[fg]",
              f"[fill][fg]overlay=x=0:y=(H-h)/2-190[bg]"]
    prev = "bg"
    for i in range(n):
        s, e = starts[i], starts[i] + durs[i] - 0.1
        fc.append(f"[{i + 1}:v]format=rgba,fade=in:st={s}:d=0.2:alpha=1,fade=out:st={e - 0.16}:d=0.16:alpha=1[c{i}]")
        fc.append(f"[{prev}][c{i}]overlay=x=(W-w)/2:y='H-h-{CARD_BOTTOM}+60*(1-min(1,(t-{s})/0.2))':"
                  f"enable='between(t,{s},{e})'[v{i}]")
        prev = f"v{i}"
    fc.append(f"[{n + 1}:v]format=rgba,fade=in:st={K}:d=0.3:alpha=1[hd]")
    fc.append(f"[{prev}][hd]overlay=x=(W-w)/2:y=210:enable='gte(t,{K})'[vh]")
    fc.append(f"[vh][{n + 2}:v]overlay=x=40:y=120[vout]")

    # 4) Ses: kaynak sesi kesitten sonra kısılır; pop + seslendirme eklenir
    if has_audio(src):
        fc.append(f"[0:a]atrim=0:{T},asetpts=PTS-STARTPTS,aresample=48000,"
                  f"volume='if(lt(t,{K}),1,{duck})':eval=frame[a0]")
    else:
        fc.append(f"anullsrc=r=48000:cl=stereo,atrim=0:{T}[a0]")
    mix = ["[a0]"]
    for i in range(n):
        ms = int(starts[i] * 1000)
        fc.append(f"[{n + 3 + i}:a]afade=out:st=0.03:d=0.06,volume=0.35,adelay={ms}:all=1[p{i}]")
        mix.append(f"[p{i}]")
    for i in range(len(voices)):
        ms = int((starts[i] + 0.15) * 1000)
        fc.append(f"[{2 * n + 3 + i}:a]aresample=48000,atempo={speed},volume=1.6,adelay={ms}:all=1[s{i}]")
        mix.append(f"[s{i}]")
    fc.append(f"{''.join(mix)}amix=inputs={len(mix)}:normalize=0:duration=first,alimiter=limit=0.95[aout]")

    args += ["-filter_complex", ";".join(fc), "-map", "[vout]", "-map", "[aout]", "-t", f"{T}",
             "-c:v", "libx264", "-profile:v", "high", "-level", "4.0", "-pix_fmt", "yuv420p", "-r", "30",
             "-g", "60", "-keyint_min", "60", "-sc_threshold", "0", "-b:v", "5M", "-maxrate", "5M", "-bufsize", "10M",
             "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", out]
    r = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        sys.exit(f"ffmpeg hatası:\n{r.stderr[-1500:]}")
    print(f"→ {out} ({os.path.getsize(out)} bayt, {T:.1f} sn, {n} yorum)")
    for i in range(n):
        print(f"   yorum {i + 1}: {starts[i]:.1f}–{starts[i] + durs[i]:.1f} sn")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main()
