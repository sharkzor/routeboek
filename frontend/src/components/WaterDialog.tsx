import { useState } from "react";
import {
  Alert,
  Button,
  Group,
  Modal,
  SimpleGrid,
  Slider,
  Stack,
  Text,
} from "@mantine/core";
import { IconAlertTriangle, IconDownload, IconDroplet } from "@tabler/icons-react";

import { ApiError, api } from "../api/client";
import type { RouteDetail, WaterResult } from "../api/types";

export default function WaterDialog({
  route,
  opened,
  onClose,
  onResult,
}: {
  route: RouteDetail;
  opened: boolean;
  onClose: () => void;
  onResult?: (result: WaterResult | null) => void;
}) {
  const [radius, setRadius] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WaterResult | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.waterPoints(route.id, radius);
      setResult(response);
      onResult?.(response);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Waterpunten zoeken is mislukt.",
      );
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResult(null);
    setError(null);
    onResult?.(null);
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap={8}>
          <IconDroplet size={20} color="var(--rb-red)" />
          <Text fw={700}>Waterpunten toevoegen</Text>
        </Group>
      }
      size="lg"
      centered
    >
      <Stack gap="md">
        {!result && (
          <>
            <Text size="sm" c="dimmed">
              We zoeken drinkwaterpunten langs {route.name} en zetten ze als waypoints in een
              nieuw GPX-bestand.
            </Text>

            <Stack gap={4}>
              <Text size="sm" fw={600}>
                Zoekafstand vanaf de route: {radius} m
              </Text>
              <Slider
                min={50}
                max={1000}
                step={50}
                color="routeboek"
                value={radius}
                onChange={setRadius}
                marks={[
                  { value: 100, label: "100 m" },
                  { value: 500, label: "500 m" },
                  { value: 1000, label: "1 km" },
                ]}
              />
            </Stack>

            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}

            <Button
              onClick={() => void run()}
              loading={busy}
              color="routeboek"
              leftSection={<IconDroplet size={18} />}
            >
              Zoek waterpunten
            </Button>
          </>
        )}

        {result && (
          <>
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
              <Stat label="Waterpunten" value={String(result.stats.water_point_count)} />
              <Stat label="Afstand" value={`${result.stats.total_distance_km.toFixed(1)} km`} />
              <Stat
                label="Gem. tussenafstand"
                value={
                  result.stats.average_gap_km !== null
                    ? `${result.stats.average_gap_km.toFixed(1)} km`
                    : "–"
                }
              />
              <Stat
                label="Grootste gat"
                value={`${result.stats.longest_gap_km.toFixed(1)} km`}
              />
            </SimpleGrid>

            <Text size="sm" c="dimmed">
              Bron: {result.source} · zoekafstand {result.radius_m} m
            </Text>

            {result.stats.warning && (
              <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={18} />}>
                {result.stats.warning}
              </Alert>
            )}

            <Group>
              <Button
                component="a"
                href={api.waterDownloadUrl(result)}
                color="routeboek"
                leftSection={<IconDownload size={18} />}
              >
                Download GPX met waterpunten
              </Button>
              <Button variant="subtle" color="gray" onClick={reset}>
                Opnieuw zoeken
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap={0}>
      <Text fz={22} fw={700} c="routeboek.6">
        {value}
      </Text>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Stack>
  );
}
