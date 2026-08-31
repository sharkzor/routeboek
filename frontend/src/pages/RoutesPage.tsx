import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Center,
  Drawer,
  Group,
  Loader,
  Pagination,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useDebouncedValue, useDisclosure, useMediaQuery } from "@mantine/hooks";
import { IconFilter, IconMoodEmpty } from "@tabler/icons-react";

import RouteCard from "../components/RouteCard";
import RouteFilters, { EMPTY_FILTERS, hasActiveFilters } from "../components/RouteFilters";
import { ApiError, api } from "../api/client";
import type { RouteFilterState, RoutePage } from "../api/types";

const PAGE_SIZE = 24;

const SORT_OPTIONS = [
  { value: "name", label: "Naam (A-Z)" },
  { value: "distance_asc", label: "Afstand (kort → lang)" },
  { value: "distance_desc", label: "Afstand (lang → kort)" },
  { value: "elevation_desc", label: "Hoogtemeters (veel → weinig)" },
  { value: "elevation_asc", label: "Hoogtemeters (weinig → veel)" },
  { value: "rating_desc", label: "Best beoordeeld" },
  { value: "recent", label: "Nieuwste eerst" },
];

export default function RoutesPage() {
  const [filters, setFilters] = useState<RouteFilterState>(EMPTY_FILTERS);
  const [debouncedFilters] = useDebouncedValue(filters, 300);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RoutePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpened, drawer] = useDisclosure(false);
  const isMobile = useMediaQuery("(max-width: 62em)");

  useEffect(() => {
    setPage(1);
  }, [debouncedFilters]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .routes(debouncedFilters, page, PAGE_SIZE)
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

  // Grenzen komen uit de API zodat de slider bij alle routes past.
  const bounds = useMemo(
    () => ({
      min: Math.floor((data?.distance_min ?? 0) / 5) * 5,
      max: Math.ceil((data?.distance_max ?? 200) / 5) * 5,
    }),
    [data?.distance_min, data?.distance_max],
  );

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  const filterPanel = (
    <RouteFilters
      value={filters}
      onChange={(next) => {
        setFilters(next);
        if (isMobile) drawer.close();
      }}
      bounds={bounds}
    />
  );

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Box>
          <Title order={2}>Routes</Title>
          <Text c="dimmed" size="sm">
            {data ? `${data.total} routes gevonden` : "Routes laden…"}
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
            onChange={(sort) => setFilters({ ...filters, sort: sort ?? "name" })}
            allowDeselect={false}
            w={230}
            aria-label="Sorteren"
          />
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
                <Text c="dimmed">Geen routes gevonden met deze filters.</Text>
                <Button
                  variant="light"
                  color="routeboek"
                  onClick={() => setFilters({ ...EMPTY_FILTERS, sort: filters.sort })}
                >
                  Filters wissen
                </Button>
              </Stack>
            </Center>
          ) : (
            <Stack gap="lg" opacity={loading ? 0.6 : 1}>
              <SimpleGrid cols={{ base: 1, xs: 2, md: 2, lg: 3, xl: 4 }} spacing="md">
                {data?.items.map((route) => (
                  <RouteCard key={route.id} route={route} />
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
        {filterPanel}
      </Drawer>
    </Stack>
  );
}
