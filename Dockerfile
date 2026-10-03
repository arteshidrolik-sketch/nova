FROM node:22-bookworm-slim

WORKDIR /app

# git: proje araçları (run_command/git); openssh-client: gerekirse;
# ffmpeg + fonts-dejavu-core: video düzenleme (edit_video — yazı bindirme/kesme,
# Türkçe karakter destekli font drawtext için).
# python3-pil: Sanal Dilenci görsellerine konuşma balonu (assets/ig/balon.py).
# fonts-noto-color-emoji + yt-dlp (venv): Viral Yorum — yorum kartlarında emoji, Reels indirme.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates openssh-client ffmpeg fonts-dejavu-core fonts-noto-color-emoji python3 python3-pil python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/yt && /opt/yt/bin/pip install --no-cache-dir yt-dlp
ENV YTDLP_BIN=/opt/yt/bin/yt-dlp

# Vercel CLI: kullanıcı uygulamalarını canlıya yayınlamak için (deploy_vercel aracı).
# İmaja gömülü → çalışma anında indirme yok, deploy anında hazır.
RUN npm i -g vercel@latest

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["npm", "run", "start"]
