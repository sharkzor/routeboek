/**
 * Fetch-client voor de eigen API.
 *
 * Stuurt altijd cookies mee en zet bij muterende requests het CSRF-token uit
 * het niet-HttpOnly cookie `rb_csrf` in de header. Gebruik nooit een kale
 * `fetch` naar /api: dan ontbreekt de CSRF-header en volgt een 403.
 */

import type {
  Comment,
  CommunityRouteCreateIn,
  EventInput,
  EventItem,
  RatingResult,
  Ride,
  RideDefaults,
  RideInput,
  RidePage,
  RideWeather,
  RouteDetail,
  MarkResult,
  RouteFilterState,
  RouteImportPreview,
  RoutePage,
  RouteSummary,
  SessionOut,
  TransportMode,
  TelegramLink,
  TelegramStatus,
  UpvoteResult,
  User,
  UserSummary,
  LegalityStatus,
  OsmMapStatus,
  WaterResult,
} from "./types";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Wordt aangeroepen zodra de server aangeeft dat de sessie voorbij is. */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)rb_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : "";
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);

  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (UNSAFE.has(method)) {
    headers.set("X-CSRF-Token", csrfToken());
  }

  const response = await fetch(path, {
    ...options,
    method,
    headers,
    credentials: "include",
  });

  if (response.status === 401) {
    onUnauthorized?.();
  }
  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { detail: text };
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, extractDetail(payload, response.status));
  }
  return payload as T;
}

function extractDetail(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    // FastAPI-validatiefouten zijn een lijst; toon de eerste begrijpelijke regel.
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string };
      if (first?.msg) return first.msg.replace(/^Value error,\s*/, "");
    }
  }
  if (status >= 500) return "Er ging iets mis op de server. Probeer het later opnieuw.";
  return "Er ging iets mis. Probeer het opnieuw.";
}

function query(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
    } else {
      search.append(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

const ALL_ROUTES_FILTERS: RouteFilterState = {
  search: "",
  kmMin: null,
  kmMax: null,
  wind: [],
  routeType: null,
  minRating: null,
  categories: [],
  favorite: null,
  ridden: null,
  sort: "name",
};

function routesRequest(
  path: string,
  filters: RouteFilterState,
  page: number,
  pageSize: number,
) {
  return request<RoutePage>(
    path +
      query({
        search: filters.search,
        km_min: filters.kmMin,
        km_max: filters.kmMax,
        wind: filters.wind,
        route_type: filters.routeType,
        min_rating: filters.minRating,
        category: filters.categories,
        favorite: filters.favorite,
        ridden: filters.ridden,
        sort: filters.sort,
        page,
        page_size: pageSize,
      }),
  );
}

/** Alle community-routes ophalen, voor keuzevelden. */
async function fetchAllCommunityRoutes(): Promise<RouteSummary[]> {
  const items: RouteSummary[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const chunk = await routesRequest(
      "/api/community/routes",
      { ...ALL_ROUTES_FILTERS, sort: "name" },
      page,
      100,
    );
    items.push(...chunk.items);
    if (chunk.items.length === 0 || items.length >= chunk.total) break;
  }
  return items;
}

/** Alle actieve routes ophalen; de API geeft maximaal 100 per pagina. */
async function fetchAllRoutes(): Promise<RouteSummary[]> {
  const items: RouteSummary[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const chunk = await routesRequest("/api/routes", ALL_ROUTES_FILTERS, page, 100);
    items.push(...chunk.items);
    if (chunk.items.length === 0 || items.length >= chunk.total) break;
  }
  return items;
}

export const api = {
  // -------------------------------------------------------------- accounts
  me: () => request<SessionOut>("/api/auth/me"),
  login: (email: string, password: string) =>
    request<SessionOut>("/api/auth/login", { method: "POST", ...json({ email, password }) }),
  logout: () => request<{ detail: string }>("/api/auth/logout", { method: "POST" }),
  register: (email: string, display_name: string, password: string) =>
    request<{ detail: string }>("/api/auth/register", {
      method: "POST",
      ...json({ email, display_name, password }),
    }),
  verifyEmail: (token: string) =>
    request<{ detail: string }>("/api/auth/verify", { method: "POST", ...json({ token }) }),
  resendVerification: (email: string) =>
    request<{ detail: string }>("/api/auth/resend-verification", {
      method: "POST",
      ...json({ email }),
    }),
  forgotPassword: (email: string) =>
    request<{ detail: string }>("/api/auth/forgot-password", {
      method: "POST",
      ...json({ email }),
    }),
  resetPassword: (token: string, password: string) =>
    request<{ detail: string }>("/api/auth/reset-password", {
      method: "POST",
      ...json({ token, password }),
    }),
  changePassword: (current_password: string, new_password: string) =>
    request<{ detail: string }>("/api/auth/change-password", {
      method: "POST",
      ...json({ current_password, new_password }),
    }),

  // ---------------------------------------------------------------- routes
  routes: (filters: RouteFilterState, page: number, pageSize: number) =>
    routesRequest("/api/routes", filters, page, pageSize),
  route: (id: number) => request<RouteDetail>(`/api/routes/${id}`),

  /** Alle actieve routes ophalen; de API geeft maximaal 100 per pagina. */
  allRoutes: () => fetchAllRoutes(),

  /** Officiële + community routes samen, voor het routekeuzeveld bij een rit. */
  allRoutesForRideForm: async (): Promise<RouteSummary[]> => {
    const [official, community] = await Promise.all([
      fetchAllRoutes(),
      fetchAllCommunityRoutes(),
    ]);
    return [...official, ...community];
  },

  // ------------------------------------------------------- community routes
  communityRoutes: (filters: RouteFilterState, page: number, pageSize: number) =>
    routesRequest("/api/community/routes", filters, page, pageSize),
  importCommunityRouteGpx: (file: File) => {
    const form = new FormData();
    form.append("gpx", file);
    return request<RouteImportPreview>("/api/community/routes/import", {
      method: "POST",
      body: form,
    });
  },
  createCommunityRoute: (payload: CommunityRouteCreateIn) =>
    request<RouteDetail>("/api/community/routes", { method: "POST", ...json(payload) }),
  upvoteRoute: (routeId: number) =>
    request<UpvoteResult>(`/api/community/routes/${routeId}/upvote`, { method: "POST" }),
  removeUpvote: (routeId: number) =>
    request<UpvoteResult>(`/api/community/routes/${routeId}/upvote`, { method: "DELETE" }),
  deleteCommunityRoute: (routeId: number) =>
    request<{ detail: string }>(`/api/community/routes/${routeId}`, { method: "DELETE" }),

  // -------------------------------------------- favorieten / gereden routes
  setFavorite: (routeId: number, on: boolean) =>
    request<MarkResult>(`/api/routes/${routeId}/favorite`, {
      method: on ? "POST" : "DELETE",
    }),
  setRidden: (routeId: number, on: boolean) =>
    request<MarkResult>(`/api/routes/${routeId}/ridden`, {
      method: on ? "POST" : "DELETE",
    }),

  // ---------------------------------------------------------------- ritten
  members: () => request<UserSummary[]>("/api/users"),
  rides: (includePast = false, mine = false) =>
    request<Ride[]>("/api/rides" + query({ include_past: includePast, mine })),
  ridesHistory: (params: { search?: string; mine?: boolean; page?: number; page_size?: number }) =>
    request<RidePage>("/api/rides/history" + query(params)),
  // `key` is de sleutel uit een gedeelde link naar een prive-rit; de server
  // legt de ontvanger daarmee vast als genodigde.
  ride: (id: number, key?: string | null) =>
    request<Ride>(`/api/rides/${id}` + query({ key: key || null })),
  rideDefaults: () => request<RideDefaults>("/api/rides/defaults"),
  createRide: (payload: RideInput) =>
    request<Ride>("/api/rides", { method: "POST", ...json(payload) }),
  updateRide: (id: number, payload: Partial<RideInput>) =>
    request<Ride>(`/api/rides/${id}`, { method: "PATCH", ...json(payload) }),
  deleteRide: (id: number) =>
    request<{ detail: string }>(`/api/rides/${id}`, { method: "DELETE" }),
  joinRide: (id: number) => request<Ride>(`/api/rides/${id}/join`, { method: "POST" }),
  leaveRide: (id: number) => request<Ride>(`/api/rides/${id}/leave`, { method: "POST" }),
  rideWeather: (id: number) => request<RideWeather>(`/api/rides/${id}/weather`),

  // -------------------------------------------------------------- telegram
  telegramStatus: () => request<TelegramStatus>("/api/telegram/status"),
  telegramLink: () =>
    request<TelegramLink>("/api/telegram/link", { method: "POST" }),
  telegramUnlink: () =>
    request<{ detail: string }>("/api/telegram/unlink", { method: "POST" }),

  // ----------------------------------------------------------------- events
  events: (includePast = false, mine = false) =>
    request<EventItem[]>("/api/events" + query({ include_past: includePast, mine })),
  event: (id: number) => request<EventItem>(`/api/events/${id}`),
  createEvent: (payload: EventInput) =>
    request<EventItem>("/api/events", { method: "POST", ...json(payload) }),
  updateEvent: (id: number, payload: Partial<EventInput>) =>
    request<EventItem>(`/api/events/${id}`, { method: "PATCH", ...json(payload) }),
  deleteEvent: (id: number) =>
    request<{ detail: string }>(`/api/events/${id}`, { method: "DELETE" }),
  joinEvent: (id: number, transport: TransportMode) =>
    request<EventItem>(`/api/events/${id}/join`, { method: "POST", ...json({ transport }) }),
  leaveEvent: (id: number) =>
    request<EventItem>(`/api/events/${id}/leave`, { method: "POST" }),

  // ------------------------------------------- controle op verboden paden
  startLegalityCheck: (routeId: number, refresh = false) =>
    request<LegalityStatus>(
      `/api/routes/${routeId}/legality` + query({ refresh: refresh || null }),
      { method: "POST" },
    ),

  legalityStatus: (routeId: number) =>
    request<LegalityStatus>(`/api/routes/${routeId}/legality`),

  mapStatus: () => request<OsmMapStatus>("/api/admin/map"),

  refreshMap: () =>
    request<OsmMapStatus>("/api/admin/map/refresh", { method: "POST" }),

  // ----------------------------------------------------------- waterpunten
  waterPoints: (routeId: number, radiusM: number) =>
    request<WaterResult>(
      `/api/water/routes/${routeId}` + query({ radius_m: radiusM }),
      { method: "POST" },
    ),
  waterDownloadUrl: (job: WaterResult) =>
    `/api/water/download/${job.job_id}${query({ filename: job.filename })}`,

  // -------------------------------------------------------- reacties/rating
  comments: (routeId: number) => request<Comment[]>(`/api/routes/${routeId}/comments`),
  addComment: (routeId: number, body: string) =>
    request<Comment>(`/api/routes/${routeId}/comments`, {
      method: "POST",
      ...json({ body }),
    }),
  deleteComment: (routeId: number, commentId: number) =>
    request<void>(`/api/routes/${routeId}/comments/${commentId}`, { method: "DELETE" }),
  setRating: (routeId: number, value: number) =>
    request<RatingResult>(`/api/routes/${routeId}/rating`, {
      method: "PUT",
      ...json({ value }),
    }),
  clearRating: (routeId: number) =>
    request<RatingResult>(`/api/routes/${routeId}/rating`, { method: "DELETE" }),

  // ----------------------------------------------------------------- admin
  adminRoutes: (search?: string) =>
    request<RouteSummary[]>("/api/admin/routes" + query({ search })),
  adminRoute: (id: number) => request<RouteDetail>(`/api/admin/routes/${id}`),
  adminCreateRoute: (form: FormData) =>
    request<RouteSummary>("/api/admin/routes", { method: "POST", body: form }),
  adminDeleteRoute: (id: number, hard = false) =>
    request<{ detail: string }>(`/api/admin/routes/${id}` + query({ hard }), {
      method: "DELETE",
    }),
  adminUpdateRoute: (id: number, payload: Record<string, unknown>) =>
    request<RouteSummary>(`/api/admin/routes/${id}`, { method: "PATCH", ...json(payload) }),
  adminPromoteRoute: (id: number) =>
    request<RouteSummary>(`/api/admin/routes/${id}/promote`, { method: "POST" }),
  adminUsers: (search?: string) => request<User[]>("/api/admin/users" + query({ search })),
  adminUpdateUser: (id: number, payload: Record<string, unknown>) =>
    request<User>(`/api/admin/users/${id}`, { method: "PATCH", ...json(payload) }),
  adminDeleteUser: (id: number) =>
    request<{ detail: string }>(`/api/admin/users/${id}`, { method: "DELETE" }),
};
