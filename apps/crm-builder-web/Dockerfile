FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 python3-pip \
    libqpdf-dev \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*
# Retry the pip install: PyPI's index occasionally returns a truncated JSON
# response mid-resolution (JSONDecodeError "Unterminated string"), which fails
# the whole Docker build for a transient registry hiccup. Retry up to 5 times
# with backoff, longer timeouts, and no cache so a partial download can't stick.
RUN for i in 1 2 3 4 5; do \
      pip3 install --no-cache-dir --retries 5 --timeout 120 \
        pypdf "cryptography==41.0.7" pikepdf --break-system-packages && break; \
      echo "pip install attempt $i failed; retrying in 10s..."; \
      sleep 10; \
      [ "$i" = 5 ] && exit 1; \
    done

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/crm-builder-web/package.json ./apps/crm-builder-web/
RUN npm ci --workspace=@jungle/crm-builder-web --ignore-scripts
COPY apps/crm-builder-web ./apps/crm-builder-web
RUN npm run build --workspace=@jungle/crm-builder-web

WORKDIR /app/apps/crm-builder-web
ENV NODE_ENV=production
ENV PORT=3006
EXPOSE 3006
CMD ["npm", "run", "start"]
