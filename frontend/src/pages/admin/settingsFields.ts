/**
 * Beschrijving van elk instelbaar veld: label, uitleg en invoertype.
 *
 * Bewust een handgeschreven lijst en geen generieke schema-renderer: elk veld
 * verdient een fatsoenlijk Nederlands label en een uitleg waar de beheerder
 * iets aan heeft. De sleutels komen exact overeen met `RUNTIME_SETTING_KEYS`
 * in `backend/app/config.py`; lopen die lijst en deze uit de pas, dan toont
 * het formulier een veld niet (of stuurt het een onbekende sleutel, die de
 * server met een 422 weigert).
 */

export type FieldKind = "text" | "number" | "switch" | "secret";

export interface FieldSpec {
  key: string;
  label: string;
  hint?: string;
  kind: FieldKind;
  /** Alleen voor `number`. */
  min?: number;
  max?: number;
  step?: number;
}

export interface SettingsSection {
  id: string;
  title: string;
  description: string;
  fields: FieldSpec[];
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "general",
    title: "Algemeen",
    description: "Naamgeving en het webadres waaronder de app bereikbaar is.",
    fields: [
      { key: "app_name", label: "Naam van de applicatie", kind: "text" },
      { key: "club_name", label: "Naam van de club", kind: "text" },
      {
        key: "base_url",
        label: "Basis-URL",
        hint: "Wordt gebruikt in e-mails en Telegram-berichten. Moet met https:// beginnen en zonder slash eindigen.",
        kind: "text",
      },
    ],
  },
  {
    id: "mail",
    title: "E-mail",
    description:
      "Zonder werkende e-mail kunnen leden zich niet registreren en hun wachtwoord niet herstellen.",
    fields: [
      {
        key: "mail_enabled",
        label: "E-mail versturen",
        hint: "Staat dit uit, dan worden mails alleen gelogd en niet verstuurd.",
        kind: "switch",
      },
      { key: "smtp_host", label: "SMTP-server", kind: "text" },
      { key: "smtp_port", label: "Poort", kind: "number", min: 1, max: 65535 },
      { key: "smtp_user", label: "Gebruikersnaam", kind: "text" },
      { key: "smtp_password", label: "Wachtwoord", kind: "secret" },
      {
        key: "smtp_starttls",
        label: "STARTTLS gebruiken",
        hint: "De gebruikelijke keuze op poort 587.",
        kind: "switch",
      },
      {
        key: "smtp_ssl",
        label: "Directe TLS gebruiken",
        hint: "Alleen voor poort 465. Niet samen met STARTTLS.",
        kind: "switch",
      },
      { key: "smtp_from", label: "Afzenderadres", kind: "text" },
      { key: "smtp_from_name", label: "Afzendernaam", kind: "text" },
      {
        key: "smtp_timeout",
        label: "Time-out (seconden)",
        kind: "number",
        min: 1,
        max: 300,
      },
    ],
  },
  {
    id: "telegram",
    title: "Telegram",
    description:
      "Laat je het bot-token leeg, dan staat de hele Telegram-integratie uit en gebeurt er niets.",
    fields: [
      { key: "telegram_bot_token", label: "Bot-token", kind: "secret" },
      {
        key: "telegram_bot_username",
        label: "Gebruikersnaam van de bot",
        hint: "Zonder @, bijvoorbeeld stampersrouteboek_bot.",
        kind: "text",
      },
      {
        key: "telegram_channel_id",
        label: "Kanaal-ID",
        hint: "De interne chat-id waar ritten worden gepost, bijvoorbeeld -1001234567890.",
        kind: "text",
      },
      {
        key: "telegram_channel_invite_link",
        label: "Uitnodigingslink van het kanaal",
        hint: "De klikbare link die leden op de informatiepagina zien. Iets anders dan het kanaal-ID.",
        kind: "text",
      },
      {
        key: "telegram_webhook_secret",
        label: "Webhook-geheim",
        hint: "Beschermt het webhook-endpoint. Wijzig je dit, dan meldt de app de webhook opnieuw aan.",
        kind: "secret",
      },
      {
        key: "telegram_link_token_ttl_minutes",
        label: "Geldigheid koppelcode (minuten)",
        kind: "number",
        min: 1,
        max: 1440,
      },
      {
        key: "telegram_reminder_minutes_before",
        label: "Herinnering wegkapitein (minuten vooraf)",
        kind: "number",
        min: 0,
        max: 240,
      },
    ],
  },
  {
    id: "rides",
    title: "Ritten",
    description: "Grenzen voor het aantal deelnemers bij een nieuwe rit.",
    fields: [
      {
        key: "ride_min_participants",
        label: "Minimum aantal deelnemers",
        kind: "number",
        min: 1,
        max: 100,
      },
      {
        key: "ride_max_participants",
        label: "Maximum aantal deelnemers",
        kind: "number",
        min: 1,
        max: 100,
      },
      {
        key: "ride_default_participants",
        label: "Standaard aantal deelnemers",
        kind: "number",
        min: 1,
        max: 100,
      },
    ],
  },
  {
    id: "security",
    title: "Sessies en beveiliging",
    description:
      "Hoe lang iemand ingelogd blijft en hoe snel een account op slot gaat na verkeerde pogingen.",
    fields: [
      {
        key: "session_ttl_hours",
        label: "Maximale duur van een sessie (uren)",
        kind: "number",
        min: 1,
        max: 8760,
      },
      {
        key: "session_idle_timeout_hours",
        label: "Uitloggen na inactiviteit (uren)",
        kind: "number",
        min: 1,
        max: 8760,
      },
      {
        key: "verify_token_ttl_hours",
        label: "Geldigheid bevestigingslink (uren)",
        kind: "number",
        min: 1,
        max: 720,
      },
      {
        key: "reset_token_ttl_minutes",
        label: "Geldigheid herstellink (minuten)",
        kind: "number",
        min: 5,
        max: 1440,
      },
      {
        key: "max_login_attempts",
        label: "Toegestane inlogpogingen",
        kind: "number",
        min: 1,
        max: 100,
      },
      {
        key: "login_window_minutes",
        label: "Binnen hoeveel minuten (venster)",
        kind: "number",
        min: 1,
        max: 1440,
      },
      {
        key: "lockout_minutes",
        label: "Daarna geblokkeerd (minuten)",
        kind: "number",
        min: 1,
        max: 1440,
      },
    ],
  },
  {
    id: "water",
    title: "Waterpunten",
    description: "Standaardwaarden bij het toevoegen van drinkwaterpunten aan een GPX.",
    fields: [
      {
        key: "default_radius_m",
        label: "Standaard zoekradius (meter)",
        kind: "number",
        min: 10,
        max: 5000,
      },
      {
        key: "dedupe_distance_m",
        label: "Punten samenvoegen binnen (meter)",
        kind: "number",
        min: 1,
        max: 1000,
      },
      {
        key: "gap_warning_km",
        label: "Waarschuwen bij een droog stuk vanaf (km)",
        kind: "number",
        min: 1,
        max: 200,
        step: 0.5,
      },
    ],
  },
];

/** Nette Nederlandse labels voor de velden die alleen via de omgeving kunnen. */
export const READONLY_LABELS: Record<string, string> = {
  database_url: "Databaseverbinding",
  data_dir: "Datamap",
  port: "Poort",
  log_level: "Logniveau",
  cookie_secure: "Secure-cookies",
  secret_key: "Sleutel voor sessies",
  nl_gpx_url: "Bron drinkwaterpunten",
  user_agent: "User-Agent",
  admin_email: "Beheerdersadres (bootstrap)",
  admin_name: "Beheerdersnaam (bootstrap)",
};
