import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { DateInput, TimeInput } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import { IconArrowRight, IconBolt, IconSearch } from "@tabler/icons-react";
import { Link, useNavigate } from "react-router";

import { ApiError, api } from "../api/client";
import RouteCard from "../components/RouteCard";
import { RIDE_TYPE_LABELS, WIND_LABELS, type RideType, type RouteSummary, type WindCode } from "../api/types";

const RIDE_TYPE_OPTIONS = (Object.keys(RIDE_TYPE_LABELS) as RideType[]).map((value) => ({
  value,
  label: RIDE_TYPE_LABELS[value],
}));

/** Vandaag als "YYYY-MM-DD" in lokale tijd; toISOString() zou een dag kunnen
 *  schuiven door de UTC-conversie. */
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export default function QuickStartPage() {
  const navigate = useNavigate();

  const [rideDate, setRideDate] = useState<string | null>(null);
  const [rideTime, setRideTime] = useState("19:00");
  const [rideType, setRideType] = useState<RideType>("race");
  const [ready, setReady] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routes, setRoutes] = useState<RouteSummary[] | null>(null);
  const [windDirection, setWindDirection] = useState<WindCode | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const defaults = await api.rideDefaults();
        if (cancelled) return;
        setRideDate(defaults.ride_date);
        setRideTime(defaults.ride_time.slice(0, 5));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Gegevens laden is mislukt.");
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const search = async () => {
    if (!rideDate || !/^\d{2}:\d{2}/.test(rideTime)) {
      notifications.show({ message: "Kies eerst een datum en tijd.", color: "red" });
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const result = await api.quickstart(rideDate, `${rideTime}:00`.slice(0, 8), rideType);
      setRoutes(result.routes);
      setWindDirection(result.wind_direction as WindCode | null);
      setSearched(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Zoeken is mislukt.");
    } finally {
      setSearching(false);
    }
  };

  // Meteen een eerste suggestie tonen zodra de standaarddatum/-tijd bekend is.
  useEffect(() => {
    if (ready && rideDate && !searched) {
      void search();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const startRide = (route: RouteSummary) => {
    const params = new URLSearchParams({
      route: String(route.id),
      ride_date: rideDate ?? "",
      ride_time: `${rideTime}:00`.slice(0, 8),
      ride_type: rideType,
    });
    navigate(`/ritten/nieuw?${params.toString()}`);
  };

  if (!ready) {
    return (
      <Center py="xl">
        <Loader color="routeboek" />
      </Center>
    );
  }

  return (
    <Stack gap="lg" maw={960}>
      <Stack gap={2}>
        <Title order={2}>Quick start</Title>
        <Text c="dimmed" size="sm">
          Geef aan wanneer en wat voor rit je wilt rijden. Op basis van de
          verwachte windrichting op dat moment (je fietst het liefst heen
          tegen de wind in) en je eigen favorieten kiezen we 4 routes tussen
          de 50 en 110 km. Zelf geen (genoeg) favorieten die passen? Dan
          vullen we aan met de best beoordeelde routes. Bevalt geen van de 4?
          Blader dan gewoon zelf verder in het routeboek.
        </Text>
      </Stack>

      <Card withBorder radius="md" p="lg">
        <Stack gap="md">
          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
            <DateInput
              label="Datum"
              valueFormat="dddd D MMMM YYYY"
              minDate={todayIso()}
              value={rideDate}
              onChange={setRideDate}
            />
            <TimeInput
              label="Tijd"
              value={rideTime}
              onChange={(event) => setRideTime(event.currentTarget.value)}
            />
            <Select
              label="Type rit"
              data={RIDE_TYPE_OPTIONS}
              allowDeselect={false}
              value={rideType}
              onChange={(value) => setRideType((value ?? "race") as RideType)}
            />
          </SimpleGrid>
          <Group justify="space-between" wrap="wrap">
            <Text size="xs" c="dimmed">
              {windDirection
                ? `Verwachte windrichting op dat moment: ${WIND_LABELS[windDirection]}.`
                : "Windrichting op dat moment nog niet bekend (te ver vooruit of in het verleden)."}
            </Text>
            <Button
              leftSection={<IconSearch size={18} />}
              color="routeboek"
              loading={searching}
              onClick={() => void search()}
            >
              Toon suggesties
            </Button>
          </Group>
        </Stack>
      </Card>

      {searching && routes === null ? (
        <Center py="xl">
          <Loader color="routeboek" />
        </Center>
      ) : routes && routes.length > 0 ? (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
          {routes.map((route) => (
            <RouteCard
              key={route.id}
              route={route}
              footer={
                <Button
                  fullWidth
                  mt={4}
                  color="routeboek"
                  rightSection={<IconArrowRight size={16} />}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    startRide(route);
                  }}
                >
                  Start deze rit
                </Button>
              }
            />
          ))}
        </SimpleGrid>
      ) : (
        routes !== null && (
          <Card withBorder radius="md" p="xl">
            <Stack align="center" gap="xs">
              <Text c="dimmed">
                Geen passende routes gevonden voor dit moment en type rit.
              </Text>
            </Stack>
          </Card>
        )
      )}

      <Group justify="center">
        <Button variant="subtle" color="routeboek" leftSection={<IconBolt size={16} />} component={Link} to="/routes">
          Liever zelf een route kiezen uit het routeboek
        </Button>
      </Group>
    </Stack>
  );
}
