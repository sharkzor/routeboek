# Stampers Routeboek

Het routeboek van wielrenclub **Maximus Stampers** ([stampers.cc](https://stampers.cc)).
Deze applicatie vervangt de clubpagina op
[routeboek.cc/club/stampers](https://routeboek.cc/club/stampers), waaruit alle
bestaande routes zijn overgenomen.

Productie: <https://routeboek.unencrypted.nl>

## Functionaliteit

- Routeoverzicht met filters (afstand, windrichting, soort, beoordeling,
  aanbevolen voor) en GPX/TCX-downloads, optioneel met drinkwaterpunten
- Registratie met verplichte e-mailverificatie, login met lockout na te veel
  pogingen, wachtwoordherstel
- Ritten organiseren en aanmelden, met weerbericht per rit
- Events (sportives, meerdaagse tochten) met reismaatje en vervoerskeuze
- Community-routes: leden leveren zelf een GPX aan; admins kunnen deze
  promoveren naar het officiële routeboek
- Reacties en waarderingen per route, favorieten en "gereden"-markering
- Beheerpagina: routes toevoegen/bewerken/verwijderen, gebruikersbeheer

## Techniek

| Laag | Keuze |
|---|---|
| Backend | Python 3.14, FastAPI, SQLAlchemy 2.0 (sync), Alembic |
| Database | PostgreSQL 18 |
| Wachtwoorden | Argon2id |
| Frontend | React 19, TypeScript, Vite, Mantine UI, Leaflet |
| Container | Docker (multi-stage: Node build → Python runtime) |

Zie `.github/copilot-instructions.md` voor de volledige architectuur- en
conventiebeschrijving.

## Installatie / opzetten

### Vereisten

- Docker en Docker Compose
- Een SMTP-account voor het versturen van e-mail (verificatie, wachtwoordherstel)

### 1. Repository klonen

```bash
git clone https://github.com/sharkzor/routeboek.git
cd routeboek
```

> `data/` staat in `.gitignore` en wordt bij eerste start automatisch
> aangemaakt. Voor de 166 officiële clubroutes is een seedbestand nodig; zie
> [Routes seeden](#3-routes-seeden-optioneel).

### 2. Omgevingsvariabelen instellen

```bash
cp .env.example .env
```

Vul in `.env` in ieder geval in:

- `POSTGRES_PASSWORD` — een lang, willekeurig wachtwoord
- `BASE_URL` — het adres waarop de app bereikbaar is (voor links in e-mails)
- `ADMIN_EMAIL` / `ADMIN_NAME` — dit account krijgt automatisch
  beheerdersrechten
- `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_HOST` / `SMTP_FROM` — voor
  verificatie- en herstelmails. Zonder werkende SMTP kun je registreren, maar
  niet de verificatiemail ontvangen
- `APP_UID` / `APP_GID` — uitkomst van `id -u` en `id -g`, zodat de container
  in `./data` mag schrijven

`SECRET_KEY` mag leeg blijven: wordt dan eenmalig gegenereerd in
`data/secret.key`. Zet `COOKIE_SECURE=false` alleen als je lokaal via
`http://` test (niet in productie).

### 3. Bouwen en starten

```bash
docker compose up -d --build
```

Dit start Postgres en de app (standaard op poort **8083**), draait
automatisch de Alembic-migraties en (indien `SEED_ON_START=true`) de
routes-import bij het opstarten.

Controleer de status:

```bash
docker compose logs -f app
```

De app is nu bereikbaar op `http://<server>:8083`.

### 4. Routes seeden (optioneel)

Als je beschikt over `data/seed/routes.json` (de gescrapete routes van het
oude routeboek.cc, incl. `data/media/{gpx,tcx,maps}`), kan de import ook
handmatig (opnieuw, idempotent) worden gedraaid:

```bash
docker compose exec app python -m app.seed
```

Zonder dit bestand start de app gewoon met een lege routetabel; routes kunnen
dan via de beheerpagina (GPX-upload) of door leden via community-routes
worden toegevoegd.

### 5. Eerste beheerderswachtwoord instellen

Het account uit `ADMIN_EMAIL` wordt aangemaakt met een willekeurig
wachtwoord. Gebruik eenmalig "wachtwoord vergeten" op de inlogpagina om er
zelf een in te stellen.

## Ontwikkelen (lokaal, zonder Docker)

Backend en frontend kunnen ook los draaien voor ontwikkeling:

```bash
# Postgres lokaal beschikbaar hebben (bijv. via docker compose up -d db)

# Backend
cd backend
python3.14 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL="postgresql+psycopg://routeboek:<wachtwoord>@localhost:5432/routeboek"
export SECRET_KEY=dev
export DATA_DIR=../data
alembic upgrade head
uvicorn app.main:app --reload --port 8083

# Frontend (in een andere terminal)
cd frontend
npm install
npm run dev
```

De Vite-devserver proxyt API-calls naar `127.0.0.1:8083` (zie
`frontend/vite.config.ts`).

## Database-migraties

Nieuwe migratie toevoegen (autogenerate heeft een draaiende Postgres nodig):

```bash
cd backend
DATABASE_URL="postgresql+psycopg://routeboek:<wachtwoord>@localhost:5432/routeboek" \
  SECRET_KEY=dev DATA_DIR=/tmp/rbdata alembic revision --autogenerate -m "beschrijving"
```

Migraties worden bij het opstarten van de container automatisch toegepast
(`alembic upgrade head`).

## Licentie

Intern project van wielrenclub Maximus Stampers.
