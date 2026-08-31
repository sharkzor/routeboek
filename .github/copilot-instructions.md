# Routeboek Maximus Stampers — instructies voor AI-assistenten

Deze applicatie is het nieuwe routeboek van de wielrenclub **Maximus Stampers**
(officiële clubsite: <https://stampers.cc>). Het vervangt de clubpagina op
<https://routeboek.cc/club/stampers>, waaruit alle bestaande routes zijn
overgenomen.

Productie-URL: <https://routeboek.unencrypted.nl> (reverse proxy `nginxproxy`
op een Raspberry Pi die doorstuurt naar deze server op poort **8083**).

## Status

De applicatie draait en is end-to-end getest: 166 routes geïmporteerd,
registratie + e-mailverificatie, login/lockout, wachtwoordherstel, filters,
GPX/TCX-downloads, waterpunten, ritten aanmaken/aanmelden en de beheerpagina.
Het beheerdersaccount `r.vloothuis@gmail.com` bestaat met een willekeurig
wachtwoord: gebruik eenmalig "wachtwoord vergeten" om er zelf één in te stellen.

---

## 1. Taal- en stijlafspraken

- **Alle gebruikerszichtbare tekst is Nederlands.** UI-labels, foutmeldingen,
  e-mails en validatieteksten.
- **Code-commentaar en docstrings zijn Nederlands.** Identifiers, tabelnamen en
  API-velden zijn Engels.
- Commentaar alleen waar het iets toevoegt (het *waarom*, niet het *wat*).
- Python: type hints overal, `from __future__ import annotations` bovenaan.
- TypeScript: `strict` staat aan; geen `any` tenzij echt onvermijdelijk.

---

## 2. Technische stack

| Laag | Keuze | Versie | Waarom |
|---|---|---|---|
| Runtime backend | Python | 3.14 (`python:3.14-slim-trixie`) | security-support t/m okt 2030 |
| API | FastAPI | 0.141.x | snel, automatische OpenAPI |
| ORM | SQLAlchemy | 2.0.x (sync) | zie §5 |
| Migraties | Alembic | 1.19.x | |
| Database | PostgreSQL | 18 (`postgres:18-alpine`) | support t/m nov 2030, JSONB + ARRAY |
| DB-driver | psycopg (v3) | 3.3.x | |
| Wachtwoorden | argon2-cffi (Argon2id) | 25.1.x | |
| Frontend | React | 19.2.x | |
| Taal frontend | TypeScript | 7.x | |
| Bundler | Vite | 8.x | |
| UI-bibliotheek | **Mantine** | 9.5.x | kaartgrids, filters, date/time pickers |
| Routing | react-router | 8.x | |
| Kaarten | Leaflet + react-leaflet | 1.9.x / 5.x | OSM-tiles, geen API-key nodig |
| Buildstage | Node | 24-alpine (LTS) | |

> **Belangrijk:** versies zijn gecontroleerd tegen de npm- en PyPI-registry op
> het moment van bouwen. Controleer bij een upgrade opnieuw de laatste stabiele
> versie — gok niet uit het geheugen. Let er ook op dat gecompileerde packages
> (`shapely`, `psycopg-binary`, `argon2-cffi-bindings`, `lxml`, `pydantic-core`)
> een `cp314` manylinux-wheel hebben, anders faalt de Docker-build.

---

## 3. Mappenstructuur

```
routeboek/
├── .github/copilot-instructions.md   dit bestand
├── docker-compose.yml                app (8083) + postgres 18
├── Dockerfile                        multi-stage: node build -> python runtime
├── .env / .env.example               geheimen en instellingen
├── backend/
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── alembic/                      migraties
│   └── app/
│       ├── config.py                 Settings (pydantic-settings)
│       ├── db.py                     engine + sessiefactory
│       ├── models.py                 SQLAlchemy-modellen
│       ├── schemas.py                Pydantic in/uit-modellen
│       ├── security.py               hashing, tokens, sessies, CSRF
│       ├── mail.py                   SMTP-verzending (Ziggo)
│       ├── deps.py                   FastAPI-dependencies (auth-guards)
│       ├── seed.py                   import van data/seed/routes.json
│       ├── main.py                   app-factory, static hosting, SPA-fallback
│       ├── routers/
│       │   ├── auth.py               registratie, login, verificatie, reset
│       │   ├── users.py              ledenlijst (id + naam) voor keuzevelden
│       │   ├── routes.py             routeoverzicht + filters + downloads
│       │   ├── rides.py              ritten organiseren en deelnemen
│       │   ├── water.py              waterpunten toevoegen aan een GPX
│       │   └── admin.py              beheer van routes en gebruikers
│       ├── services/
│       │   └── rides.py              ritten-logica los van FastAPI
│       └── water/                    overgenomen uit /home/shark/gpx
│           ├── geo.py                projectie, NL-detectie, bounding box
│           ├── gpx_service.py        GPX lezen/schrijven
│           ├── osm_service.py        Overpass API
│           ├── waterpoints_nl.py     drinkwaterpunten.nl (24u cache)
│           ├── route_service.py      koppelen aan route, dedupe, statistiek
│           └── processing.py         orkestratie
├── frontend/
│   ├── index.html
│   ├── vite.config.ts                dev-proxy naar 127.0.0.1:8083
│   └── src/
│       ├── api/                      typed fetch-client (client.ts, types.ts)
│       ├── auth/AuthContext.tsx      sessiestatus
│       ├── components/               AppLayout, AuthShell, Guards, RouteCard,
│       │                             RouteFilters, RouteMap, Stars, WaterDialog
│       ├── pages/                    Login, Register, ForgotPassword,
│       │                             ResetPassword, Verify, Routes,
│       │                             RouteDetail, Rides, RideForm, Admin,
│       │                             Account
│       ├── theme.ts                  Routeboek-huisstijl
│       ├── styles.css                huisstijlklassen (.rb-*)
│       └── main.tsx                  providers + router
├── scripts/
│   └── scrape_routeboek.py           eenmalige migratie van routeboek.cc
└── data/                             volume, niet in git
    ├── seed/routes.json              gescrapete metadata (166 routes, 9,4 MB)
    ├── media/{gpx,tcx,maps}/         routebestanden en kaartafbeeldingen
    ├── cache/                        drinkwaterpunten-cache
    ├── tmp/                          gegenereerde GPX met waterpunten
    └── secret.key                    automatisch gegenereerd als SECRET_KEY leeg is
```

> `data/` staat in `.gitignore` (ruim 140 MB). Een verse clone heeft de map dus
> niet; draai `scripts/scrape_routeboek.py` opnieuw of kopieer de map mee.

---

## 4. Datamigratie vanaf routeboek.cc

`scripts/scrape_routeboek.py` heeft de 166 routes overgenomen. De bron is een
ASP.NET WebForms-site; drie technieken waren nodig:

1. **Overzichtspagina** (`/club/stampers`) bevat alle routes in de HTML:
   id, slug, naam, afstand, hoogtemeters, sterrenrating (als pixelbreedte,
   `width / 20 = sterren`) en de kaartafbeelding.
2. **Filtereigenschappen zijn niet zichtbaar in de HTML.** Windrichting,
   routetype en "aanbevolen voor" zijn afgeleid door het filterformulier te
   POSTen (`__EVENTTARGET`, `__VIEWSTATE`, `__EVENTVALIDATION`) en te kijken
   welke routes overblijven. Eén postback per filterwaarde.
3. **Detailpagina** (`/club/stampers/route/<slug>`) levert beschrijving,
   Strava-link, GPX/TCX-URL's en de volledige geometrie, die als
   `{ lat: .., lng: .. }`-array in de `initMap()` JavaScript staat.

Reacties zijn bewust **niet** overgenomen (geen gebruikersdatabase in de bron).

Bekende bron-afwijking: `gravel-huize-scherpenzeel-v2` heeft op routeboek.cc een
kapotte bestandsnaam (dubbele spatie) en geeft 404. De GPX/TCX wordt voor die
route gegenereerd uit de gescrapete coördinaten.

De scraper is eenmalig bedoeld. Draai hem niet opnieuw tegen productie zonder
reden; wees vriendelijk voor de bronsite (er zit een `--delay`).

---

## 5. Backend-conventies

- **SQLAlchemy wordt synchroon gebruikt** met gewone `def`-endpoints. FastAPI
  draait die in een threadpool. Bewuste keuze: de waterpunten-analyse
  (`requests`, `shapely`, `geopy`) is toch blokkerende code. Introduceer geen
  `async def`-endpoints die de database raken.
- Elk endpoint krijgt de sessie via `Depends(get_db)`.
- Schemamutaties gaan **altijd** via een Alembic-migratie, nooit via
  `create_all()`.
- Enums staan zowel in Python (`enum.Enum`) als in Postgres (`Enum(...)`).
  Een nieuwe enumwaarde vereist dus een migratie met `ALTER TYPE ... ADD VALUE`.
- Route-eigenschappen die meerdere waarden hebben (`wind_directions`,
  `categories`) zijn Postgres-`ARRAY`; geometrie is `JSONB`.

### Datamodel (kern)

- `users` — account, `is_admin`, `is_active`, `email_verified_at`, lockout-teller
- `user_sessions` — serverside sessies; de cookie bevat alleen een random token
- `email_tokens` — eenmalige tokens (`verify_email`, `reset_password`)
- `routes` — de 166 geïmporteerde routes plus door admins toegevoegde routes
- `rides` — georganiseerde ritten
- `ride_participants` — aanmeldingen (uniek per rit/gebruiker)

---

## 6. Beveiliging

Dit is een publiek bereikbare applicatie. Houd je aan de volgende regels:

1. **Alle API-endpoints vereisen authenticatie**, behalve `/api/auth/*` en
   `/api/health`. Gebruik de dependencies uit `app/deps.py`
   (`current_user`, `current_admin`); voeg nooit een ongeauthenticeerd endpoint
   toe zonder expliciete reden.
2. **Wachtwoorden** worden gehasht met Argon2id. Nooit ergens loggen.
3. **Sessies** zijn serverside. De cookie `rb_session` is `HttpOnly`,
   `SameSite=Lax` en `Secure` in productie. Uitloggen trekt de sessie in de
   database in.
4. **CSRF**: naast `SameSite=Lax` geldt double-submit. Bij login wordt een
   niet-`HttpOnly` cookie `rb_csrf` gezet; elke `POST`/`PUT`/`PATCH`/`DELETE`
   moet de header `X-CSRF-Token` meesturen. De frontend-client doet dit
   automatisch.
5. **Tokens** (verificatie, reset) worden als SHA-256 hash opgeslagen en zijn
   eenmalig en aan een vervaltijd gebonden.
6. **Accountenumeratie voorkomen**: registratie, "wachtwoord vergeten" en login
   geven altijd hetzelfde generieke antwoord, ongeacht of het e-mailadres
   bestaat.
7. **Rate limiting / lockout** op inlogpogingen (`max_login_attempts` binnen
   `login_window_minutes`, daarna `lockout_minutes` geblokkeerd). De
   lockout-check staat in `auth.login` **vóór** de wachtwoordcontrole; anders
   kan een aanvaller ongelimiteerd blijven raden. Laat die volgorde staan.
8. **Geen geheimen in git.** `.env` staat in `.gitignore`; `.env.example`
   bevat alleen placeholders.
9. De app draait als niet-root gebruiker in de container (`APP_UID`/`APP_GID`
   uit `.env`, standaard 1000, zodat de bind-mount `./data` beschrijfbaar is).
10. Achter de reverse proxy draait uvicorn met `--proxy-headers`.
11. **Mediabestanden** (GPX/TCX/kaarten) gaan via endpoints, niet via
    `StaticFiles`, zodat ze alleen voor ingelogde gebruikers beschikbaar zijn.
    `_media_path()` in `routers/routes.py` weert path traversal.

### Registratie

Iedereen mag zich registreren, maar **e-mailverificatie is verplicht** voordat
er ingelogd kan worden. `r.vloothuis@gmail.com` krijgt bij het opstarten
automatisch adminrechten (instelbaar via `ADMIN_EMAIL`).

---

## 7. E-mail

Verzending loopt via het Ziggo-account `routeboek@ziggo.nl`.

- Host `smtp.ziggo.nl`, poort **587 met STARTTLS** (465 met impliciete TLS werkt
  ook). Poort 25 is geblokkeerd.
- Credentials staan in `.env` (`SMTP_USER`, `SMTP_PASSWORD`) — **niet in git**.
- Verzenden gebeurt in een FastAPI `BackgroundTask`, zodat een trage SMTP-server
  het request nooit ophoudt.
- Een mislukte verzending mag nooit informatie lekken over het bestaan van een
  account.

---

## 8. Functionaliteit

### Routeoverzicht
Filterpaneel links, kaartgrid rechts (zie `routes.png`). Filters: zoekterm,
kilometerbereik, windrichting (N/O/Z/W, meerdere), soort route
(weg / weg met gravel / gravel-cross), minimale beoordeling, aanbevolen voor
(beginners / snelle groepen / toeristisch). Sortering op naam, afstand,
hoogtemeters, beoordeling of recentheid. Filteren gebeurt **serverside**.

### Rit organiseren
Zie `rit.png`. Velden: naam (standaard de routenaam), eigenaar (wegkapitein),
datum, tijd, route, type rit (Race / Race met Gravel / Gravel), afstand,
snelheid km/u, max. deelnemers (4 t/m 12), opmerkingen, privé-rit.

**Standaardtijdstip:** de club rijdt woensdag 19:00 en zondag 10:00. Het
eerstvolgende van die twee momenten is de voorgevulde datum en tijd.

Een privé-rit verschijnt niet in het standaardoverzicht.

### Waterpunten
Bij het downloaden van een route kan de gebruiker drinkwaterpunten laten
toevoegen aan de GPX. De logica is overgenomen uit `/home/shark/gpx`
(container `gpx-drinkwaterpunten`):

- Ligt de route grotendeels in Nederland (`nl_share >= 0.8`), dan wordt
  drinkwaterpunten.nl gebruikt, anders OpenStreetMap via Overpass.
- Punten binnen `radius_m` van de route worden gekoppeld, ontdubbeld en op
  rijrichting gesorteerd.
- Er komt een waarschuwing bij een "droog" stuk langer dan `gap_warning_km`.

### Adminpagina
Routes toevoegen (GPX-upload) en verwijderen, gebruikers activeren/blokkeren en
adminrechten toekennen.

---

## 9. Frontend-conventies

- Alle API-aanroepen lopen via de client in `src/api/`. Die zet
  `credentials: "include"` en de `X-CSRF-Token`-header. Gebruik nooit een kale
  `fetch` naar de eigen API.
- Een `401` betekent uitloggen en terug naar het loginscherm.
- Huisstijl (overgenomen van routeboek.cc / stampers.cc):
  - primair rood `#F4244E`, accentblauw voor actieknoppen
  - font **Archivo** (Google Fonts)
  - rode header met topografisch lijnenpatroon, witte kaarten met zachte schaduw
- Mantine-theming staat centraal in `src/theme.ts`; geen losse hardgecodeerde
  kleuren in componenten.
- Leaflet en de kaartweergave worden lui geladen (`lazy(() => import(...))` in
  `RouteDetailPage`), zodat de hoofdbundel klein blijft.
- Routes in de router zijn Nederlandstalig (`/inloggen`, `/registreren`,
  `/wachtwoord-vergeten`, `/wachtwoord-herstellen`, `/verifieren`, `/routes`,
  `/ritten`, `/beheer`, `/account`). De e-maillinks in `routers/auth.py`
  verwijzen naar `/verifieren` en `/wachtwoord-herstellen` — pas ze samen aan.

---

## 10. Draaien en deployen

```bash
# bouwen en starten (poort 8083, luistert op alle interfaces)
sudo docker compose up -d --build

# routes importeren uit data/seed/routes.json (idempotent)
sudo docker compose exec app python -m app.seed

# logs
sudo docker compose logs -f app

# databaseshell
sudo docker exec -e PGPASSWORD=... routeboek-db psql -U routeboek -d routeboek
```

- Docker vereist op deze server `sudo`.
- Poort 8083 is gekozen omdat 8080, 8081, 8082, 8085, 8090, 8096 en 8106 al
  bezet zijn door andere containers. Controleer bij wijzigingen met `ss -tlnp`.
- De frontend wordt in de Docker-build gecompileerd en als statische bestanden
  door FastAPI geserveerd, met SPA-fallback naar `index.html`.
- `data/` is een volume; de mediabestanden (~140 MB) staan daar en niet in git.
- **Postgres 18** wil de volume-mount op `/var/lib/postgresql` (niet
  `/var/lib/postgresql/data`); anders start de container niet.
- Het entrypoint wacht op de database, draait `alembic upgrade head` en seedt
  daarna de routes (`SEED_ON_START`).

### Migraties

Autogenerate heeft een draaiende Postgres nodig. Zo is de eerste migratie
gemaakt:

```bash
sudo docker run -d --rm --name rb-tmp-db -e POSTGRES_DB=routeboek \
  -e POSTGRES_USER=routeboek -e POSTGRES_PASSWORD=migrate \
  -p 127.0.0.1:55432:5432 postgres:18-alpine
cd backend && DATABASE_URL="postgresql+psycopg://routeboek:migrate@127.0.0.1:55432/routeboek" \
  SECRET_KEY=dev DATA_DIR=/tmp/rbdata alembic revision --autogenerate -m "beschrijving"
sudo docker rm -f rb-tmp-db
```

---

## 11. Toekomstplannen

Houd hier rekening mee bij het ontwerp:

- **Telegram-bot**: ritten automatisch in een kanaal posten en ritten via de bot
  aanmaken. Houd de ritten-logica daarom in de servicelaag, niet in de router,
  zodat een bot dezelfde code kan gebruiken.
- Ritten aanmaken wordt verder uitgewerkt (herhalende ritten, aanmeldingen,
  wegkapitein-rollen).
- Beoordelingen en reacties op routes (bewust nog niet gemigreerd).
