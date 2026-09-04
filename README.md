# Stampers Routeboek

Het routeboek van wielrenclub **Maximus Stampers** ([stampers.cc](https://stampers.cc)).
Deze applicatie vervangt de clubpagina op
[routeboek.cc/club/stampers](https://routeboek.cc/club/stampers), waaruit alle
bestaande routes zijn overgenomen.

Productie: <https://routeboek.unencrypted.nl>

## Functionaliteit

- **Routeoverzicht** met filters (afstand, windrichting, soort route,
  beoordeling, aanbevolen voor, favoriet/gereden), serverside gesorteerd
  (standaard op afstand kort → lang); op mobiel een uitklapbare filter-lade
  die open blijft tot je zelf "Toon resultaten" indrukt
- GPX/TCX-downloads, optioneel met **drinkwaterpunten** toegevoegd
  (drinkwaterpunten.nl, instelbare zoekradius)
- **Controle op verboden paden**: achteraf checken of een route over stukken
  loopt waar fietsen niet mag, met een visuele weergave op de kaart
  (rood/oranje) — gebaseerd op een lokaal bijgehouden kopie van de
  Nederlandse OpenStreetMap-wegenkaart (maandelijks te verversen via de
  beheerpagina), zodat een controle enkele seconden duurt i.p.v. minuten
- Registratie met verplichte e-mailverificatie, login met lockout na te veel
  pogingen, wachtwoordherstel
- **Ritten organiseren en aanmelden**: vaste standaardtijdstippen
  (woensdag 19:00 / zondag 10:00), weerbericht per rit (temperatuur,
  windrichting/-kracht in Beaufort, neerslag), een eigen rit-detailpagina,
  en een deelknop die een kant-en-klaar WhatsApp/Telegram-bericht met link
  naar de rit op het klembord zet. Een aparte **historie**-tab toont
  verstreken ritten (zoekbaar, filterbaar op "alleen mijn ritten",
  gepagineerd)
- **Privé-ritten**: verschijnen niet in het standaardoverzicht, maar zijn via
  een deelbare link (met sleutel) alsnog voor genodigden te openen en blijven
  daarna voor hen zichtbaar, ook na afmelden
- **Events** (sportives, meerdaagse tochten, verder vooruit gepland): naam,
  type, afstand, datum/tijd, link, kosten, optioneel een route/GPX, snelheid,
  deelnemers en vervoerskeuze per deelnemer (auto/trein/eigen
  gelegenheid/fiets)
- **Community-routes**: leden leveren zelf een GPX aan via een
  twee-staps-wizard, met een eigen overzicht (filters + sortering op meeste
  stemmen); admins kunnen een inzending promoveren naar het officiële
  routeboek, de aanbieder (of een admin) kan 'm ook weer intrekken
- Reacties en waarderingen per route (gewogen met de historische
  routeboek.cc-waardering), **favorieten** en **"gereden"-markering** per lid
- Automatisch gegenereerde kaartminiatuur (OSM-achtergrond + routelijn) voor
  routes zonder eigen kaartbestand (community- en zelf toegevoegde routes)
- Beheerpagina: routes toevoegen (GPX-upload)/bewerken/verwijderen,
  gebruikersbeheer, en beheer van de lokale OSM-wegenkaart (status +
  handmatig verversen)
- **Telegram-integratie**: nieuwe ritten worden automatisch in het
  clubkanaal geplaatst (bewerken/annuleren werkt het bestaande
  kanaalbericht bij), en de wegkapitein ontvangt vlak voor vertrek een
  Telegram-DM met de deelnemerslijst. Koppelen via "Mijn account" (geen
  telefoonnummer nodig, alleen een `/start`-deeplink naar de bot)

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
- Voor de controle op verboden paden: eenmalig (en daarna maandelijks) een
  download van ~1,4 GB (Geofabrik NL-extract) en tijdelijk ~2,3 GB RAM tijdens
  het verwerken — te starten via de beheerpagina, niet verplicht om de rest
  van de app te gebruiken

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
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHANNEL_ID` / `TELEGRAM_WEBHOOK_SECRET` —
  optioneel; zonder bot-token blijft de Telegram-integratie stil uitgeschakeld
  (geen ritten in een kanaal, geen deelnemersreminder)

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
