import { useEffect, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Image,
  Modal,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconArrowUpRight,
  IconBike,
  IconPlus,
  IconSearch,
  IconThumbUp,
  IconTrash,
} from "@tabler/icons-react";
import { Link } from "react-router";

import { ApiError, api } from "../api/client";
import { ROUTE_TYPE_LABELS, type RouteSummary } from "../api/types";

export default function CommunityRoutesPage() {
  const [routes, setRoutes] = useState<RouteSummary[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<RouteSummary | null>(null);
  const [deleteOpened, deleteModal] = useDisclosure(false);
  const [deleting, setDeleting] = useState(false);

  const load = async (query?: string) => {
    try {
      const result = await api.communityRoutes(query || undefined, "upvotes");
      setRoutes(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Laden is mislukt.");
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleUpvote = async (route: RouteSummary) => {
    if (!routes) return;
    try {
      const result = route.my_upvote
        ? await api.removeUpvote(route.id)
        : await api.upvoteRoute(route.id);
      setRoutes(
        routes.map((r) =>
          r.id === route.id
            ? { ...r, upvote_count: result.upvote_count, my_upvote: result.my_upvote }
            : r,
        ),
      );
    } catch (err) {
      notifications.show({
        message: err instanceof ApiError ? err.message : "Stemmen is mislukt.",
        color: "red",
      });
    }
  };

  const confirmDelete = (route: RouteSummary) => {
    setPending(route);
    deleteModal.open();
  };

  const deleteRoute = async () => {
    if (!pending) return;
    setDeleting(true);
    try {
      await api.deleteCommunityRoute(pending.id);
      setRoutes((current) => (current ? current.filter((r) => r.id !== pending.id) : current));
      notifications.show({ message: "Route is verwijderd.", color: "green" });
    } catch (err) {
      notifications.show({
        message: err instanceof ApiError ? err.message : "Verwijderen is mislukt.",
        color: "red",
      });
    } finally {
      setDeleting(false);
      deleteModal.close();
      setPending(null);
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" wrap="wrap">
        <Stack gap={2}>
          <Title order={2}>Community routes</Title>
          <Text c="dimmed" size="sm">
            Door leden aangeleverde routes. Stem op je favorieten, of lever er zelf een aan.
          </Text>
        </Stack>
        <Button component={Link} to="/community/nieuw" color="routeboek" leftSection={<IconPlus size={16} />}>
          Route aanleveren
        </Button>
      </Group>

      <TextInput
        placeholder="Zoek op naam…"
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(event) => {
          const value = event.currentTarget.value;
          setSearch(value);
          void load(value);
        }}
        maw={360}
      />

      {error && <Text c="red">{error}</Text>}

      {!routes ? (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={220} radius="md" />
          ))}
        </SimpleGrid>
      ) : routes.length === 0 ? (
        <Text c="dimmed">Nog geen community routes. Lever de eerste aan!</Text>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {routes.map((route) => (
            <Card key={route.id} padding={0} radius="md" withBorder style={{ overflow: "hidden" }}>
              <Link to={`/routes/${route.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                <Image
                  src={route.map_url ?? "/brand/map-pattern.png"}
                  alt={`Kaart van ${route.name}`}
                  className="rb-map-thumb"
                  fallbackSrc="/brand/map-pattern.png"
                />
              </Link>
              <Stack gap={6} p="md">
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <Text
                    component={Link}
                    to={`/routes/${route.id}`}
                    fw={700}
                    lineClamp={2}
                    title={route.name}
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    {route.name}
                  </Text>
                  <Group gap={4} wrap="nowrap">
                    <ActionIcon
                      variant={route.my_upvote ? "filled" : "light"}
                      color="routeboek"
                      onClick={() => void toggleUpvote(route)}
                      aria-label="Stem op deze route"
                    >
                      <IconThumbUp size={16} />
                    </ActionIcon>
                    <Text size="sm" fw={600}>
                      {route.upvote_count}
                    </Text>
                    {route.can_delete && (
                      <ActionIcon
                        variant="light"
                        color="red"
                        onClick={() => confirmDelete(route)}
                        aria-label="Verwijder deze route"
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    )}
                  </Group>
                </Group>

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

                <Group gap={6}>
                  <Badge size="sm" variant="light" color="routeboek">
                    {ROUTE_TYPE_LABELS[route.route_type]}
                  </Badge>
                  {route.wind_directions.map((wind) => (
                    <Badge key={wind} size="sm" variant="outline" color="gray">
                      {route.wind_estimated ? `~${wind}` : wind}
                    </Badge>
                  ))}
                </Group>

                {route.submitted_by && (
                  <Text size="xs" c="dimmed">
                    Aangeleverd door {route.submitted_by}
                  </Text>
                )}
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      )}

      <Modal opened={deleteOpened} onClose={deleteModal.close} title="Route verwijderen">
        <Stack gap="md">
          <Text size="sm">
            Weet je zeker dat je <strong>{pending?.name}</strong> wilt verwijderen? Dit kan niet
            ongedaan worden gemaakt.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={deleteModal.close}>
              Annuleren
            </Button>
            <Button color="red" loading={deleting} onClick={() => void deleteRoute()}>
              Verwijderen
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
