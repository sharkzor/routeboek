import { Badge, Card, Group, Image, Stack, Text } from "@mantine/core";
import { IconArrowUpRight, IconBike } from "@tabler/icons-react";
import { Link } from "react-router";

import Stars from "./Stars";
import { ROUTE_TYPE_LABELS, WIND_LABELS, type RouteSummary } from "../api/types";

const TYPE_COLORS: Record<RouteSummary["route_type"], string> = {
  road: "routeboek",
  road_gravel: "orange",
  gravel: "teal",
};

export default function RouteCard({ route }: { route: RouteSummary }) {
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
      <Image
        src={route.map_url ?? "/brand/map-pattern.png"}
        alt={`Kaart van ${route.name}`}
        className="rb-map-thumb"
        fallbackSrc="/brand/map-pattern.png"
      />

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
            <Badge key={wind} size="sm" variant="outline" color="gray" title={WIND_LABELS[wind]}>
              {wind}
            </Badge>
          ))}
        </Group>
      </Stack>
    </Card>
  );
}
