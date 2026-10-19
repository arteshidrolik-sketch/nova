"""Türkçeleştirme — yabancı bir viral videoyu Türkçe altyazıyla Reels'e çevirir.

  python turkcelestir.py analiz <video> <klasor>           → meta.json, ses.mp3, dokum.json, ornek.jpg
  python turkcelestir.py bant  <video> <klasor> <y> <h>    → bant.json + bant/aNN.jpg (okunacak kareler)
  python turkcelestir.py kur   <is.json> <cikti.mp4>       → altyazılı, yayına hazır video

Akış: `analiz` videoyu ölçer, sesini ElevenLabs Scribe ile yazıya döker ve kare ızgarası çıkarır
(Claude ızgaraya bakıp videoda gömülü yabancı altyazı var mı, varsa hangi yükseklikte diye karar verir).
`bant` o bandın ekranda dolu olduğu aralıkları piksel taramasıyla bulur ve her aralıktan bir kare
keser (Claude yabancı altyazıyı buradan okur). `kur` gömülü altyazı bandını koyu bulanık şeritle
kapatır, üstüne altyazıyı bindirir ve Instagram ölçülerinde çıkarır.

Altyazı iki dillidir (Yücel, 2026-10-20): üstte Türkçe (beyaz), altta İngilizce (sarı). İki dil
bandın yüksekliğine sığmazsa bant ortasından büyütülür.

Ses ASLA değiştirilmez: orijinal konuşma, efekt ve kahkaha olduğu gibi kalır (Yücel'in kararı,
2026-10-20: dublaj denendi, beğenilmedi).
"""
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
import uuid

from PIL import Image, ImageDraw, ImageFont

try:  # Windows konsolu cp1252 olabiliyor; çıktı her iki ortamda da UTF-8 olsun
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

W, H = 1080, 1920
HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, "Anton-Regular.ttf")
ENV_FILE = os.path.join(HERE, "..", "..", ".env.local")  # yerelde nova/.env.local; sunucuda ortam değişkenleri
IG_VIDEO = ["-c:v", "libx264", "-profile:v", "high", "-level", "4.0", "-pix_fmt", "yuv420p", "-r", "30",
            "-g", "60", "-keyint_min", "60", "-sc_threshold", "0", "-flags", "+cgop",
            "-b:v", "5M", "-maxrate", "5M", "-bufsize", "10M"]
IG_AUDIO = ["-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart"]


def tool(name):
    """ffmpeg/ffprobe: PATH'te yoksa Windows'taki bilinen yerine bak."""
    p = shutil.which(name)
    if p:
        return p
    d = os.environ.get("FFMPEG_DIR") or "C:/Users/info/tools/ffmpeg/bin"
    p = os.path.join(d, name + (".exe" if os.name == "nt" else ""))
    if os.path.exists(p):
        return p
    sys.exit(f"{name} bulunamadı")


def run(args, **kw):
    p = subprocess.run(args, capture_output=True, **kw)
    if p.returncode:
        sys.exit((p.stderr or b"").decode("utf-8", "replace")[-2000:])
    return p.stdout


def env() -> dict:
    e = dict(os.environ)
    if os.path.exists(ENV_FILE):
        for line in open(ENV_FILE, encoding="utf-8-sig"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                e.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    return e


def probe(path):
    out = run([tool("ffprobe"), "-v", "error", "-select_streams", "v:0",
               "-show_entries", "stream=width,height", "-show_entries", "format=duration",
               "-of", "json", path]).decode()
    d = json.loads(out)
    s = d["streams"][0]
    return int(s["width"]), int(s["height"]), float(d["format"]["duration"])


# ---------- analiz ----------

def cmd_analiz(video, klasor):
    os.makedirs(klasor, exist_ok=True)
    w, h, sure = probe(video)

    ses = os.path.join(klasor, "ses.mp3")
    run([tool("ffmpeg"), "-v", "error", "-y", "-i", video, "-vn", "-ac", "1", "-ar", "16000", ses])

    # Kare ızgarası: videodan eşit aralıklı 12 kare, 3x4 — Claude gömülü altyazıyı buradan görür.
    adet = 12
    fps = max(adet / sure, 0.05)
    run([tool("ffmpeg"), "-v", "error", "-y", "-i", video,
         "-vf", f"fps={fps:.4f},scale=300:-1,tile=3x4", "-frames:v", "1",
         os.path.join(klasor, "ornek.jpg")])

    dokum = stt(ses)
    json.dump(dokum, open(os.path.join(klasor, "dokum.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    meta = {"genislik": w, "yukseklik": h, "sure": round(sure, 2),
            "ornek_adet": adet, "ornek_aralik": round(sure / adet, 2),
            "dil": dokum.get("dil"), "konusma": dokum.get("metin", "")[:4000]}
    json.dump(meta, open(os.path.join(klasor, "meta.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(json.dumps(meta, ensure_ascii=False))


def stt(ses_yolu) -> dict:
    """ElevenLabs Scribe: konuşmayı zaman damgalı olarak yazıya döker (dil otomatik)."""
    e = env()
    key = e.get("ELEVENLABS_API_KEY")
    if not key:
        return {"dil": None, "metin": "", "bolumler": [], "hata": "ELEVENLABS_API_KEY yok"}
    sinir = uuid.uuid4().hex
    parcalar = []
    for ad, deger in (("model_id", "scribe_v1"), ("diarize", "true")):
        parcalar.append(f'--{sinir}\r\nContent-Disposition: form-data; name="{ad}"\r\n\r\n{deger}\r\n'.encode())
    parcalar.append(f'--{sinir}\r\nContent-Disposition: form-data; name="file"; filename="ses.mp3"\r\n'
                    f'Content-Type: audio/mpeg\r\n\r\n'.encode())
    parcalar.append(open(ses_yolu, "rb").read())
    parcalar.append(f'\r\n--{sinir}--\r\n'.encode())
    req = urllib.request.Request(
        "https://api.elevenlabs.io/v1/speech-to-text", data=b"".join(parcalar),
        headers={"xi-api-key": key, "Content-Type": f"multipart/form-data; boundary={sinir}"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            d = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as ex:
        return {"dil": None, "metin": "", "bolumler": [],
                "hata": f"STT {ex.code}: {ex.read()[:200].decode('utf-8', 'replace')}"}

    # Kelimeleri konuşmacı ve 1,2 sn'lik boşluklara göre bölümlere ayır.
    bolumler, cur = [], None
    for x in d.get("words", []):
        if x.get("type") == "spacing":
            continue
        sp = x.get("speaker_id", "?")
        if cur is None or cur["kim"] != sp or x["start"] - cur["bit"] > 1.2:
            if cur:
                bolumler.append(cur)
            cur = {"bas": round(x["start"], 2), "bit": round(x["end"], 2), "kim": sp, "metin": x.get("text", "")}
        else:
            cur["bit"] = round(x["end"], 2)
            cur["metin"] += x.get("text", "")
    if cur:
        bolumler.append(cur)
    for b in bolumler:
        b["metin"] = b["metin"].strip()
    return {"dil": d.get("language_code"), "metin": d.get("text", ""),
            "bolumler": [b for b in bolumler if b["metin"]]}


# ---------- bant ----------

def cmd_bant(video, klasor, y, h):
    """Bandın ekranda yazı taşıdığı aralıkları bulur; her aralıktan bir kare keser."""
    os.makedirs(klasor, exist_ok=True)
    gw, gh, sure = probe(video)
    y, h = max(0, int(y)), int(h)
    h = min(h, gh - y)
    fps = 4
    kw, kh = 240, max(8, int(h * 240 / gw))  # bandı sabit genişliğe küçült

    p = subprocess.Popen(
        [tool("ffmpeg"), "-v", "error", "-i", video,
         "-vf", f"crop={gw}:{h}:0:{y},fps={fps},scale={kw}:{kh}", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        stdout=subprocess.PIPE)
    # İki ölçüt: kenar = bandın genel hareketliliği, kontur = beyaz yazı + koyu kontur deseni.
    # Altyazıda kenarların çoğu konturlu yazıdan gelir (oran ~0,2–0,45); çimen/yol gibi
    # hareketli ama yazısız sahnelerde oran 0,12 civarında kalır (2026-10-20'de ölçüldü).
    olcum = []
    while True:
        b = p.stdout.read(kw * kh)
        if len(b) < kw * kh:
            break
        kenar = kontur = 0
        for row in range(kh):
            o = row * kw
            for x in range(2, kw - 2):
                v = b[o + x]
                if abs(v - b[o + x + 1]) > 60:
                    kenar += 1
                if v > 215 and (b[o + x - 2] < 110 or b[o + x + 2] < 110):
                    kontur += 1
        olcum.append((kenar, kontur))
    p.stdout.close()
    p.wait()

    aralik = []
    if olcum:
        dolu = [k2 >= 35 and k2 >= 0.17 * max(k1, 1) for k1, k2 in olcum]
        bas = None
        for i, v in enumerate(dolu):
            if v and bas is None:
                bas = i / fps
            if not v and bas is not None:
                aralik.append([bas, i / fps])
                bas = None
        if bas is not None:
            aralik.append([bas, len(dolu) / fps])
        # 0,6 sn'den yakınları birleştir, 0,4 sn'den kısaları at
        birlesik = []
        for a, b in aralik:
            if birlesik and a - birlesik[-1][1] <= 0.6:
                birlesik[-1][1] = b
            else:
                birlesik.append([a, b])
        aralik = [[round(a, 2), round(b, 2)] for a, b in birlesik if b - a >= 0.4]

    kare_dir = os.path.join(klasor, "bant")
    os.makedirs(kare_dir, exist_ok=True)
    for eski in os.listdir(kare_dir):
        os.remove(os.path.join(kare_dir, eski))

    # Uzun aralıklar birden çok altyazı taşıyabilir → 1,5 sn'de bir örnek al.
    anlar = []
    for a, b in aralik:
        t = a + 0.3
        while t < b - 0.15 and len(anlar) < 24:
            anlar.append(round(t, 2))
            t += 1.5
        if not anlar or anlar[-1] < a:
            anlar.append(round((a + b) / 2, 2))
    anlar = anlar[:24]

    # Kareleri zaman etiketiyle ızgaraya diz: Claude hangi yazının ne zaman olduğunu görsün.
    kw2 = 720
    kh2 = max(1, int(h * kw2 / gw))
    etiket_h = 34
    gruplar, kareler = [], []
    for g0 in range(0, len(anlar), 6):
        grup = anlar[g0:g0 + 6]
        sayfa = Image.new("RGB", (kw2, (kh2 + etiket_h) * len(grup)), (18, 18, 18))
        ciz = ImageDraw.Draw(sayfa)
        f = ImageFont.truetype(FONT, 24)
        for i, t in enumerate(grup):
            gecici = os.path.join(kare_dir, "_t.jpg")
            run([tool("ffmpeg"), "-v", "error", "-y", "-ss", "%.2f" % t, "-i", video, "-frames:v", "1",
                 "-vf", f"crop={gw}:{h}:0:{y},scale={kw2}:{kh2}", gecici])
            ust = i * (kh2 + etiket_h)
            ciz.text((10, ust + 5), "%.2f sn" % t, font=f, fill=(255, 210, 90))
            sayfa.paste(Image.open(gecici), (0, ust + etiket_h))
            kareler.append({"t": t, "grup": len(gruplar) + 1})
        ad = "g%02d.jpg" % (len(gruplar) + 1)
        sayfa.save(os.path.join(kare_dir, ad), quality=88)
        gruplar.append(ad)
    gecici = os.path.join(kare_dir, "_t.jpg")
    if os.path.exists(gecici):
        os.remove(gecici)
    out = {"y": y, "h": h, "aralik": aralik, "kareler": kareler, "gruplar": gruplar}
    json.dump(out, open(os.path.join(klasor, "bant.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(json.dumps(out, ensure_ascii=False))


# ---------- kur ----------

TR_RENK = (255, 255, 255, 255)      # Türkçe: beyaz
EN_RENK = (255, 212, 74, 255)       # İngilizce: sıcak sarı (iki dil karışmasın)
EN_ORAN = 0.76                      # İngilizce punto, Türkçenin oranı
YAN_PAY = 90                        # sağ/sol boşluk
ARA = 10                            # iki dil arasındaki boşluk


def sar(cizim, metin, punto, en_genis):
    """Metni en fazla 3 satıra böler; satırları birbirine yakın uzunlukta tutar.

    Açgözlü sarma son satırda tek kelime bırakabiliyor ("… anladınız / mı?"); bu yüzden
    önce kaç satır gerektiği bulunur, sonra hedef genişlik toplam/satır sayısı alınır.
    """
    f = ImageFont.truetype(FONT, punto)
    kelimeler = metin.split()
    if not kelimeler:
        return [""]
    toplam = cizim.textlength(" ".join(kelimeler), font=f)
    for adet in range(1, 4):
        hedef = max(toplam / adet, en_genis * 0.55)
        satirlar, s = [], ""
        for k in kelimeler:
            deneme = (s + " " + k).strip()
            if not s or (cizim.textlength(deneme, font=f) <= hedef and len(satirlar) < adet - 1) \
               or (len(satirlar) == adet - 1 and cizim.textlength(deneme, font=f) <= en_genis):
                s = deneme
            else:
                satirlar.append(s)
                s = k
        if s:
            satirlar.append(s)
        if len(satirlar) <= adet and all(cizim.textlength(x, font=f) <= en_genis for x in satirlar):
            return satirlar
    return satirlar[:3]


def duzen(cizim, tr, en, punto):
    """Verilen puntoda iki dilin satırlarını, fontlarını ve kapladığı yüksekliği verir."""
    en_punto = max(22, int(punto * EN_ORAN))
    tr_f = ImageFont.truetype(FONT, punto)
    en_f = ImageFont.truetype(FONT, en_punto)
    tr_s = sar(cizim, tr, punto, W - YAN_PAY) if tr else []
    en_s = sar(cizim, en, en_punto, W - YAN_PAY) if en else []
    tr_adim, en_adim = int(punto * 1.22), int(en_punto * 1.22)
    yuk = len(tr_s) * tr_adim + (ARA if tr_s and en_s else 0) + len(en_s) * en_adim
    return {"tr": tr_s, "en": en_s, "tr_f": tr_f, "en_f": en_f,
            "tr_adim": tr_adim, "en_adim": en_adim, "yuk": yuk}


def genislige_sigar(cizim, d):
    """Hiçbir satır sağdan taşmıyor mu? (sar() uzun kelimeyi bölemez, bu yüzden şart.)"""
    return (all(cizim.textlength(s, font=d["tr_f"]) <= W - YAN_PAY for s in d["tr"]) and
            all(cizim.textlength(s, font=d["en_f"]) <= W - YAN_PAY for s in d["en"]))


def en_buyuk_punto(cizim, tr, en, bant_h, bas=58):
    """Metnin banda sığdığı en büyük puntoyu bulur — hem yükseklik hem GENİŞLİK."""
    for punto in range(bas, 19, -2):
        d = duzen(cizim, tr, en, punto)
        if d["yuk"] <= bant_h - 18 and genislige_sigar(cizim, d):
            return d
    return duzen(cizim, tr, en, 20)


def gereken_yukseklik(altyazi, bas=58):
    """Tüm altyazılar tercih edilen puntoda çizilse bandın ne kadar olması gerekirdi."""
    d = ImageDraw.Draw(Image.new("RGB", (W, 10)))
    return max((duzen(d, a.get("metin", ""), a.get("en", ""), bas)["yuk"] for a in altyazi), default=0) + 28


def yazi_png(metin, en, yol, bant_h):
    """Saydam zemine iki dilli altyazı çizer: üstte Türkçe (beyaz), altta İngilizce (sarı)."""
    img = Image.new("RGBA", (W, bant_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    y = en_buyuk_punto(d, metin, en, bant_h)
    ust = (bant_h - y["yuk"]) // 2

    def ciz(satirlar, f, adim, renk, ust):
        for i, s in enumerate(satirlar):
            gen = d.textlength(s, font=f)
            d.text(((W - gen) / 2, ust + i * adim), s, font=f, fill=renk,
                   stroke_width=max(4, f.size // 11), stroke_fill=(0, 0, 0, 255))
        return ust + len(satirlar) * adim

    alt = ciz(y["tr"], y["tr_f"], y["tr_adim"], TR_RENK, ust)
    if y["en"]:
        ciz(y["en"], y["en_f"], y["en_adim"], EN_RENK, alt + (ARA if y["tr"] else 0))
    img.save(yol)


def cmd_kur(is_json, cikti):
    kok = os.path.dirname(os.path.abspath(is_json)) or "."
    j = json.load(open(is_json, encoding="utf-8"))
    video = os.path.join(kok, j["video"]) if not os.path.isabs(j["video"]) else j["video"]
    gw, gh, sure = probe(video)

    bant = j.get("bant")                      # {"y":…, "h":…} ya da None (gömülü altyazı yok)
    kapat = j.get("kapat") or []              # bandın kapatılacağı [bas, bit] aralıkları
    altyazi = j.get("altyazi") or []          # [{"bas":…, "bit":…, "metin":"Türkçe", "en":"English"}]
    if not altyazi:
        sys.exit("altyazı listesi boş")

    # Kaynak her ölçüde gelebiliyor (720x1280 çok yaygın). Önce 1080x1920'ye ölçekle:
    # Instagram'ın istediği ölçü bu, ve altyazı katmanı 1080 genişliğe göre çiziliyor —
    # 720'lik kareye 1080'lik yazı bindirilirse sağdan taşar (2026-10-20'de böyle oldu).
    oran = min(W / gw, H / gh)
    yw, yh = round(gw * oran), round(gh * oran)      # ölçeklenmiş görüntü
    px, py = (W - yw) // 2, (H - yh) // 2            # 9:16 değilse kenar dolgusu

    # Gömülü altyazı yoksa yazıyı ekranın altına, Reels arayüzünün üstüne koy.
    # Bant koordinatları kaynak çözünürlüğünde geldi → çıktı koordinatlarına çevir.
    if bant:
        by, bh = round(int(bant["y"]) * oran) + py, round(int(bant["h"]) * oran)
    else:
        bh = 300
        by = H - 620

    # İki dil tek satıra sığmaz; gereken yer bandı aşıyorsa bandı ortasından büyüt.
    gerek = gereken_yukseklik(altyazi)
    if gerek > bh:
        orta = by + bh // 2
        bh = min(gerek, H - 80)
        by = max(20, min(orta - bh // 2, H - bh - 20))

    png_dir = os.path.join(kok, "yazi")
    os.makedirs(png_dir, exist_ok=True)
    girisler, filtre, onceki = [tool("ffmpeg"), "-v", "error", "-y", "-i", video], "", "[v]"

    olcek = (f"[0:v]scale={yw}:{yh}:flags=lanczos,"
             f"pad={W}:{H}:{px}:{py}:black,setsar=1[v];")
    filtre += olcek

    if kapat:
        filtre += (f"[v]split[t0][t1];[t1]crop={W}:{bh}:0:{by},boxblur=24:4,"
                   f"eq=brightness=-0.42:saturation=0.15[bl];")
        enable = "+".join("between(t,%.2f,%.2f)" % (a, b) for a, b in kapat)
        filtre += f"[t0][bl]overlay=0:{by}:enable='{enable}'[v0];"
        onceki = "[v0]"

    for i, a in enumerate(altyazi, start=1):
        png = os.path.join(png_dir, "y%02d.png" % i)
        yazi_png(a.get("metin", ""), a.get("en", ""), png, bh)
        girisler += ["-i", png]
        etiket = "[v%d]" % (i + 100)
        filtre += (f"{onceki}[{i}:v]overlay=0:{by}:enable='between(t,%.2f,%.2f)'{etiket};"
                   % (float(a["bas"]), float(a["bit"])))
        onceki = etiket

    run(girisler + ["-filter_complex", filtre.rstrip(";"), "-map", onceki, "-map", "0:a:0?",
                    *IG_VIDEO, *IG_AUDIO, cikti])
    w2, h2, s2 = probe(cikti)
    print(json.dumps({"cikti": cikti, "sure": round(s2, 2), "olcu": f"{w2}x{h2}",
                      "kaynak_olcu": f"{gw}x{gh}", "bant": {"y": by, "h": bh},
                      "altyazi": len(altyazi), "kapatma": len(kapat)}, ensure_ascii=False))


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    k = sys.argv[1]
    if k == "analiz" and len(sys.argv) == 4:
        cmd_analiz(sys.argv[2], sys.argv[3])
    elif k == "bant" and len(sys.argv) == 6:
        cmd_bant(sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]))
    elif k == "kur" and len(sys.argv) == 4:
        cmd_kur(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
