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
- **Quick start**: kies een moment en type rit en krijg automatisch 4
  passende routes (50-110 km) op basis van de verwachte windrichting op dat
  moment en je eigen favorieten (aangevuld met de best beoordeelde routes),
  met een knop om alsnog zelf te bladeren in het routeboek
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
  gepagineerd). Staat de gewenste route nog niet in het routeboek? Met de
  knop **"Eigen route"** kun je die er direct bij aanmaken (optioneel een
  GPX-upload, optioneel een Strava-/Komoot-link) — de route komt dan meteen
  ook in het community-routeboek te staan
- **Privé-ritten**: verschijnen niet in het standaardoverzicht, maar zijn via
  een deelbare link (met sleutel) alsnog voor genodigden te openen en blijven
  daarna voor hen zichtbaar, ook na afmelden
- **Events** (sportives, meerdaagse tochten, verder vooruit gepland): naam,
  type, afstand, datum/tijd, link, kosten, optioneel een route/GPX, snelheid,
  deelnemers en vervoerskeuze per deelnemer (auto/trein/eigen
  gelegenheid/fiets)
- **Community-routes**: leden leveren zelf een GPX aan via een
  twee-staps-wizard (optioneel met TCX-upload en een Strava-/Komoot-link),
  met een eigen overzicht (filters + sortering op meeste stemmen); admins
  kunnen een inzending promoveren naar het officiële routeboek, de aanbieder
  (of een admin) kan 'm ook weer intrekken. Bij het aanleveren staan de
  voorwaarden duidelijk vermeld: start en eindig bij Maximus, rijd 'm vooraf
  zelf uit en zorg dat er geen illegale paden in zitten
- Reacties en waarderingen per route (gewogen met de historische
  routeboek.cc-waardering), **favorieten** en **"gereden"-markering** per lid
- **Route melden**: knop op de routepagina om beheerders per mail te laten
  weten dat er iets mis is met een route (vrije tekst)
- **Werkzaamheden en bijzonderheden**: eigen overzicht waar leden tijdelijke
  meldingen plaatsen (werkzaamheden, gevaar of een andere bijzonderheid) met
  een einddatum en een koppeling aan een of meer routes. Ze verschijnen in een
  vak onderaan de betreffende routepagina en verdwijnen automatisch zodra de
  einddatum verstreken is
- Automatisch gegenereerde kaartminiatuur (OSM-achtergrond + routelijn) voor
  routes zonder eigen kaartbestand (community- en zelf toegevoegde routes)
- Beheerpagina: routes toevoegen (GPX-upload, optioneel met TCX en een
  Strava-/Komoot-link)/bewerken/verwijderen, gebruikersbeheer, en beheer van
  de lokale OSM-wegenkaart (status + handmatig verversen)
- **Instellingen via de beheerpagina**: SMTP, Telegram, sessieduur,
  lockout-beleid en waterpunt-standaarden staan in de database en zijn
  zonder herstart aan te passen, inclusief testknoppen voor mail en Telegram
- **Backup en restore**: elke nacht om 01:00 automatisch een databasebackup
  (de laatste 3 plus een wekelijkse van zondagnacht blijven staan), plus
  handmatige backups met of zonder media, downloaden, uploaden en terugzetten
- **Installatiewizard** (`/setup`) voor een verse omgeving: beheerdersaccount
  aanmaken óf een backup van een andere server terugzetten — het bedoelde pad
  om te verhuizen naar een hoster of Azure
- **Telegram-integratie**: nieuwe ritten worden automatisch in het
  clubkanaal geplaatst (bewerken/annuleren werkt het bestaande
  kanaalbericht bij), en de wegkapitein ontvangt vlak voor vertrek een
  Telegram-DM met de deelnemerslijst. Koppelen via "Mijn account" (geen
  telefoonnummer nodig, alleen een `/start`-deeplink naar de bot); een
  eigen **infopagina** (`/informatie`) legt dit uit aan leden en linkt naar
  het kanaal

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
> [Routes seeden](#5-routes-seeden-optioneel).

### 2. Omgevingsvariabelen instellen

```bash
cp .env.example .env
```

Sinds de installatiewizard hoeft hier **veel minder** in te staan dan vroeger:
de meeste instellingen vul je straks in de browser in en die belanden in de
database. In `.env` horen alleen de dingen die de app nodig heeft *voordat* er
een database is, of die bij de server horen in plaats van bij de club:

- `POSTGRES_PASSWORD` — een lang, willekeurig wachtwoord
- `BASE_URL` — het adres waarop de app bereikbaar is (voor links in e-mails)
- `APP_UID` / `APP_GID` — uitkomst van `id -u` en `id -g`, zodat de container
  in `./data` mag schrijven
- `COOKIE_SECURE` — zet dit alleen op `false` als je lokaal via `http://`
  test, nooit in productie
- `SETUP_TOKEN` — optioneel. Laat je dit leeg, dan genereert de app er zelf
  een bij het opstarten en zet 'm in de logs

`SECRET_KEY` mag leeg blijven: die wordt dan eenmalig gegenereerd in
`data/secret.key`.

> SMTP, Telegram, sessieduur, lockout-beleid en de waterpunt-instellingen
> horen **niet** meer in `.env` — die stel je in via **Beheer →
> Instellingen**, waar ze zonder herstart actief worden. Zet je ze toch in
> `.env`, dan gelden ze als startwaarde totdat iemand ze in de UI wijzigt.

### 3. Bouwen en starten

```bash
docker compose up -d --build
```

Dit start Postgres en de app (standaard op poort **8083**) en draait
automatisch de Alembic-migraties.

Controleer de status en haal meteen het setup-token op:

```bash
docker compose logs -f app
```

Bij een lege database staat daar een blok als:

```
======================================================================
 SETUP-TOKEN: b_8TdPWqsqMsf78wKLo_5Tq_OFRlgpTE
 Vul dit token in op https://.../setup om de installatie te starten.
======================================================================
```

### 4. De installatiewizard doorlopen

Open `http://<server>:8083/setup` (het inlogscherm stuurt je daar bij een
lege installatie vanzelf heen) en doorloop de stappen:

1. **Setup-token** — plak het token uit de logs.
2. **Wat wil je doen?** — kies *Nieuw clubrouteboek inrichten*, of *Backup van
   een andere server terugzetten* als je verhuist (zie
   [Verhuizen naar een andere server](#verhuizen-naar-een-andere-server)).
3. **Beheerdersaccount** — je e-mailadres, naam en wachtwoord. Dit account is
   meteen beheerder en hoeft geen e-mail te bevestigen, want de mailserver is
   op dat moment nog niet ingesteld.
4. Je bent daarna **automatisch ingelogd** en de wizard vergrendelt zichzelf:
   `/api/setup/*` geeft vanaf dat moment een `409`, en het tokenbestand
   `data/setup-token` wordt opgeruimd.

Vul als laatste onder **Beheer → Instellingen** in elk geval de
e-mailinstellingen in — zonder werkende SMTP kunnen nieuwe leden zich niet
registreren. Met de knop *Stuur een testmail naar mijzelf* controleer je of
het klopt.

> De wizard is drievoudig vergrendeld: hij werkt alleen zolang er géén enkele
> gebruiker bestaat, `setup_completed` niet gezet is én het token klopt. Gaat
> er iets mis bij het vaststellen daarvan, dan wordt de setup geweigerd in
> plaats van toegestaan.

### 5. Routes seeden (optioneel)

Als je beschikt over `data/seed/routes.json` (de gescrapete routes van het
oude routeboek.cc, incl. `data/media/{gpx,tcx,maps}`), kan de import
handmatig (en idempotent) worden gedraaid:

```bash
docker compose exec app python -m app.seed
```

Zonder dit bestand start de app gewoon met een lege routetabel; routes kunnen
dan via de beheerpagina (GPX-upload) of door leden via community-routes
worden toegevoegd.

### 6. Backups controleren

Vanaf de eerste nacht maakt de app elke nacht om 01:00 automatisch een
databasebackup in `data/backups/`. Controleer onder **Beheer → Backup** dat
dat gelukt is, en maak daar meteen een handmatige *volledige backup incl.
media* als nulmeting.

> Een backupbestand bevat ook de instellingen, en daarmee je SMTP- en
> Telegram-wachtwoorden. Bewaar het net zo zorgvuldig als een wachtwoordkluis.
> De `SECRET_KEY` zit er bewust niet in.

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

## Verhuizen naar een andere server

De applicatie is zo opgezet dat verhuizen geen handwerk in de database vergt:
vrijwel alle instellingen staan in de database en gaan dus mee in een backup.

1. Maak op de oude server via **Beheer → Backup** een *volledige backup incl.
   media* en download het bestand.
2. Zet op de nieuwe omgeving een PostgreSQL 18 klaar en start de container met
   alleen `DATABASE_URL`, `SECRET_KEY` en `BASE_URL` ingevuld. Het entrypoint
   draait de migraties zelf op de lege database.
3. Haal het setup-token uit de logs (`docker compose logs app`) en open
   `/setup` in de browser.
4. Kies **Backup terugzetten**, upload het bestand en wacht tot de applicatie
   zichzelf herstart heeft.
5. Log in met je bestaande account. Routes, leden, ritten én alle instellingen
   zijn er weer.

> `SECRET_KEY` zit bewust **niet** in de backup: anders zou wie een
> backupbestand bemachtigt sessiecookies kunnen vervalsen. Neem hem handmatig
> over als je wilt dat bestaande sessies geldig blijven; genereer anders een
> nieuwe, waarna iedereen opnieuw moet inloggen.

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
