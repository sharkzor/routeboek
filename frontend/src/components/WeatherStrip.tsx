import { Group, Loader, Paper, ScrollArea, Stack, Text } from "@mantine/core";
import {
  IconArrowUp,
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

/** Korte Nederlandse omschrijving per WMO-weercode, voor gebruik in
 *  tekst (bijv. het deel-bericht van een rit). */
export function weatherLabel(code: number, isDay: boolean): string {
  if (code === 0 || code === 1) return isDay ? "Zonnig" : "Helder";
  if (code === 2) return "Half bewolkt";
  if (code === 3) return "Bewolkt";
  if (code === 45 || code === 48) return "Mist";
  if ([51, 53, 55, 56, 57].includes(code)) return "Motregen";
  if ([61, 63, 65, 66, 67].includes(code)) return "Regen";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Sneeuw";
  if ([80, 81, 82].includes(code)) return "Buien";
  if ([95, 96, 99].includes(code)) return "Onweer";
  return "Wisselvallig";
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
            style={{ minWidth: 88, flexShrink: 0, textAlign: "center" }}
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
              <Group gap={3} justify="center" wrap="nowrap">
                <IconArrowUp
                  size={14}
                  color="var(--mantine-color-gray-6)"
                  style={{
                    // wind_direction_deg is de richting waar de wind
                    // vandaan komt; +180° laat de pijl zien waar de wind
                    // naartoe waait (intuïtiever: "de wind duwt je deze
                    // kant op").
                    transform: `rotate(${hour.wind_direction_deg + 180}deg)`,
                  }}
                />
                <Text size="xs" fw={600}>
                  {hour.wind_compass}
                </Text>
                <Text size="xs" c="dimmed">
                  {hour.wind_beaufort} Bft
                </Text>
              </Group>
            </Stack>
          </Paper>
        ))}
      </Group>
    </ScrollArea>
  );
}
