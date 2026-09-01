/** Types die overeenkomen met de Pydantic-modellen van de backend. */

export type RouteType = "road" | "road_gravel" | "gravel";
export type RideType = "race" | "race_gravel" | "gravel";
export type EventType = "sportive" | "race" | "multiday" | "gravel" | "other";
export type TransportMode = "car" | "train" | "own_transport" | "bike";
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
  origin: "official" | "community";
  upvote_count: number;
  submitted_by: string | null;
  my_upvote: boolean;
  can_delete: boolean;
}

export interface RouteDetail extends RouteSummary {
  description_html: string;
  strava_url: string | null;
  coordinates: [number, number][];
  created_at: string;
  my_rating: number | null;
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
  distance_km: number;
  elevation_m: number;
  coordinates: [number, number][];
}

export interface UpvoteResult {
  upvote_count: number;
  my_upvote: boolean;
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
}

export interface RideDefaults {
  ride_date: string;
  ride_time: string;
  label: string;
}

export interface WeatherHour {
  time: string;
  temp_c: number;
  precipitation_mm: number;
  precipitation_probability: number | null;
  weather_code: number;
  wind_speed_kmh: number;
  wind_direction_deg: number;
  is_day: boolean;
}

export interface RideWeather {
  available: boolean;
  hours: WeatherHour[];
}

export interface RideInput {
  name: string;
  owner_id?: number | null;
  ride_date: string;
  ride_time: string;
  route_id?: number | null;
  ride_type: RideType;
  distance_km?: number | null;
  speed_kmh?: number | null;
  max_participants: number;
  notes_html: string;
  is_private: boolean;
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

export interface EventInput {
  name: string;
  event_type: EventType;
  route_id?: number | null;
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

export interface RouteFilterState {
  search: string;
  kmMin: number | null;
  kmMax: number | null;
  wind: WindCode[];
  routeType: RouteType | null;
  minRating: number | null;
  categories: CategoryCode[];
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
