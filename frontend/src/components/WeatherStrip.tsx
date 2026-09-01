import { Group, Loader, Paper, ScrollArea, Stack, Text } from "@mantine/core";
import {
  IconCloud,
  IconCloudFog,
  IconCloudRain,
  IconCloudSnow,
  IconCloudStorm,
  IconMoon,
  IconSun,
} from "@tabler/icons-react";
import type { WeatherHour } from "../api/types";

/** Icoon + kleur per WMO-weercode (Open-Meteo), met dag/nacht-variant. */
function weatherIcon(code: number, isDay: boolean) {
  if (code === 0 || code === 1) {
    return isDay ? (
      <IconSun size={24} color="var(--mantine-color-yellow-6)" />
    ) : (
      <IconMoon size={24} color="var(--mantine-color-indigo-4)" />
    );
  }
  if (code === 2) {
    return <IconCloud size={24} color="var(--mantine-color-yellow-6)" />;
  }
  if (code === 3) {
    return <IconCloud size={24} color="var(--mantine-color-gray-5)" />;
  }
  if (code === 45 || code === 48) {
    return <IconCloudFog size={24} color="var(--mantine-color-gray-5)" />;
  }
  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return <IconCloudSnow size={24} color="var(--mantine-color-blue-3)" />;
  }
  if ([95, 96, 99].includes(code)) {
    return <IconCloudStorm size={24} color="var(--mantine-color-violet-6)" />;
  }
  // drizzel/regen (51-67, 80-82) en overige gevallen
  return <IconCloudRain size={24} color="var(--mantine-color-blue-5)" />;
}

interface WeatherStripProps {
  loading: boolean;
  hours: WeatherHour[] | null;
}

export function WeatherStrip({ loading, hours }: WeatherStripProps) {
  if (loading) {
    return (
      <Group gap="xs" py="xs">
        <Loader size="xs" color="routeboek" />
        <Text size="xs" c="dimmed">
          Weerbericht ophalen ...
        </Text>
      </Group>
    );
  }

  if (!hours || hours.length === 0) {
    return (
      <Text size="xs" c="dimmed" py="xs">
        Nog geen weerbericht beschikbaar voor deze datum.
      </Text>
    );
  }

  return (
    <ScrollArea type="auto" offsetScrollbars scrollbarSize={6}>
      <Group gap="xs" wrap="nowrap" py="xs">
        {hours.map((hour) => (
          <Paper
            key={hour.time}
            withBorder
            radius="md"
            p="xs"
            style={{ minWidth: 68, flexShrink: 0, textAlign: "center" }}
          >
            <Stack gap={2} align="center">
              <Text size="xs" c="dimmed">
                {hour.time.slice(11, 16)}
              </Text>
              {weatherIcon(hour.weather_code, hour.is_day)}
              <Text size="sm" fw={700}>
                {Math.round(hour.temp_c)}°
              </Text>
              <Text size="xs" c="dimmed">
                {hour.precipitation_probability ?? 0}%
              </Text>
              <Text size="xs" c="dimmed">
                {Math.round(hour.wind_speed_kmh)} km/u
              </Text>
            </Stack>
          </Paper>
        ))}
      </Group>
    </ScrollArea>
  );
}
