FROM node:22-bookworm-slim

WORKDIR /app

# git: proje araçları (run_command/git) için; openssh-client: gerekirse
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates openssh-client \
  && rm -rf /var/lib/apt/lists/*

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
