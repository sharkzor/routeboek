import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Center,
  Divider,
  FileInput,
  Group,
  Loader,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { DateInput, TimeInput } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconDeviceFloppy, IconUpload } from "@tabler/icons-react";
import { useNavigate, useParams } from "react-router";

import { ApiError, api } from "../api/client";
import {
  EVENT_TYPE_LABELS,
  type EventInput,
  type EventRouteUpload,
  type EventType,
  type RouteSummary,
} from "../api/types";

const EVENT_TYPE_OPTIONS = (Object.keys(EVENT_TYPE_LABELS) as EventType[]).map((value) => ({
  value,
  label: EVENT_TYPE_LABELS[value],
}));

interface FormValues {
  name: string;
  event_type: EventType;
  // Mantine 9's DateInput werkt met "YYYY-MM-DD"-strings, niet met Date.
  event_date: string | null;
  event_time: string;
  route_id: string;
  url: string;
  cost_eur: number | "";
  distance_km: number | "";
  speed_kmh: number | "";
  max_participants: number;
  notes_html: string;
}

/** Vandaag als "YYYY-MM-DD" in lokale tijd; toISOString() zou een dag kunnen
 *  schuiven door de UTC-conversie. */
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export default function EventFormPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const editing = eventId !== undefined;

  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [gpxFile, setGpxFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<EventRouteUpload | null>(null);
  const [importing, setImporting] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const form = useForm<FormValues>({
    initialValues: {
      name: "",
      event_type: "sportive",
      event_date: null,
      event_time: "",
      route_id: "",
      url: "",
      cost_eur: "",
      distance_km: "",
      speed_kmh: "",
      max_participants: 20,
      notes_html: "",
    },
    validate: {
      name: (value) => (value.trim().length >= 2 ? null : "Geef het event een naam."),
      event_date: (value) => (value ? null : "Kies een datum."),
    },
  });

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const allRoutes = await api.allRoutesForRideForm();
        if (cancelled) return;
        setRoutes(allRoutes);

        if (editing) {
          const event = await api.event(Number(eventId));
          if (cancelled) return;
          form.setValues({
            name: event.name,
            event_type: event.event_type,
            event_date: event.event_date,
            event_time: event.event_time ? event.event_time.slice(0, 5) : "",
            route_id: event.route ? String(event.route.id) : "",
            url: event.url ?? "",
            cost_eur: event.cost_eur ?? "",
            distance_km: event.distance_km ?? "",
            speed_kmh: event.speed_kmh ?? "",
            max_participants: event.max_participants,
            notes_html: event.notes_html,
          });
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
  }, [eventId, editing]);

  const selectedRoute = routes.find((item) => String(item.id) === form.values.route_id);
  const distanceLocked =
    Boolean(selectedRoute && selectedRoute.distance_km !== null) || uploaded !== null;

  /** Leest de GPX met hetzelfde importendpoint als de community-routes en
   *  bewaart het resultaat tot het event wordt opgeslagen. */
  const handleGpx = async (file: File | null) => {
    setGpxFile(file);
    if (!file) {
      setUploaded(null);
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const preview = await api.importCommunityRouteGpx(file);
      const name = preview.name?.trim() || file.name.replace(/\.gpx$/i, "");
      setUploaded({
        name,
        distance_km: preview.distance_km,
        elevation_m: preview.elevation_m,
        coordinates: preview.coordinates,
      });
      form.setFieldValue("route_id", "");
      if (form.values.name.trim() === "") form.setFieldValue("name", name);
      form.setFieldValue("distance_km", Number(preview.distance_km.toFixed(1)));
    } catch (err) {
      setGpxFile(null);
      setUploaded(null);
      setError(err instanceof ApiError ? err.message : "Deze GPX kon niet gelezen worden.");
    } finally {
      setImporting(false);
    }
  };

  const pickRoute = (value: string | null) => {
    const routeId = value ?? "";
    form.setFieldValue("route_id", routeId);
    const route = routes.find((item) => String(item.id) === routeId);
    if (!route) return;
    const currentIsRouteName = routes.some((item) => item.name === form.values.name);
    if (form.values.name.trim() === "" || currentIsRouteName) {
      form.setFieldValue("name", route.name);
    }
    if (route.distance_km !== null) {
      form.setFieldValue("distance_km", route.distance_km);
    }
  };

  const submit = form.onSubmit(async (values) => {
    setBusy(true);
    setError(null);
    try {
      const payload: EventInput = {
        name: values.name.trim(),
        event_type: values.event_type,
        route_id: values.route_id ? Number(values.route_id) : null,
        route_upload: !values.route_id && uploaded ? uploaded : null,
        event_date: values.event_date as string,
        event_time: values.event_time ? `${values.event_time}:00`.slice(0, 8) : null,
        url: values.url.trim() || null,
        cost_eur: values.cost_eur === "" ? null : Number(values.cost_eur),
        distance_km: values.distance_km === "" ? null : Number(values.distance_km),
        speed_kmh: values.speed_kmh === "" ? null : Number(values.speed_kmh),
        max_participants: Number(values.max_participants),
        notes_html: values.notes_html,
      };
      if (editing) {
        await api.updateEvent(Number(eventId), payload);
        notifications.show({ message: "Het event is bijgewerkt.", color: "green" });
      } else {
        await api.createEvent(payload);
        notifications.show({ message: "Het event staat gepland.", color: "green" });
      }
      navigate("/events");
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
      <Title order={2}>{editing ? "Event bewerken" : "Nieuw event"}</Title>

      <Card withBorder radius="md" p="lg">
        <form onSubmit={submit}>
          <Stack gap="md">
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}

            <TextInput label="Naam" required {...form.getInputProps("name")} />

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <Select
                label="Type event"
                data={EVENT_TYPE_OPTIONS}
                allowDeselect={false}
                value={form.values.event_type}
                onChange={(value) =>
                  form.setFieldValue("event_type", (value ?? "sportive") as EventType)
                }
              />
              <TextInput
                label="Link naar eventpagina"
                placeholder="https://…"
                {...form.getInputProps("url")}
              />
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <DateInput
                label="Datum"
                valueFormat="dddd D MMMM YYYY"
                minDate={todayIso()}
                required
                {...form.getInputProps("event_date")}
              />
              <TimeInput
                label="Tijd"
                description="Optioneel; laat leeg als die nog niet bekend is"
                {...form.getInputProps("event_time")}
              />
            </SimpleGrid>

            <Stack gap="xs">
              <Text size="sm" fw={600}>
                Parcours (optioneel)
              </Text>
              <FileInput
                label="GPX-bestand"
                description="Meestal het snelst: download de GPX bij het event en upload 'm hier."
                placeholder={uploaded ? uploaded.name : "Kies een .gpx-bestand"}
                accept=".gpx,application/gpx+xml"
                clearable
                disabled={Boolean(form.values.route_id)}
                value={gpxFile}
                onChange={(file) => void handleGpx(file)}
                leftSection={<IconUpload size={16} />}
              />
              {importing && (
                <Text size="xs" c="dimmed">
                  GPX inlezen…
                </Text>
              )}
              {uploaded && (
                <Text size="xs" c="teal.7">
                  {uploaded.name} · {uploaded.distance_km?.toFixed(1) ?? "?"} km ·{" "}
                  {uploaded.elevation_m !== null
                    ? `${Math.round(uploaded.elevation_m)} hm`
                    : "? hm"}
                </Text>
              )}

              <Divider label="of kies een bestaande route" labelPosition="center" my={4} />

              <Select
                label="Route uit het routeboek"
                description="Handig bij een clubrit; anders is de GPX-upload hierboven eenvoudiger."
                placeholder="Kies een route"
                searchable
                clearable
                disabled={Boolean(uploaded)}
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
            </Stack>

            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
              <NumberInput
                label="Afstand"
                description={
                  distanceLocked ? "Volgt automatisch uit de gekozen route" : undefined
                }
                suffix=" km"
                min={0}
                max={2000}
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
              <NumberInput
                label="Kosten"
                prefix="€ "
                min={0}
                max={10000}
                decimalScale={2}
                {...form.getInputProps("cost_eur")}
              />
            </SimpleGrid>

            <NumberInput
              label="Maximum aantal deelnemers"
              min={2}
              max={200}
              w={{ base: "100%", sm: 220 }}
              {...form.getInputProps("max_participants")}
            />

            <Textarea
              label="Opmerkingen"
              placeholder="Bijvoorbeeld: overnachting geregeld, inschrijven kan tot…"
              autosize
              minRows={3}
              {...form.getInputProps("notes_html")}
            />

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
                {editing ? "Wijzigingen opslaan" : "Event aanmaken"}
              </Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
