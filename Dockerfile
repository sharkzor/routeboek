# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- frontend ---
FROM node:24-alpine AS frontend

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci || npm install
COPY frontend/ ./
RUN npm run build

# ----------------------------------------------------------------- backend ---
FROM python:3.14-slim-trixie AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DATA_DIR=/app/data \
    PORT=8083 \
    TZ=Europe/Amsterdam

WORKDIR /app

# osmium-tool bouwt de lokale wegenkaart op (zie app/services/osm_index.py).
# Het zware werk daarvan is C++; Python leest alleen het resultaat.
RUN apt-get update \
    && apt-get install -y --no-install-recommends osmium-tool \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./alembic.ini
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

COPY --from=frontend /build/dist ./app/static

RUN chmod +x /usr/local/bin/entrypoint.sh \
    && useradd --create-home --uid 10001 appuser \
    && mkdir -p /app/data/cache /app/data/tmp /app/data/media /app/data/osm \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 8083

HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:'+os.getenv('PORT','8083')+'/api/health').read()"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8083} --proxy-headers --forwarded-allow-ips '*'"]
