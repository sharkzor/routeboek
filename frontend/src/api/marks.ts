import type { Dispatch, SetStateAction } from "react";

import { api } from "./client";
import type { RoutePage, RouteSummary } from "./types";

type PageSetter = Dispatch<SetStateAction<RoutePage | null>>;

/** Persoonlijke markeringen en stemmen op een routeoverzicht.
 *
 * De UI wordt meteen bijgewerkt en pas daarna bevestigd door de server; gaat
 * het mis, dan draaien we de wijziging terug. Zo voelt aanvinken direct, ook
 * op een trage mobiele verbinding.
 */
export function routeMarkHandlers(setData: PageSetter) {
  const patch = (id: number, change: Partial<RouteSummary>) =>
    setData((prev) =>
      prev
        ? { ...prev, items: prev.items.map((r) => (r.id === id ? { ...r, ...change } : r)) }
        : prev,
    );

  return {
    onToggleFavorite: (route: RouteSummary, next: boolean) => {
      patch(route.id, { is_favorite: next });
      api.setFavorite(route.id, next).catch(() => patch(route.id, { is_favorite: !next }));
    },
    onToggleRidden: (route: RouteSummary, next: boolean) => {
      patch(route.id, { is_ridden: next });
      api.setRidden(route.id, next).catch(() => patch(route.id, { is_ridden: !next }));
    },
    onToggleUpvote: (route: RouteSummary, next: boolean) => {
      const before = { my_upvote: route.my_upvote, upvote_count: route.upvote_count };
      patch(route.id, {
        my_upvote: next,
        upvote_count: Math.max(0, route.upvote_count + (next ? 1 : -1)),
      });
      const call = next ? api.upvoteRoute(route.id) : api.removeUpvote(route.id);
      call
        .then((result) =>
          patch(route.id, {
            my_upvote: result.my_upvote,
            upvote_count: result.upvote_count,
          }),
        )
        .catch(() => patch(route.id, before));
    },
  };
}
