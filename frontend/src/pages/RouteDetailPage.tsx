import { lazy, Suspense, useEffect, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconArrowLeft,
  IconArrowUpRight,
  IconBike,
  IconBrandStrava,
  IconCalendarPlus,
  IconDownload,
  IconDroplet,
} from "@tabler/icons-react";
import { Link, useNavigate, useParams } from "react-router";

import Stars from "../components/Stars";
import WaterDialog from "../components/WaterDialog";

// Leaflet is fors; alleen deze pagina heeft het nodig.
const RouteMap = lazy(() => import("../components/RouteMap"));
import { ApiError, api } from "../api/client";
import {
  CATEGORY_LABELS,
  ROUTE_TYPE_LABELS,
  WIND_LABELS,
  type RouteDetail,
  type WaterResult,
} from "../api/types";

export default function RouteDetailPage() {
  const { routeId } = useParams();
  const navigate = useNavigate();
  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [water, setWater] = useState<WaterResult | null>(null);
  const [waterOpened, waterDialog] = useDisclosure(false);

  useEffect(() => {
    let cancelled = false;
    setRoute(null);
    setWater(null);
    api
      .route(Number(routeId))
      .then((response) => {
        if (!cancelled) setRoute(response);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Route laden is mislukt.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [routeId]);

  if (error) {
    return (
      <Stack gap="md">
        <Alert color="red" variant="light">
          {error}
        </Alert>
        <Button component={Link} to="/routes" variant="light" color="routeboek" w="fit-content">
          Terug naar routes
        </Button>
      </Stack>
    );
  }

  if (!route) {
    return (
      <Center py="xl">
        <Loader color="routeboek" />
      </Center>
    );
  }

  return (
    <Stack gap="lg">
      <Anchor component={Link} to="/routes" c="dimmed" size="sm">
        <Group gap={4}>
          <IconArrowLeft size={16} /> Terug naar routes
        </Group>
      </Anchor>

      <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
        <Box>
          <Title order={2}>{route.name}</Title>
          <Group gap="xs" mt={6}>
            <Stars value={route.rating} count={route.rating_count} size={18} />
          </Group>
        </Box>
        <Button
          leftSection={<IconCalendarPlus size={18} />}
          color="routeboek"
          onClick={() => navigate(`/ritten/nieuw?route=${route.id}`)}
        >
          Organiseer een rit
        </Button>
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
        <Metric
          icon={<IconBike size={20} />}
          label="Afstand"
          value={route.distance_km !== null ? `${route.distance_km.toFixed(1)} km` : "–"}
        />
        <Metric
          icon={<IconArrowUpRight size={20} />}
          label="Hoogtemeters"
          value={route.elevation_m !== null ? `${Math.round(route.elevation_m)} hm` : "–"}
        />
        <Metric label="Soort" value={ROUTE_TYPE_LABELS[route.route_type]} />
        <Metric
          label="Wind"
          value={
            route.wind_directions.length > 0
              ? route.wind_directions.map((w) => WIND_LABELS[w]).join(", ")
              : "Geen voorkeur"
          }
        />
      </SimpleGrid>

      {route.categories.length > 0 && (
        <Group gap={6}>
          <Text size="sm" c="dimmed">
            Aanbevolen voor:
          </Text>
          {route.categories.map((category) => (
            <Badge key={category} variant="light" color="routeboek">
              {CATEGORY_LABELS[category]}
            </Badge>
          ))}
        </Group>
      )}

      {route.coordinates.length > 1 ? (
        <Paper radius="md" p="xs" withBorder>
          <Suspense
            fallback={
              <Center h={420}>
                <Loader color="routeboek" />
              </Center>
            }
          >
            <RouteMap coordinates={route.coordinates} waterPoints={water?.water_points ?? []} />
          </Suspense>
        </Paper>
      ) : (
        route.map_url && (
          <Paper radius="md" withBorder style={{ overflow: "hidden" }}>
            <img src={route.map_url} alt={`Kaart van ${route.name}`} style={{ width: "100%" }} />
          </Paper>
        )
      )}

      <Group gap="sm" wrap="wrap">
        {route.has_gpx && (
          <Button
            component="a"
            href={`/api/routes/${route.id}/gpx`}
            variant="light"
            color="routeboek"
            leftSection={<IconDownload size={18} />}
          >
            GPX
          </Button>
        )}
        {route.has_tcx && (
          <Button
            component="a"
            href={`/api/routes/${route.id}/tcx`}
            variant="light"
            color="routeboek"
            leftSection={<IconDownload size={18} />}
          >
            TCX
          </Button>
        )}
        {route.strava_url && (
          <Button
            component="a"
            href={route.strava_url}
            target="_blank"
            rel="noopener noreferrer"
            variant="light"
            color="orange"
            leftSection={<IconBrandStrava size={18} />}
          >
            Strava
          </Button>
        )}
        {route.has_gpx && (
          <Button
            variant="light"
            color="blue"
            leftSection={<IconDroplet size={18} />}
            onClick={waterDialog.open}
          >
            Waterpunten zoeken
          </Button>
        )}
      </Group>

      {water && (
        <Alert color="blue" variant="light">
          {water.stats.water_point_count} waterpunten gevonden en op de kaart gezet.
        </Alert>
      )}

      {route.description_html && (
        <Card radius="md" withBorder p="lg">
          <Title order={4} mb="sm">
            Beschrijving
          </Title>
          <Box
            className="rb-description"
            // De beschrijvingen komen uit het oude routeboek en zijn opgeschoond bij de import.
            dangerouslySetInnerHTML={{ __html: route.description_html }}
          />
        </Card>
      )}

      <WaterDialog
        route={route}
        opened={waterOpened}
        onClose={waterDialog.close}
        onResult={setWater}
      />
    </Stack>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Paper radius="md" p="md" withBorder>
      <Group gap={8} mb={4} c="routeboek.6">
        {icon}
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          {label}
        </Text>
      </Group>
      <Text fw={700}>{value}</Text>
    </Paper>
  );
}
