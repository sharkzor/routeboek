#!/bin/sh
# Wacht op de database, voer migraties uit en importeer de routes.
set -e

echo "Wachten op de database ..."
python - <<'PY'
import os, sys, time
import psycopg
url = os.environ["DATABASE_URL"].replace("postgresql+psycopg://", "postgresql://")
for attempt in range(60):
    try:
        with psycopg.connect(url, connect_timeout=3):
            print("Database bereikbaar.")
            sys.exit(0)
    except Exception as exc:
        if attempt == 0:
            print(f"Nog niet bereikbaar: {exc}")
        time.sleep(2)
print("Database blijft onbereikbaar.", file=sys.stderr)
sys.exit(1)
PY

echo "Migraties uitvoeren ..."
alembic upgrade head

if [ "${SEED_ON_START:-true}" = "true" ]; then
    echo "Routes importeren ..."
    python -m app.seed || echo "Import overgeslagen."
fi

exec "$@"
