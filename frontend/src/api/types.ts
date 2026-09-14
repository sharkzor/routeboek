/** Types die overeenkomen met de Pydantic-modellen van de backend. */

export type RouteType = "road" | "road_gravel" | "gravel";
export type RideType = "race" | "race_gravel" | "gravel";
export type EventType = "sportive" | "race" | "multiday" | "gravel" | "other";
export type TransportMode = "car" | "train" | "own_transport" | "bike";
export type NoticeKind = "works" | "hazard" | "info";
export type WindCode = "N" | "O" | "Z" | "W";
export type CategoryCode = "beginners" | "high_pace" | "tourist";

export interface User {
  id: number;
  email: string;
  display_name: string;
  is_admin: boolean;
  is_active: boolean;
  email_verified_at: string | null;
  created_at: string;
  last_login_at: string | null;
}

export interface UserSummary {
  id: number;
  display_name: string;
}

export interface SessionOut {
  user: User;
  csrf_token: string;
}

export interface RouteSummary {
  id: number;
  slug: string;
  name: string;
  distance_km: number | null;
  elevation_m: number | null;
  route_type: RouteType;
  wind_directions: WindCode[];
  wind_estimated: boolean;
  categories: CategoryCode[];
  rating: number | null;
  rating_count: number;
  map_url: string | null;
  has_gpx: boolean;
  has_tcx: boolean;
  is_active: boolean;
  origin: "official" | "community" | "event";
  upvote_count: number;
  submitted_by: string | null;
  my_upvote: boolean;
  can_delete: boolean;
  is_favorite: boolean;
  is_ridden: boolean;
}

export interface RouteDetail extends RouteSummary {
  description_html: string;
  strava_url: string | null;
  komoot_url: string | null;
  coordinates: [number, number][];
  created_at: string;
  my_rating: number | null;
  /** Lopende en geplande meldingen; alleen op de detailpagina gevuld. */
  notices: Notice[];
}

export interface NoticeRouteRef {
  id: number;
  name: string;
  distance_km: number | null;
}

export interface Notice {
  id: number;
  kind: NoticeKind;
  title: string;
  description: string;
  /** "YYYY-MM-DD" */
  start_date: string;
  /** "YYYY-MM-DD" */
  end_date: string;
  created_at: string;
  created_by: string | null;
  routes: NoticeRouteRef[];
  /** False zolang de melding nog niet begonnen is. */
  is_active: boolean;
  can_edit: boolean;
}

export interface NoticeInput {
  kind: NoticeKind;
  title: string;
  description: string;
  start_date: string | null;
  end_date: string;
  route_ids: number[];
}

export interface RouteImportPreview {
  name: string | null;
  distance_km: number;
  elevation_m: number;
  coordinates: [number, number][];
  wind_directions: WindCode[];
}

export interface CommunityRouteCreateIn {
  name: string;
  description_html: string;
  route_type: RouteType;
  wind_directions: WindCode[];
  categories: CategoryCode[];
  strava_url: string | null;
  komoot_url: string | null;
  distance_km: number;
  elevation_m: number;
  coordinates: [number, number][];
}

export interface UpvoteResult {
  upvote_count: number;
  my_upvote: boolean;
}

/** Resultaat van een persoonlijke markering (favoriet / gereden). */
export interface MarkResult {
  active: boolean;
}

export interface Comment {
  id: number;
  display_name: string;
  body: string;
  created_at: string;
  is_mine: boolean;
}

export interface RatingResult {
  rating: number | null;
  rating_count: number;
  my_rating: number | null;
}

export interface RoutePage {
  items: RouteSummary[];
  total: number;
  page: number;
  page_size: number;
  distance_min: number | null;
  distance_max: number | null;
}

export interface RideRouteRef {
  id: number;
  slug: string;
  name: string;
  distance_km: number | null;
  map_url: string | null;
}

export interface Ride {
  id: number;
  name: string;
  owner: UserSummary;
  ride_date: string;
  ride_time: string;
  ride_type: RideType;
  distance_km: number | null;
  speed_kmh: number | null;
  max_participants: number;
  notes_html: string;
  is_private: boolean;
  cancelled_at: string | null;
  created_at: string;
  route: RideRouteRef | null;
  participants: UserSummary[];
  participant_count: number;
  is_joined: boolean;
  can_edit: boolean;
  /** Alleen bij een prive-rit: hoort als ?sleutel= in de deel-link. */
  share_token: string | null;
  /** Staat dit bericht in het Telegram-kanaal? (nooit bij een prive-rit) */
  posted_to_telegram: boolean;
}

export interface RidePage {
  items: Ride[];
  total: number;
  page: number;
  page_size: number;
}

export interface RideDefaults {
  ride_date: string;
  ride_time: string;
  label: string;
}

export interface QuickstartResult {
  routes: RouteSummary[];
  wind_direction: string | null;
}

export interface WeatherHour {
  time: string;
  temp_c: number;
  precipitation_mm: number;
  precipitation_probability: number | null;
  weather_code: number;
  wind_speed_kmh: number;
  wind_direction_deg: number;
  wind_beaufort: number;
  wind_compass: string;
  is_day: boolean;
}

export interface RideWeather {
  available: boolean;
  hours: WeatherHour[];
}

export interface RideRouteUpload {
  name: string;
  route_type: RouteType;
  strava_url?: string | null;
  komoot_url?: string | null;
  distance_km?: number | null;
  elevation_m?: number | null;
  coordinates: [number, number][];
  wind_directions?: string[];
}

export interface RideInput {
  name: string;
  owner_id?: number | null;
  ride_date: string;
  ride_time: string;
  route_id?: number | null;
  /** Eigen route: optionele GPX + optionele Strava-/Komoot-link. */
  route_upload?: RideRouteUpload | null;
  ride_type: RideType;
  distance_km?: number | null;
  speed_kmh?: number | null;
  max_participants: number;
  notes_html: string;
  is_private: boolean;
  /** Alleen relevant bij het aanmaken; de backend negeert dit bij bewerken. */
  post_to_telegram?: boolean;
}

export interface TelegramStatus {
  linked: boolean;
  username: string | null;
  linked_at: string | null;
  enabled: boolean;
  bot_username: string | null;
  channel_invite_link: string | null;
}

export interface TelegramLink {
  link: string;
  expires_in_minutes: number;
}

export interface EventRouteRef {
  id: number;
  slug: string;
  name: string;
  distance_km: number | null;
  map_url: string | null;
}

export interface EventParticipant {
  id: number;
  display_name: string;
  transport: TransportMode;
}

export interface EventItem {
  id: number;
  name: string;
  event_type: EventType;
  event_date: string;
  event_time: string | null;
  url: string | null;
  cost_eur: number | null;
  distance_km: number | null;
  speed_kmh: number | null;
  max_participants: number;
  notes_html: string;
  created_at: string;
  created_by: UserSummary | null;
  route: EventRouteRef | null;
  participants: EventParticipant[];
  participant_count: number;
  is_joined: boolean;
  my_transport: TransportMode | null;
  can_edit: boolean;
}

export interface EventRouteUpload {
  name: string;
  distance_km: number | null;
  elevation_m: number | null;
  coordinates: [number, number][];
}

export interface EventInput {
  name: string;
  event_type: EventType;
  route_id?: number | null;
  /** Geüploade GPX die alleen bij dit event hoort. */
  route_upload?: EventRouteUpload | null;
  event_date: string;
  event_time?: string | null;
  url?: string | null;
  cost_eur?: number | null;
  distance_km?: number | null;
  speed_kmh?: number | null;
  max_participants: number;
  notes_html: string;
}

export interface WaterPoint {
  lat: number;
  lon: number;
  name: string | null;
  operator: string | null;
  opening_hours: string | null;
  website: string | null;
  source: string;
  distance_to_route_m: number;
  along_route_km: number;
}

export interface WaterStats {
  total_distance_km: number;
  water_point_count: number;
  average_gap_km: number | null;
  longest_gap_km: number;
  longest_gap_start_km: number;
  warning: string | null;
}

export interface WaterResult {
  job_id: string;
  filename: string;
  source: string;
  radius_m: number;
  stats: WaterStats;
  water_points: WaterPoint[];
}

export interface LegalitySegment {
  severity: "forbidden" | "warning";
  code: string;
  label: string;
  way_id: number | null;
  way_name: string | null;
  highway: string | null;
  start_km: number;
  end_km: number;
  length_m: number;
  coordinates: [number, number][];
}

export interface LegalityReport {
  total_distance_km: number;
  forbidden_count: number;
  warning_count: number;
  checked_at: string;
  source: string;
  segments: LegalitySegment[];
}

export interface LegalityStatus {
  status: "idle" | "running" | "done" | "error";
  progress: number;
  message: string | null;
  error: string | null;
  report: LegalityReport | null;
}

export interface RouteFilterState {
  search: string;
  kmMin: number | null;
  kmMax: number | null;
  wind: WindCode[];
  routeType: RouteType | null;
  minRating: number | null;
  categories: CategoryCode[];
  /** true = alleen favorieten; null = geen filter. */
  favorite: boolean | null;
  /** true = alleen gereden, false = alleen nog niet gereden, null = geen filter. */
  ridden: boolean | null;
  sort: string;
}

export const ROUTE_TYPE_LABELS: Record<RouteType, string> = {
  road: "Weg",
  road_gravel: "Weg met Gravel",
  gravel: "Gravel/Cross",
};

export const RIDE_TYPE_LABELS: Record<RideType, string> = {
  race: "Race",
  race_gravel: "Race met Gravel",
  gravel: "Gravel",
};

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  sportive: "Sportive / toertocht",
  race: "Wedstrijd",
  multiday: "Meerdaagse",
  gravel: "Gravel event",
  other: "Overig",
};

export const TRANSPORT_LABELS: Record<TransportMode, string> = {
  car: "Auto",
  train: "Trein",
  own_transport: "Eigen gelegenheid",
  bike: "Fiets ernaartoe",
};

export const NOTICE_KIND_LABELS: Record<NoticeKind, string> = {
  works: "Werkzaamheden",
  hazard: "Gevaar",
  info: "Bijzonderheid",
};

export const NOTICE_KIND_COLORS: Record<NoticeKind, string> = {
  works: "orange",
  hazard: "red",
  info: "blue",
};

export const WIND_LABELS: Record<WindCode, string> = {
  N: "Noord",
  O: "Oost",
  Z: "Zuid",
  W: "West",
};

export const CATEGORY_LABELS: Record<CategoryCode, string> = {
  beginners: "Beginners",
  high_pace: "Snelle groepen",
  tourist: "Toeristisch",
};

export interface OsmMapStatus {
  available: boolean;
  way_count: number;
  size_mb: number;
  age_days: number | null;
  stale: boolean;
  job_status: "idle" | "running" | "done" | "error";
  job_message: string | null;
  job_progress: number;
  job_error: string | null;
}

// ------------------------------------------------------------- instellingen

export interface AppSettings {
  /** Alle instelbare velden; geheimen staan hier altijd op null. */
  values: Record<string, unknown>;
  /** Per geheim veld of het gevuld is. De waarde zelf verlaat de server nooit. */
  secrets_set: Record<string, boolean>;
  /** Niet-instelbare velden met hun huidige waarde (geheimen gemaskeerd). */
  readonly: Record<string, string>;
  /** Per niet-instelbaar veld waaróm het niet instelbaar is. */
  readonly_reasons: Record<string, string>;
}

export interface SettingsUpdate {
  values: Record<string, unknown>;
  /** Een geheim expliciet wissen; leeg laten in `values` betekent ongewijzigd. */
  clear?: string[];
}

// -------------------------------------------------------------------- backup

export interface Backup {
  name: string;
  kind: string;
  size_bytes: number;
  created_at: string;
  has_media: boolean;
  alembic_revision: string | null;
}

export interface BackupJob {
  action: "backup" | "restore";
  state: "running" | "done" | "error";
  message: string;
  progress: number;
  error: string | null;
  result: string | null;
}

export interface BackupList {
  items: Backup[];
  job: BackupJob | null;
  keep_auto: number;
  keep_weekly: number;
  backup_hour: number;
}

// ------------------------------------------------------------- installatie

export interface SetupStatus {
  required: boolean;
}

export interface SetupAdminInput {
  email: string;
  display_name: string;
  password: string;
}
