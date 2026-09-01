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
GPX/TCX-downloads, waterpunten, ritten aanmaken/aanmelden, reacties +
waarderingen per route en de beheerpagina (routes toevoegen/bewerken/
verwijderen, gebruikersbeheer). Het beheerdersaccount `r.vloothuis@gmail.com`
bestaat met een willekeurig wachtwoord: gebruik eenmalig "wachtwoord
vergeten" om er zelf één in te stellen.

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
│       ├── routes_common.py          gedeeld: slugify, unique_slug, track_stats
│       ├── route_import.py           GPX-import (community routes; bewust geen URL-import)
│       ├── route_thumbnail.py        kaartminiatuur (OSM-tegels) voor routes zonder map_file
│       ├── main.py                   app-factory, static hosting, SPA-fallback
│       ├── routers/
│       │   ├── auth.py               registratie, login, verificatie, reset
│       │   ├── users.py              ledenlijst (id + naam) voor keuzevelden
│       │   ├── routes.py             routeoverzicht + filters + downloads
│       │   ├── rides.py              ritten organiseren en deelnemen
│       │   ├── water.py              waterpunten toevoegen aan een GPX
│       │   ├── social.py             reacties en waarderingen
│       │   ├── community.py          community-routes: import, aanmaken, upvoten
│       │   └── admin.py              beheer van routes (incl. promoveren) en gebruikers
│       ├── services/
│       │   └── rides.py              ritten-logica los van FastAPI
│       └── water/                    overgenomen uit /home/shark/gpx
│           ├── geo.py                projectie, NL-detectie, bounding box
│           ├── gpx_service.py        GPX lezen/schrijven
│           ├── waterpoints_nl.py     drinkwaterpunten.nl (24u cache, enige bron)
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
│       │                             RouteDetail, Rides, RideForm,
│       │                             CommunityRoutes, NewCommunityRoute,
│       │                             Admin, Account
│       ├── theme.ts                  Routeboek-huisstijl
│       ├── styles.css                huisstijlklassen (.rb-*)
│       └── main.tsx                  providers + router
├── scripts/
│   └── scrape_routeboek.py           eenmalige migratie van routeboek.cc
└── data/                             volume, niet in git
    ├── seed/routes.json              gescrapete metadata (166 routes, 9,4 MB)
    ├── media/{gpx,tcx,maps}/         routebestanden en kaartafbeeldingen
    ├── cache/                        drinkwaterpunten-cache, osm_tiles/, route_maps/
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
  én door leden aangeleverde community-routes (zie `origin` hieronder)
- `route_ratings` — waardering (1-5) per lid per route, uniek per paar
- `route_comments` — reacties van leden onder een route
- `route_upvotes` — stemmen van leden op community-routes, uniek per
  route/gebruiker (`Route.upvote_count` is de teller)
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
12. **Content-Security-Policy** (`main.py`, `security_headers`-middleware) staat
    alleen `img-src` toe voor `'self'`, `data:` en de OSM-tegelserver. Let op:
    `https://*.tile.openstreetmap.org` matcht géén requests naar het kale
    `tile.openstreetmap.org` (zonder subdomein) — CSP-wildcards matchen alleen
    subdomeinen, niet de host zelf. `RouteMap.tsx` gebruikt bewust de URL
    zónder subdomeinprefix, dus **beide** varianten moeten in de CSP staan.
    Vergeet dit niet als je ooit een andere tegelbron toevoegt: een grijze
    kaart met alleen de rode routelijn (SVG wordt niet door `img-src`
    geblokkeerd) is het symptoom van een CSP-mismatch, niet van een kapotte
    kaartcomponent.

### Registratie

Iedereen mag zich registreren, maar **e-mailverificatie is verplicht** voordat
er ingelogd kan worden. `r.vloothuis@gmail.com` krijgt bij het opstarten
automatisch adminrechten (instelbaar via `ADMIN_EMAIL`).

**Bevestigingslinks blijven allemaal geldig totdat er één gebruikt wordt.**
`issue_email_token(..., invalidate_existing=False)` wordt gebruikt voor
`verify_email`-tokens: vraagt iemand de mail meerdere keren opnieuw aan (bv.
omdat de eerste mail traag binnenkomt), dan werkt élke ontvangen link nog,
niet alleen de allerlaatste. Er zit wel een cooldown van 60s
(`RESEND_COOLDOWN` in `auth.py`) op het daadwerkelijk versturen van een
nieuwe mail, zodat herhaald klikken op "registreren" geen mailbom veroorzaakt.
Wachtwoordherstel-tokens (`reset_password`) worden bewust wél ingetrokken bij
een nieuwe aanvraag (`invalidate_existing=True`, de standaard): een oude
reset-link laten "rondslingeren" is een groter veiligheidsrisico dan bij
e-mailbevestiging.

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
- `send_mail()` zet zelf `Date` en `Message-ID`. Die zijn verplicht volgens
  RFC 5322 en `smtplib` vult ze niet aan; zonder die headers rekenen
  spamfilters punten aan en belanden bevestigings- en herstelmails in de
  spammap. Verwijder ze niet.
- De container draait op `TZ=Europe/Amsterdam` (zie `docker-compose.yml`). Dat
  is nodig voor de tijdstempels in mail én voor `next_standard_slot()`, dat op
  lokale tijd bepaalt of het clubmoment van vandaag al geweest is.
- Meelezen in de clubmailbox kan via IMAP: `imap.ziggo.nl:993` (SSL), dezelfde
  inloggegevens als SMTP. Poort 143 is dicht.

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

### Layout van het ritten-overzicht
De ritkaart in `RidesPage.tsx` is bewust **mobile-first** vormgegeven, naar
het voorbeeld van het oude routeboek (`rit2.png`):

- Eén set JSX voor beide schermformaten; het verschil zit in CSS
  (`.rb-ride-card` in `styles.css`). Onder 48em is de kaartminiatuur een
  **volle banner bovenaan**, daarboven 48em schuift 'ie naar een kolom van
  230px links ernaast. Zo hoeft er geen tweede kaart-variant onderhouden te
  worden.
- Linksboven op de miniatuur staat een **scheurkalender-datumblok**
  (`.rb-ride-date`: maand in clubrood, dag groot, tijd in een donkere chip).
  Dat combineert datum + tijd in ruimte die anders toch leeg zou zijn.
- De gegevens staan in `.rb-ride-facts`: op mobiel een **tweekoloms grid**
  (wegkapitein | deelnemers, afstand | snelheid), op desktop een gewone
  doorlopende flexrij. Dit was de kern van de mobiele
  ruimte-winst — vier losse regels werden twee.
- Redundantie wordt actief onderdrukt: de route-regel verdwijnt als de
  ritnaam gelijk is aan de routenaam, en `formatRideMoment()` laat het
  jaartal weg zolang de rit in het huidige jaar valt.
- Actieknoppen (aan-/afmelden) zijn `fullWidth` op mobiel; de
  `SegmentedControl` krijgt daar kortere labels ("Komend"/"Mijn"/"Alles").
- **Let op bij wijzigingen:** controleer dat er geen horizontale overflow
  ontstaat (`document.documentElement.scrollWidth` moet gelijk zijn aan
  `clientWidth`). De weerstrip en de deelnemerslijst zijn de twee plekken
  die dat het snelst breken.

### Weerbericht bij een rit
Elke rit met een gekoppelde route toont optioneel een uurlijkse
weersverwachting (`app/services/weather.py`, endpoint
`GET /api/rides/{id}/weather`, frontend `components/WeatherStrip.tsx`,
gebruikt in `RidesPage.tsx`), geïnspireerd op het "Weer"-tabblad van het
oude routeboek.cc (`weer.png`).

- **Bron: Open-Meteo** (`api.open-meteo.com`), gekozen omdat het gratis is,
  geen API-key/registratie vereist en een nette hourly-forecast levert.
  Geen nieuwe dependency nodig — gebruikt `requests`, net als
  `route_thumbnail.py` en `water/waterpoints_nl.py`.
- **Locatie** = het eerste coördinatenpunt van `Route.coordinates`
  (`[[lat, lon], ...]`, zelfde structuur als elders); zonder route of
  coördinaten is er simpelweg geen weerbericht.
- **Forecast-horizon is ~15 dagen.** Open-Meteo voorspelt niet verder
  vooruit, en ritten mogen wel verder vooruit gepland worden. Buiten dat
  bereik (en voor data in het verleden) geeft de service gewoon `None`
  terug i.p.v. een foutmelding; de router vertaalt dat naar
  `{"available": false}`. De frontend berekent zelf ook een grove
  15-dagen-schatting (`FORECAST_HORIZON_DAYS` in `RidesPage.tsx`) om de
  "Weerbericht"-knop helemaal niet te tonen als een voorspelling toch
  nutteloos zou zijn — dat voorkomt een dooie knop die alleen "nog niet
  beschikbaar" oplevert.
- **In-memory cache van 30 minuten** per (locatie afgerond op ~1 km,
  datum), met een `threading.Lock` — zelfde stijl als de bestaande
  waterpunten-cache, maar zonder schijfbestand omdat het hier om
  kortlevende voorspeldata gaat, niet om een stabiele bron.
- **Venster van 4 uur** rond het vertrektijdstip (1 uur ervoor t/m 2 uur
  erna, `hours_around()`), net als de 4 blokjes in het oude routeboek.cc.
- **Windrichting en -kracht in NL-conventie, niet ruwe km/u/graden**:
  Open-Meteo levert windsnelheid in km/u en richting in graden; dat is
  omgerekend naar de Beaufort-schaal (`beaufort_from_kmh()`, 0-12) en een
  8-punts kompasrichting (`compass_from_degrees()`, N/NO/O/ZO/Z/ZW/W/NW —
  zelfde stijl als `Route.wind_directions`). Dit is voor een NL-wielerclub
  het belangrijkste onderdeel van het weerbericht (mee- of tegenwind, hoe
  hard). De pijl in `WeatherStrip.tsx` staat gedraaid naar de richting
  waar de wind ​naartoe​ waait (dus `wind_direction_deg + 180°`, want
  Open-Meteo geeft de richting waar de wind ​vandaan​ komt).
- **Layout bewust lui/inklapbaar**, niet standaard open: een
  "Weerbericht"-knop (zelfde patroon als "Wie gaan er mee?") die pas bij
  klikken de weersverwachting ophaalt en toont als een horizontaal
  scrollbare `ScrollArea` met vaste-breedte blokjes. Dit voorkomt een
  layout-sprong bij het laden van het ritten-overzicht en houdt de
  mobiele weergave (waar horizontaal scrollen prettiger is dan wrappen)
  overzichtelijk.
- Geen weerbericht op de Events-pagina (nog) — expliciet buiten scope
  gehouden omdat daar is gevraagd, alleen ritten.

### Kaartminiaturen zonder eigen kaartbestand
Alleen de 166 gescrapete officiële routes hebben een eigen `Route.map_file`
(een gekopieerde afbeelding van routeboek.cc). Community-routes en door
admins via GPX toegevoegde routes hebben dat niet, maar moeten wél een
kaartje tonen in het overzicht, bij ritten en op kaarten
(`RouteCard`/`RidesPage`/community-lijst gebruiken overal dezelfde
`route.map_url`).

`app/route_thumbnail.py:render_route_thumbnail_png()` levert die miniatuur
zonder eigen kaartbestand: een echte OSM-achtergrond (geen kale kleur/SVG —
dat oogde eerder verwarrend naast de echte kaartjes), met de route als rode
lijn erover. `media_url()`/`GET /api/routes/{id}/map` in
`routers/routes.py` valt hierop terug zodra `route.map_file` leeg is maar
`route.coordinates` wél gevuld is.

- Kiest zelf een zoomniveau dat de route (plus rand) in het miniatuurformaat
  laat passen (`_pick_zoom`, standaard "fit bounds"-berekening met Web
  Mercator-pixelcoördinaten), download de benodigde 256×256-tegels van
  `tile.openstreetmap.org` en plakt ze samen met Pillow.
- **Tegel-caching is verplicht, niet optioneel**: de OSM-tile-usage-policy
  staat geen herhaald automatisch ophalen van dezelfde tegel toe. Tegels
  blijven 30 dagen op schijf staan onder `data/cache/osm_tiles/{z}/{x}/{y}.png`
  en worden — omdat alle clubroutes toch al dicht bij elkaar liggen — vaak
  hergebruikt tussen routes. Het uiteindelijke plaatje zelf wordt ook
  gecachet, onder `data/cache/route_maps/`, gesleuteld op een hash van de
  coördinaten.
- Dit endpoint blijft, net als de rest van de media-endpoints, achter
  `current_user` (zie beveiligingsregel 11): geen `StaticFiles`, geen
  publieke tegel-proxy.
- Verwar dit niet met de grote Leaflet-kaart op de detailpagina
  (`RouteMap.tsx`): die tekent client-side met live tegels en heeft zijn
  eigen CSP-regels (zie beveiligingsregel 12); deze miniatuur is een losse,
  server-side gerenderde PNG en heeft dat probleem niet, want hij wordt
  vanaf `'self'` geserveerd.

### Waterpunten
Bij het downloaden van een route kan de gebruiker drinkwaterpunten laten
toevoegen aan de GPX. De logica is overgenomen uit `/home/shark/gpx`
(container `gpx-drinkwaterpunten`), maar vereenvoudigd:

- Alle routes van de club liggen in Nederland, dus is **drinkwaterpunten.nl
  de enige bron**. Het oude OSM/Overpass-alternatief (`osm_service.py`) en de
  `source`-keuze (`auto`/`nl`/`osm`) zijn verwijderd, evenals de nu ongebruikte
  `nl_share`/`in_netherlands`-hulpfuncties in `geo.py`.
- Standaard zoekradius is **100 m** (`default_radius_m`, ook het
  standaardpunt van de slider in `WaterDialog.tsx`).
- Punten binnen `radius_m` van de route worden gekoppeld, ontdubbeld en op
  rijrichting gesorteerd.
- Er komt een waarschuwing bij een "droog" stuk langer dan `gap_warning_km`.

### Adminpagina
Routes toevoegen (GPX-upload), bewerken en verwijderen (`GET/PATCH/DELETE
/api/admin/routes/{id}`; de admin-detailendpoint negeert `is_active` zodat
ook verborgen routes te bewerken zijn), gebruikers activeren/blokkeren en
adminrechten toekennen.

### Windrichting inschatten
Sommige gemigreerde routes hadden geen windrichting-tag. Heuristiek (van de
club): je fietst het stuk van huis vandaan het liefst tegen de wind in, zodat
je op de terugweg wind mee hebt. `estimate_wind_direction()` in
`app/water/geo.py` neemt het verst-van-het-startpunt gelegen punt op de route
als (ruwe) keerpunt, berekent de kompaskoers ernaartoe en rondt die af op de
dichtstbijzijnde windstreek (N/O/Z/W). `Route.wind_estimated` onthoudt of een
tag een gok is (badge "geschat" in UI en adminlijst); zodra een admin de
windrichting handmatig bewerkt, wordt de vlag automatisch gewist. Het
one-off script `python -m app.estimate_wind` (draait idempotent mee in
`docker/entrypoint.sh` bij elke start) vult ontbrekende tags aan.

### Reacties en waarderingen
Elke ingelogde gebruiker mag onder een route reageren (`RouteComment`,
platte tekst, geen HTML) en waarderen (`RouteRating`, 1-5 sterren, één stem
per lid, opnieuw stemmen overschrijft de vorige). Admins mogen elke reactie
verwijderen (bijv. bij ongepaste inhoud) via `DELETE
/api/routes/{id}/comments/{comment_id}`.

De getoonde waardering (`Route.rating`/`rating_count`) is een **gewogen
gemiddelde** van de bevroren, anonieme waardering uit het oude routeboek.cc
(`legacy_rating`/`legacy_rating_count`, gezet door `app/seed.py` uit het
scrapebestand) en de echte stemmen van leden. Herberekening gebeurt via de
gedeelde helper `app/rating.py:recompute_rating()`, aangeroepen door zowel
`app/seed.py` (na elke import) als `app/routers/social.py` (na elke
stem/verwijdering). Zo blijft historische informatie behouden zonder dat
scrapete "stemmen" een eigen gebruikersaccount nodig hebben.

### Community routes
Elk lid mag zelf een route aanleveren. Dit is bewust **geen aparte tabel**:
een community-route is gewoon een rij in `routes` met `Route.origin =
"community"` (i.p.v. `"official"`). Zo hergebruikt de feature alle
bestaande route-infrastructuur (detailpagina, kaart, GPX/TCX-download,
waterpunten, reacties, waarderingen, ritten aanmaken via `Ride.route_id`)
zonder extra code. "Promoveren" naar het officiële routeboek is dan ook
niets meer dan `origin` terugzetten op `"official"`
(`POST /api/admin/routes/{id}/promote`, alleen voor admins).

- **Twee-staps wizard** (`app/routers/community.py`,
  `frontend/src/pages/NewCommunityRoutePage.tsx`): stap 1 uploadt een
  GPX-bestand en toont een preview (naam, afstand, hoogtemeters, geschatte
  windrichting) zónder iets op te slaan; stap 2 laat de aanbieder de
  metadata aanvullen (naam, beschrijving, soort, windrichting, categorieën,
  optioneel een Strava-link als losse referentie) en slaat pas dan de route
  op (`POST /api/community/routes`).
- **Geen link/URL-import.** Er is bewust géén "importeer via Strava/Komoot-
  link"-optie: Komoot blokkeert zowel de onofficiële API als tourpagina's
  met 403 (ook voor bekende publieke tour-ID's), en Strava's routepagina's
  zijn een client-side gerenderde shell zonder embedded data — de echte
  data komt alleen binnen via een geauthenticeerde XHR-call. Server-side
  ophalen van zo'n link levert dus nooit een route op; een eerdere versie
  bood dit tijdelijk aan (met SSRF-bescherming) maar leverde in de praktijk
  alleen een foutmelding op, dus is de optie weer verwijderd. **Voeg 'm niet
  opnieuw toe** zonder dat Strava/Komoot een publieke, aanmeldingsvrije
  export-API bieden. Wil een gebruiker toch de link erbij? Dat kan al: stap 2
  heeft een los, optioneel "Strava-link"-veld (`Route.strava_url`) dat
  gewoon als referentie bij de geüploade GPX komt te staan.
- **`Route.upvote_count`** is een gedenormaliseerde teller die bij elke
  stem/intrekking in `RouteUpvote` wordt bij- of afgeteld (niet elke keer
  herberekend); `GET /api/community/routes` levert ook `my_upvote` per
  ingelogde gebruiker mee via één gebatchte query.
- **`/api/routes` (het officiële overzicht) sluit community-routes altijd
  uit** (`_apply_filters()` filtert op `origin == official`); de losse
  detailpagina/`GET /api/routes/{id}` is bewust origin-agnostisch en werkt
  ongewijzigd voor beide soorten routes. `submitted_by` (de weergavenaam van
  de aanbieder) wordt alleen lazy geladen wanneer `origin == community`, om
  geen N+1-query te introduceren op de veelgebruikte officiële lijst.
- Voor community-routes wordt **geen fysiek GPX/TCX-bestand** weggeschreven;
  `coordinates` (`[[lat, lon], ...]`, dezelfde conventie als elders) is de
  bron van waarheid en de bestaande GPX-downloadendpoint gebruikt hiervoor
  automatisch zijn coördinaten-fallback (`build_gpx_from_coordinates`).
- Ritten aanmaken via `RideFormPage` gebruikt `api.allRoutesForRideForm()`,
  dat officiële en community-routes samenvoegt (community-opties krijgen het
  label-suffix " · Community") zodat iedereen ook een rit kan organiseren
  vanuit een community-route.
- **Eigen community-routes verwijderen** (`DELETE
  /api/community/routes/{id}`, `app/routers/community.py`): de aanbieder
  zelf óf een admin mag een community-inzending intrekken. Dit is bewust
  een **échte verwijdering** (i.t.t. `admin.py`'s `delete_route()`, die
  standaard alleen archiveert) — een community-route heeft geen historische
  waarde zoals een officiële route, dus mag gewoon weg als 'ie verkeerd of
  dubbel is aangeleverd. Guards: alleen toegestaan zolang `origin ==
  community` (eenmaal gepromoveerd tot officieel loopt verwijderen via het
  admin-endpoint, niet hier); alleen de aanbieder (`created_by_id ==
  user.id`) of `user.is_admin`, anders 403. `Ride.route_id` staat op
  `ondelete=SET NULL` (ritten overleven het verwijderen van hun route),
  `RouteRating`/`RouteComment`/`RouteUpvote` staan op `ondelete=CASCADE`
  (geen wezen-rijen). De frontend krijgt via `RouteSummary.can_delete`
  (server-side berekend in `to_summary()`/`to_detail()` op basis van de
  ingelogde gebruiker) te zien of de verwijderknop getoond moet worden —
  géén losse frontend-logica op basis van namen of ID's.

### Events
Naast ritten (wekelijkse clubtochten) is er een aparte "Events"-feature
(`app/models.py` → `Event`/`EventParticipant`, `app/services/events.py`,
`app/routers/events.py`, `frontend/src/pages/EventsPage.tsx` +
`EventFormPage.tsx`) voor grotere, verder-vooruit-geplande activiteiten
(sportives, wedstrijden, meerdaagse tochten) waar leden een reismaatje voor
zoeken. Bewust een **los model** i.p.v. hergebruik van `Ride`, met een
paar kernverschillen:

- **Geen privacy-optie.** Ritten kunnen prive; events niet — het hele doel
  is juist breed zichtbaar zijn zodat mensen zich kunnen aansluiten.
- **Geen aparte "eigenaar"/wegkapitein-rol.** Alleen `created_by_id`;
  bewerken/verwijderen mag de aanmaker of een admin (`can_edit` in
  `services/events.py`, zelfde patroon als bij routes/community).
- **Vervoer is per deelnemer, niet per event.** Bij een rit fietst de hele
  groep samen; bij een event kan de ene persoon carpoolen en de andere met
  de trein gaan. Daarom staat `transport` (enum: `car`/`train`/
  `own_transport`/`bike`) op `EventParticipant`, gekozen bij het aanmelden
  (`POST /api/events/{id}/join`) en aanpasbaar door opnieuw aan te melden
  (upsert, geen dubbele rij).
- **Route-koppeling hergebruikt de bestaande `Route`-tabel** (officieel én
  community) via `Event.route_id`, precies zoals `Ride.route_id`. Er is
  bewust **geen eigen GPX-upload op het event-formulier gebouwd** — dat zou
  de kaart/GPX/waterpunten-infrastructuur dupliceren. Wil iemand een eigen
  GPX aan een event hangen? Upload 'm eerst als community-route, koppel 'm
  daarna aan het event via dezelfde route-dropdown die ook bij ritten wordt
  gebruikt (`api.allRoutesForRideForm()`). Dit is een bewuste
  scope-inperking, geen bug.
- **`event_time` is optioneel** (i.t.t. `ride_time`, dat verplicht is) —
  een meerdaagse tocht heeft niet altijd één vast starttijdstip.
  `max_participants` heeft een ruimer bereik (2–200, vrij invoerveld) dan
  bij ritten (4–12, vaste keuzelijst), omdat externe events sterk in
  omvang variëren.
- De aanmaker meldt zich bij het aanmaken automatisch aan (net als de
  wegkapitein bij een rit), met standaard-vervoer `own_transport`.
- **Belangrijke SQLAlchemy-valkuil** (opgelost in
  `alembic/versions/20260901_1600_events.py`): gebruik voor een migratie die
  in dezelfde `upgrade()` zowel een nieuw Postgres-enum-type aanmaakt (via
  een expliciete `.create(bind, checkfirst=True)`) als een tabel die dat
  enum als kolomtype gebruikt, **niet** `sa.Enum(..., create_type=False)` —
  die `create_type`-parameter wordt door de generieke `sa.Enum`-klasse
  stilzwijgend genegeerd, waardoor `op.create_table()`'s automatische
  `before_create`-listener het type een tweede keer probeert aan te maken
  (`DuplicateObject`). Gebruik in plaats daarvan
  `from sqlalchemy.dialects.postgresql import ENUM as PGEnum` en geef
  `create_type=False` aan díe klasse — alleen de dialect-specifieke
  `postgresql.ENUM` respecteert deze parameter daadwerkelijk.
- **Andere valkuil, ook relevant voor `rides.py`**: `_load_event()`/
  `_load_ride()` laden een entiteit inclusief `participants` opnieuw ná een
  join/leave-mutatie, binnen hetzelfde request/dezelfde sessie. Zonder
  `.execution_options(populate_existing=True)` geeft SQLAlchemy's identity
  map het **al eerder geladen (verouderde) Python-object** terug in plaats
  van vers uit de database te lezen, zodat de API-response na een
  join/leave de oude deelnemerslijst toont. Beide loaders zetten deze
  execution option nu expliciet aan; houd hier rekening mee bij elke
  vergelijkbare "muteer, herlaad daarna binnen hetzelfde verzoek"-flow.

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
- De app heet naar de gebruiker toe **"Stampers Routeboek"** (nooit
  "routeboek.cc" — dat is de oude site). De merknaam staat in één component:
  `src/components/BrandLogo.tsx`, met `layout="stacked"` (clublogo in wit boven
  het woord ROUTEBOEK) voor `AuthShell` en `layout="inline"` (tekstlockup) voor
  de header in `AppLayout`. Het clublogo `public/brand/stampers-logo.png` is
  zwarte lijnkunst met transparantie en wordt met een CSS-filter gewit; er is dus
  maar één bestand nodig. De oude `routeboek-logo*.png` zijn verwijderd.
- Mantine-theming staat centraal in `src/theme.ts`; geen losse hardgecodeerde
  kleuren in componenten.
- **`DateInput` (Mantine 9) werkt met `"YYYY-MM-DD"`-strings, niet met
  `Date`-objecten.** `onChange` levert een `DateStringValue | null`. Typeer
  het formulierveld dus als `string | null` en stuur de waarde ongewijzigd
  door naar de API (die verwacht exact dat formaat). Zet er géén
  `new Date(...)`/`toIsoDate()`-conversie omheen: dat compileert wel (het
  veld is `Date` getypeerd, dus TypeScript klaagt niet over de cast) maar
  crasht bij het opslaan met `value.getMonth is not a function`.
  `minDate`/`maxDate` accepteren wél beide vormen.
- **Bouw de request-payload altijd binnen de `try` van een submit-handler.**
  Staat de payload-constructie ervoor, dan komt een exception daarin nooit
  bij `catch`/`finally` terecht: de gebruiker ziet een eeuwig draaiende
  knop zonder foutmelding, en er verschijnt niets in de serverlogs omdat er
  nooit een request is verstuurd. Precies dit patroon verborg de
  `DateInput`-bug hierboven.
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
