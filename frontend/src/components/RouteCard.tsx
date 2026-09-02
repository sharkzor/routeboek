import { ActionIcon, Badge, Button, Card, Group, Image, Stack, Text, Tooltip } from "@mantine/core";
import {
  IconArrowUpRight,
  IconBike,
  IconCheck,
  IconHeart,
  IconHeartFilled,
  IconThumbUp,
  IconThumbUpFilled,
  IconTrash,
} from "@tabler/icons-react";
import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router";

import Stars from "./Stars";
import { ROUTE_TYPE_LABELS, WIND_LABELS, type RouteSummary } from "../api/types";

const TYPE_COLORS: Record<RouteSummary["route_type"], string> = {
  road: "routeboek",
  road_gravel: "orange",
  gravel: "teal",
};

/** De hele kaart is één link; knoppen erin mogen dus niet doornavigeren. */
function swallow(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

export default function RouteCard({
  route,
  onToggleFavorite,
  onToggleRidden,
  onToggleUpvote,
  onDelete,
  footer,
}: {
  route: RouteSummary;
  onToggleFavorite?: (route: RouteSummary, next: boolean) => void;
  onToggleRidden?: (route: RouteSummary, next: boolean) => void;
  onToggleUpvote?: (route: RouteSummary, next: boolean) => void;
  onDelete?: (route: RouteSummary) => void;
  footer?: ReactNode;
}) {
  return (
    <Card
      component={Link}
      to={`/routes/${route.id}`}
      padding={0}
      radius="md"
      withBorder
      className="rb-route-card"
      style={{ overflow: "hidden", textDecoration: "none", color: "inherit" }}
    >
      <div className="rb-route-thumb-wrap">
        <Image
          src={route.map_url ?? "/brand/map-pattern.png"}
          alt={`Kaart van ${route.name}`}
          className="rb-map-thumb"
          fallbackSrc="/brand/map-pattern.png"
        />
        {(onToggleFavorite || onToggleRidden) && (
          <Group gap={6} className="rb-route-marks">
            {onToggleFavorite && (
              <Tooltip
                label={route.is_favorite ? "Uit favorieten halen" : "Als favoriet markeren"}
                withArrow
              >
                <ActionIcon
                  variant="white"
                  radius="xl"
                  color={route.is_favorite ? "routeboek" : "gray"}
                  aria-label="Favoriet"
                  onClick={(event) => {
                    swallow(event);
                    onToggleFavorite(route, !route.is_favorite);
                  }}
                >
                  {route.is_favorite ? <IconHeartFilled size={16} /> : <IconHeart size={16} />}
                </ActionIcon>
              </Tooltip>
            )}
            {onToggleRidden && (
              <Tooltip
                label={route.is_ridden ? "Toch niet gereden" : "Afvinken als gereden"}
                withArrow
              >
                <ActionIcon
                  variant={route.is_ridden ? "filled" : "white"}
                  radius="xl"
                  color={route.is_ridden ? "teal" : "gray"}
                  aria-label="Gereden"
                  onClick={(event) => {
                    swallow(event);
                    onToggleRidden(route, !route.is_ridden);
                  }}
                >
                  <IconCheck size={16} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        )}
      </div>

      <Stack gap={6} p="md">
        <Text fw={700} lineClamp={2} title={route.name}>
          {route.name}
        </Text>

        <Group gap="xs" wrap="nowrap">
          <Group gap={4} wrap="nowrap">
            <IconBike size={16} color="var(--rb-red)" />
            <Text size="sm" fw={600}>
              {route.distance_km !== null ? `${route.distance_km.toFixed(1)} km` : "– km"}
            </Text>
          </Group>
          <Group gap={4} wrap="nowrap">
            <IconArrowUpRight size={16} color="var(--rb-red)" />
            <Text size="sm" fw={600}>
              {route.elevation_m !== null ? `${Math.round(route.elevation_m)} hm` : "– hm"}
            </Text>
          </Group>
        </Group>

        <Stars value={route.rating} count={route.rating_count} />

        <Group gap={6} mt={2}>
          <Badge size="sm" variant="light" color={TYPE_COLORS[route.route_type]}>
            {ROUTE_TYPE_LABELS[route.route_type]}
          </Badge>
          {route.wind_directions.map((wind) => (
            <Badge
              key={wind}
              size="sm"
              variant="outline"
              color="gray"
              title={route.wind_estimated ? `${WIND_LABELS[wind]} (geschat)` : WIND_LABELS[wind]}
            >
              {route.wind_estimated ? `~${wind}` : wind}
            </Badge>
          ))}
        </Group>

        {route.submitted_by && (
          <Text size="xs" c="dimmed">
            Ingebracht door {route.submitted_by}
          </Text>
        )}

        {(onToggleUpvote || onDelete) && (
          <Group gap="xs" mt={4} justify="space-between" wrap="nowrap">
            {onToggleUpvote && (
              <Button
                size="compact-sm"
                variant={route.my_upvote ? "filled" : "light"}
                color="routeboek"
                leftSection={
                  route.my_upvote ? <IconThumbUpFilled size={15} /> : <IconThumbUp size={15} />
                }
                onClick={(event) => {
                  swallow(event);
                  onToggleUpvote(route, !route.my_upvote);
                }}
              >
                {route.upvote_count}
              </Button>
            )}
            {onDelete && route.can_delete && (
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label="Route verwijderen"
                onClick={(event) => {
                  swallow(event);
                  onDelete(route);
                }}
              >
                <IconTrash size={16} />
              </ActionIcon>
            )}
          </Group>
        )}

        {footer}
      </Stack>
    </Card>
  );
}
