import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Center,
  Group,
  Loader,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { DateInput, TimeInput } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconBrandTelegram, IconDeviceFloppy } from "@tabler/icons-react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  RIDE_TYPE_LABELS,
  type RideInput,
  type RideType,
  type RouteSummary,
  type RouteType,
  type UserSummary,
} from "../api/types";

const PARTICIPANT_OPTIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => ({
  value: String(n),
  label: `${n} deelnemers`,
}));

const RIDE_TYPE_OPTIONS = (Object.keys(RIDE_TYPE_LABELS) as RideType[]).map((value) => ({
  value,
  label: RIDE_TYPE_LABELS[value],
}));

// Route- en rittype delen dezelfde onderliggende indeling (weg/weg met
// gravel/gravel), dus het kiezen van een route mag het rittype meteen
// voorinvullen.
const RIDE_TYPE_FROM_ROUTE_TYPE: Record<RouteType, RideType> = {
  road: "race",
  road_gravel: "race_gravel",
  gravel: "gravel",
};

interface FormValues {
  name: string;
  owner_id: string;
  // Mantine 9's DateInput werkt met "YYYY-MM-DD"-strings, niet met Date.
  ride_date: string | null;
  ride_time: string;
  route_id: string;
  ride_type: RideType;
  distance_km: number | "";
  speed_kmh: number | "";
  max_participants: string;
  notes_html: string;
  is_private: boolean;
  post_to_telegram: boolean;
}

/** Vandaag als "YYYY-MM-DD" in lokale tijd; toISOString() zou een dag kunnen
 *  schuiven door de UTC-conversie. */
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export default function RideFormPage() {
  const { rideId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const editing = rideId !== undefined;

  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [members, setMembers] = useState<UserSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [defaultsLabel, setDefaultsLabel] = useState<string | null>(null);

  const form = useForm<FormValues>({
    initialValues: {
      name: "",
      owner_id: "",
      ride_date: null,
      ride_time: "19:00",
      route_id: params.get("route") ?? "",
      ride_type: "race",
      distance_km: "",
      speed_kmh: "",
      max_participants: "10",
      notes_html: "",
      is_private: false,
      post_to_telegram: true,
    },
    validate: {
      name: (value) => (value.trim().length >= 2 ? null : "Geef de rit een naam."),
      ride_date: (value) => (value ? null : "Kies een datum."),
      ride_time: (value) => (/^\d{2}:\d{2}/.test(value) ? null : "Kies een tijd."),
    },
  });

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const [allRoutes, memberList] = await Promise.all([
          api.allRoutesForRideForm(),
          api.members(),
        ]);
        if (cancelled) return;
        setRoutes(allRoutes);
        setMembers(memberList);

        if (editing) {
          const ride = await api.ride(Number(rideId));
          if (cancelled) return;
          form.setValues({
            name: ride.name,
            owner_id: String(ride.owner.id),
            ride_date: ride.ride_date,
            ride_time: ride.ride_time.slice(0, 5),
            route_id: ride.route ? String(ride.route.id) : "",
            ride_type: ride.ride_type,
            distance_km: ride.distance_km ?? "",
            speed_kmh: ride.speed_kmh ?? "",
            max_participants: String(ride.max_participants),
            notes_html: ride.notes_html,
            is_private: ride.is_private,
          });
        } else {
          const defaults = await api.rideDefaults();
          if (cancelled) return;
          setDefaultsLabel(defaults.label);
          form.setValues({
            owner_id: user ? String(user.id) : "",
            ride_date: defaults.ride_date,
            ride_time: defaults.ride_time.slice(0, 5),
          });
          // Naam en afstand volgen standaard de gekozen route.
          const preset = params.get("route");
          if (preset) {
            const route = allRoutes.find((item) => String(item.id) === preset);
            if (route) {
              form.setValues({
                name: route.name,
                distance_km: route.distance_km ?? "",
              });
            }
          }
        }
        form.resetDirty();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId, editing]);

  const selectedRoute = routes.find((item) => String(item.id) === form.values.route_id);
  const distanceLocked = Boolean(selectedRoute && selectedRoute.distance_km !== null);

  const pickRoute = (value: string | null) => {
    const routeId = value ?? "";
    form.setFieldValue("route_id", routeId);
    const route = routes.find((item) => String(item.id) === routeId);
    if (!route) return;
    // De routenaam is de standaardnaam van de rit, tenzij er al iets eigens staat.
    const currentIsRouteName = routes.some((item) => item.name === form.values.name);
    if (form.values.name.trim() === "" || currentIsRouteName) {
      form.setFieldValue("name", route.name);
    }
    // De afstand van een rit volgt de vaste afstand van de route; die is dus
    // niet los instelbaar zolang er een route met bekende afstand is gekozen.
    if (route.distance_km !== null) {
      form.setFieldValue("distance_km", route.distance_km);
    }
    // Rittype volgt het routetype (weg/weg met gravel/gravel), zodat je dit
    // niet dubbel hoeft in te stellen.
    form.setFieldValue("ride_type", RIDE_TYPE_FROM_ROUTE_TYPE[route.route_type]);
  };

  const submit = form.onSubmit(async (values) => {
    setBusy(true);
    setError(null);
    try {
      const payload: RideInput = {
        name: values.name.trim(),
        owner_id: values.owner_id ? Number(values.owner_id) : null,
        ride_date: values.ride_date as string,
        ride_time: `${values.ride_time}:00`.slice(0, 8),
        route_id: values.route_id ? Number(values.route_id) : null,
        ride_type: values.ride_type,
        distance_km: values.distance_km === "" ? null : Number(values.distance_km),
        speed_kmh: values.speed_kmh === "" ? null : Number(values.speed_kmh),
        max_participants: Number(values.max_participants),
        notes_html: values.notes_html,
        is_private: values.is_private,
        post_to_telegram: values.post_to_telegram,
      };
      if (editing) {
        await api.updateRide(Number(rideId), payload);
        notifications.show({ message: "De rit is bijgewerkt.", color: "green" });
      } else {
        await api.createRide(payload);
        notifications.show({ message: "De rit staat gepland.", color: "green" });
      }
      navigate("/ritten");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Opslaan is mislukt.");
    } finally {
      setBusy(false);
    }
  });

  if (!ready) {
    return (
      <Center py="xl">
        <Loader color="routeboek" />
      </Center>
    );
  }

  return (
    <Stack gap="lg" maw={820}>
      <Stack gap={2}>
        <Title order={2}>{editing ? "Rit bewerken" : "Nieuwe rit"}</Title>
        {!editing && defaultsLabel && (
          <Text c="dimmed" size="sm">
            Standaard ingevuld op het eerstvolgende clubmoment ({defaultsLabel}).
          </Text>
        )}
      </Stack>

      <Card withBorder radius="md" p="lg">
        <form onSubmit={submit}>
          <Stack gap="md">
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}

            <Select
              label="Route"
              placeholder="Kies een route uit het routeboek"
              searchable
              clearable
              nothingFoundMessage="Geen route gevonden"
              data={routes.map((route) => ({
                value: String(route.id),
                label:
                  route.distance_km !== null
                    ? `${route.name} (${route.distance_km.toFixed(0)} km)${route.origin === "community" ? " · Community" : ""}`
                    : `${route.name}${route.origin === "community" ? " · Community" : ""}`,
              }))}
              value={form.values.route_id || null}
              onChange={pickRoute}
            />

            <TextInput
              label="Naam"
              description="Standaard de naam van de route"
              required
              {...form.getInputProps("name")}
            />

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <Select
                label="Eigenaar"
                description="De wegkapitein van deze rit"
                searchable
                data={members.map((member) => ({
                  value: String(member.id),
                  label: member.display_name,
                }))}
                value={form.values.owner_id || null}
                onChange={(value) => form.setFieldValue("owner_id", value ?? "")}
              />
              <Select
                label="Type rit"
                data={RIDE_TYPE_OPTIONS}
                allowDeselect={false}
                value={form.values.ride_type}
                onChange={(value) =>
                  form.setFieldValue("ride_type", (value ?? "race") as RideType)
                }
              />
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <DateInput
                label="Datum"
                valueFormat="dddd D MMMM YYYY"
                minDate={todayIso()}
                required
                {...form.getInputProps("ride_date")}
              />
              <TimeInput label="Tijd" required {...form.getInputProps("ride_time")} />
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
              <NumberInput
                label="Afstand"
                description={
                  distanceLocked ? "Volgt automatisch uit de gekozen route" : undefined
                }
                suffix=" km"
                min={0}
                max={1000}
                decimalScale={1}
                disabled={distanceLocked}
                {...form.getInputProps("distance_km")}
              />
              <NumberInput
                label="Snelheid"
                suffix=" km/u"
                min={0}
                max={60}
                decimalScale={1}
                {...form.getInputProps("speed_kmh")}
              />
              <Select
                label="Deelnemers"
                data={PARTICIPANT_OPTIONS}
                allowDeselect={false}
                value={form.values.max_participants}
                onChange={(value) =>
                  form.setFieldValue("max_participants", value ?? "10")
                }
              />
            </SimpleGrid>

            <Textarea
              label="Opmerkingen"
              placeholder="Bijvoorbeeld: koffiestop halverwege, verzamelen bij de kerk."
              autosize
              minRows={3}
              {...form.getInputProps("notes_html")}
            />

            <Switch
              label="Privé rit"
              description="Deze rit staat niet in het standaardoverzicht"
              color="routeboek"
              {...form.getInputProps("is_private", { type: "checkbox" })}
            />

            {!editing && !form.values.is_private && (
              <Switch
                label="Delen in Telegram-kanaal"
                description="Post deze rit meteen in het clubkanaal"
                color="routeboek"
                thumbIcon={<IconBrandTelegram size={12} />}
                {...form.getInputProps("post_to_telegram", { type: "checkbox" })}
              />
            )}

            <Group justify="flex-end" mt="sm">
              <Button variant="subtle" color="gray" onClick={() => navigate(-1)}>
                Annuleren
              </Button>
              <Button
                type="submit"
                color="routeboek"
                loading={busy}
                leftSection={<IconDeviceFloppy size={18} />}
              >
                {editing ? "Wijzigingen opslaan" : "Rit aanmaken"}
              </Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
