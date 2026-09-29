"""Sanal Dilenci — görsel hazırlama + otomatik konuşma balonu.

  python balon.py hazirla <girdi> <cikti>
      Kenarlardaki beyaz/siyah şeritleri kırpar, 1080x1350 (4:5) JPEG yapar.

  python balon.py balon <girdi> <cikti> "<metin>" --kafa X,Y
      Hazırlanmış (1080x1350) görsele üstte balon ekler; kuyruk X,Y'ye
      (karakterin başının tepesi) uzanır. Punto, balon başı kapatmasın diye
      otomatik küçültülür.
"""
import argparse
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1350
FONT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Anton-Regular.ttf")
PAD_X, PAD_Y, BORDER, MARGIN = 60, 44, 7, 24


def trim_bars(img: Image.Image) -> Image.Image:
    """Kenarlardaki düz beyaz/siyah şeritleri kırpar (üretici bazen ekliyor)."""
    g = img.convert("L")
    w, h = g.size
    step = max(1, w // 60)

    def flat_row(y):
        vals = [g.getpixel((x, y)) for x in range(0, w, step)]
        return max(vals) - min(vals) < 12 and (min(vals) > 235 or max(vals) < 20)

    def flat_col(x):
        vals = [g.getpixel((x, y)) for y in range(0, h, max(1, h // 60))]
        return max(vals) - min(vals) < 12 and (min(vals) > 235 or max(vals) < 20)

    top = 0
    while top < h // 3 and flat_row(top):
        top += 1
    bot = h - 1
    while bot > h * 2 // 3 and flat_row(bot):
        bot -= 1
    left = 0
    while left < w // 3 and flat_col(left):
        left += 1
    right = w - 1
    while right > w * 2 // 3 and flat_col(right):
        right -= 1
    return img.crop((left, top, right + 1, bot + 1))


def fit_cover(img: Image.Image) -> Image.Image:
    img = img.convert("RGB")
    r = W / H
    iw, ih = img.size
    if iw / ih > r:
        nw = int(ih * r)
        x = (iw - nw) // 2
        img = img.crop((x, 0, x + nw, ih))
    else:
        nh = int(iw / r)
        y = (ih - nh) // 2
        img = img.crop((0, y, iw, y + nh))
    return img.resize((W, H), Image.LANCZOS)


def wrap(text, font, max_w, draw):
    lines = []
    for para in text.split("\n"):
        cur = ""
        for word in para.split():
            test = f"{cur} {word}".strip()
            if draw.textlength(test, font=font) <= max_w:
                cur = test
            else:
                if cur:
                    lines.append(cur)
                cur = word
        if cur:
            lines.append(cur)
    return lines


def layout(text, punto, draw):
    font = ImageFont.truetype(FONT, punto)
    lines = wrap(text, font, int((W - 2 * MARGIN - PAD_X) / 1.32), draw)
    lh = int(punto * 1.18)
    text_w = max(draw.textlength(l, font=font) for l in lines)
    bw = min(W - 2 * MARGIN, int(text_w * 1.32 + PAD_X))
    bh = int(lh * len(lines) * 1.36 + PAD_Y)
    return font, lines, lh, bw, bh


def add_bubble(img, text, hx, hy):
    d = ImageDraw.Draw(img)
    # Tercih: yazarın satırları bölünmeden sığsın ve balon başın en az 40px
    # üstünde bitsin. İkisi birden olmazsa baş kuralı yeterli; o da olmazsa en küçük punto.
    paras = len([p for p in text.split("\n") if p.strip()])
    choice = None
    for punto in range(60, 37, -2):
        lay = layout(text, punto, d)
        fits_head = MARGIN + lay[4] <= hy - 40
        if fits_head and len(lay[1]) == paras:
            choice = lay
            break
        if fits_head and choice is None:
            choice = lay
    font, lines, lh, bw, bh = choice or layout(text, 38, d)
    cx = max(MARGIN + bw // 2, min(W - MARGIN - bw // 2, hx))
    x0, y0 = cx - bw // 2, MARGIN
    x1, y1 = x0 + bw, y0 + bh
    tx, ty = hx, max(hy - 6, y1 + 20)
    base_cx = max(x0 + 90, min(x1 - 90, tx))
    tail = [(base_cx - 38, y1 - 22), (base_cx + 38, y1 - 22), (tx, ty)]

    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(layer)
    sd.ellipse((x0 + 8, y0 + 10, x1 + 8, y1 + 10), fill=(0, 0, 0, 90))
    sd.polygon([(p[0] + 8, p[1] + 10) for p in tail], fill=(0, 0, 0, 90))
    ld = ImageDraw.Draw(layer)
    ld.polygon(tail, fill="black")
    ld.ellipse((x0, y0, x1, y1), fill="black")
    shift = 0 if tx == base_cx else (BORDER if tx < base_cx else -BORDER)
    ld.polygon(
        [(tail[0][0] + BORDER, tail[0][1]), (tail[1][0] - BORDER, tail[1][1]),
         (tx + shift, ty - int(BORDER * 1.8))],
        fill="white",
    )
    ld.ellipse((x0 + BORDER, y0 + BORDER, x1 - BORDER, y1 - BORDER), fill="white")
    ty0 = y0 + (bh - lh * len(lines)) // 2
    for i, l in enumerate(lines):
        lw = ld.textlength(l, font=font)
        ld.text(((x0 + x1) / 2 - lw / 2, ty0 + i * lh), l, font=font, fill="black")
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mod", choices=["hazirla", "balon"])
    ap.add_argument("girdi")
    ap.add_argument("cikti")
    ap.add_argument("metin", nargs="?")
    ap.add_argument("--kafa")
    a = ap.parse_args()

    img = Image.open(a.girdi)
    if a.mod == "hazirla":
        out = fit_cover(trim_bars(img.convert("RGB")))
    else:
        if not a.metin or not a.kafa:
            raise SystemExit("balon modu için metin ve --kafa gerekli")
        hx, hy = map(int, a.kafa.split(","))
        out = add_bubble(fit_cover(img), a.metin, hx, hy)
    out.save(a.cikti, "JPEG", quality=92)
    print("ok")


if __name__ == "__main__":
    main()
