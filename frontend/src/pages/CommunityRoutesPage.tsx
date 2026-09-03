import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Center,
  Drawer,
  Group,
  Loader,
  Modal,
  Pagination,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useDebouncedValue, useDisclosure, useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconFilter, IconMoodEmpty, IconPlus } from "@tabler/icons-react";
import { Link } from "react-router";

import RouteCard from "../components/RouteCard";
import RouteFilters, { EMPTY_FILTERS, hasActiveFilters } from "../components/RouteFilters";
import { ApiError, api } from "../api/client";
import { routeMarkHandlers } from "../api/marks";
import type { RouteFilterState, RoutePage, RouteSummary } from "../api/types";

const PAGE_SIZE = 24;

// Standaard op stemmen gesorteerd: de best gewaardeerde inzendingen bovenaan.
const START_FILTERS: RouteFilterState = { ...EMPTY_FILTERS, sort: "upvotes" };

const SORT_OPTIONS = [
  { value: "upvotes", label: "Meeste stemmen" },
  { value: "recent", label: "Nieuwste eerst" },
  { value: "name", label: "Naam (A-Z)" },
  { value: "distance_asc", label: "Afstand (kort → lang)" },
  { value: "distance_desc", label: "Afstand (lang → kort)" },
  { value: "elevation_desc", label: "Hoogtemeters (veel → weinig)" },
  { value: "elevation_asc", label: "Hoogtemeters (weinig → veel)" },
  { value: "rating_desc", label: "Best beoordeeld" },
];

export default function CommunityRoutesPage() {
  const [filters, setFilters] = useState<RouteFilterState>(START_FILTERS);
  const [debouncedFilters] = useDebouncedValue(filters, 300);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RoutePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpened, drawer] = useDisclosure(false);
  const isMobile = useMediaQuery("(max-width: 62em)");

  const [pending, setPending] = useState<RouteSummary | null>(null);
  const [deleteOpened, deleteModal] = useDisclosure(false);
  const [deleting, setDeleting] = useState(false);

  const marks = useMemo(() => routeMarkHandlers(setData), []);

  useEffect(() => {
    setPage(1);
  }, [debouncedFilters]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .communityRoutes(debouncedFilters, page, PAGE_SIZE)
      .then((response) => {
        if (!cancelled) {
          setData(response);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Routes laden is mislukt.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedFilters, page]);

  const bounds = useMemo(
    () => ({
      min: Math.floor((data?.distance_min ?? 0) / 5) * 5,
      max: Math.ceil((data?.distance_max ?? 200) / 5) * 5,
    }),
    [data?.distance_min, data?.distance_max],
  );

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  const confirmDelete = (route: RouteSummary) => {
    setPending(route);
    deleteModal.open();
  };

  const deleteRoute = async () => {
    if (!pending) return;
    setDeleting(true);
    try {
      await api.deleteCommunityRoute(pending.id);
      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.filter((r) => r.id !== pending.id),
              total: Math.max(0, current.total - 1),
            }
          : current,
      );
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

  const filterPanel = (
    <RouteFilters
      value={filters}
      onChange={setFilters}
      bounds={bounds}
    />
  );

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Box>
          <Title order={2}>Community routes</Title>
          <Text c="dimmed" size="sm">
            {data
              ? `${data.total} door leden aangeleverde routes`
              : "Community routes laden…"}
          </Text>
        </Box>
        <Group gap="sm">
          {isMobile && (
            <Button
              variant="light"
              color="routeboek"
              leftSection={<IconFilter size={16} />}
              onClick={drawer.open}
            >
              Filters{hasActiveFilters(filters) ? " •" : ""}
            </Button>
          )}
          <Select
            data={SORT_OPTIONS}
            value={filters.sort}
            onChange={(sort) => setFilters({ ...filters, sort: sort ?? "upvotes" })}
            allowDeselect={false}
            w={230}
            aria-label="Sorteren"
          />
          <Button
            component={Link}
            to="/community/nieuw"
            color="routeboek"
            leftSection={<IconPlus size={16} />}
          >
            Route aanleveren
          </Button>
        </Group>
      </Group>

      <Group align="flex-start" gap="lg" wrap="nowrap">
        {!isMobile && (
          <Box w={280} style={{ flexShrink: 0, position: "sticky", top: 88 }}>
            {filterPanel}
          </Box>
        )}

        <Box style={{ flex: 1, minWidth: 0 }}>
          {error && (
            <Alert color="red" variant="light" mb="md">
              {error}
            </Alert>
          )}

          {loading && !data ? (
            <Center py="xl">
              <Loader color="routeboek" />
            </Center>
          ) : data && data.items.length === 0 ? (
            <Center py="xl">
              <Stack align="center" gap="xs">
                <IconMoodEmpty size={40} color="#adb5bd" />
                <Text c="dimmed">
                  {hasActiveFilters(filters)
                    ? "Geen community routes gevonden met deze filters."
                    : "Nog geen community routes. Lever de eerste aan!"}
                </Text>
                {hasActiveFilters(filters) && (
                  <Button
                    variant="light"
                    color="routeboek"
                    onClick={() => setFilters({ ...EMPTY_FILTERS, sort: filters.sort })}
                  >
                    Filters wissen
                  </Button>
                )}
              </Stack>
            </Center>
          ) : (
            <Stack gap="lg" opacity={loading ? 0.6 : 1}>
              <SimpleGrid cols={{ base: 1, xs: 2, md: 2, lg: 3, xl: 4 }} spacing="md">
                {data?.items.map((route) => (
                  <RouteCard
                    key={route.id}
                    route={route}
                    onToggleFavorite={marks.onToggleFavorite}
                    onToggleRidden={marks.onToggleRidden}
                    onToggleUpvote={marks.onToggleUpvote}
                    onDelete={confirmDelete}
                  />
                ))}
              </SimpleGrid>

              {pageCount > 1 && (
                <Center>
                  <Pagination
                    total={pageCount}
                    value={page}
                    onChange={(next) => {
                      setPage(next);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    color="routeboek"
                  />
                </Center>
              )}
            </Stack>
          )}
        </Box>
      </Group>

      <Drawer
        opened={drawerOpened}
        onClose={drawer.close}
        title="Filters"
        position="left"
        size="sm"
      >
        <Stack gap="md">
          {filterPanel}
          <Button
            color="routeboek"
            onClick={drawer.close}
            style={{ position: "sticky", bottom: 0 }}
          >
            {data ? `Toon ${data.total} routes` : "Toon resultaten"}
          </Button>
        </Stack>
      </Drawer>

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
