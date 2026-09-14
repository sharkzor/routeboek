/**
 * Melding van werkzaamheden of een bijzonderheid aanmaken of bewerken.
 *
 * Een melding hangt altijd aan minstens één route; zonder route zou hij
 * nergens opduiken waar hij ertoe doet.
 */
import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Center,
  Group,
  Loader,
  MultiSelect,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconDeviceFloppy } from "@tabler/icons-react";
import { useNavigate, useParams } from "react-router";

import { ApiError, api } from "../api/client";
import {
  NOTICE_KIND_LABELS,
  type NoticeInput,
  type NoticeKind,
  type RouteSummary,
} from "../api/types";

const KIND_OPTIONS = (Object.keys(NOTICE_KIND_LABELS) as NoticeKind[]).map((value) => ({
  value,
  label: NOTICE_KIND_LABELS[value],
}));

const KIND_HINTS: Record<NoticeKind, string> = {
  works: "Wegwerkzaamheden, opgebroken straat of een omleiding.",
  hazard: "Gevaarlijke situatie: losse stenen, kapot wegdek, gevaarlijk kruispunt.",
  info: "Overige bijzonderheid, zoals een evenement of een tijdelijk gestremde brug.",
};

/** Vandaag als "YYYY-MM-DD" in lokale tijd; toISOString() kan een dag schuiven. */
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

interface FormValues {
  kind: NoticeKind;
  title: string;
  description: string;
  // Mantine 9's DateInput werkt met "YYYY-MM-DD"-strings, niet met Date.
  start_date: string | null;
  end_date: string | null;
  route_ids: string[];
}

export default function NoticeFormPage() {
  const { noticeId } = useParams();
  const navigate = useNavigate();
  const editing = noticeId !== undefined;

  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const form = useForm<FormValues>({
    initialValues: {
      kind: "works",
      title: "",
      description: "",
      start_date: todayIso(),
      end_date: null,
      route_ids: [],
    },
    validate: {
      title: (value) =>
        value.trim().length >= 3 ? null : "Geef de melding een korte titel.",
      end_date: (value) => (value ? null : "Kies tot wanneer de melding geldt."),
      route_ids: (value) =>
        value.length > 0 ? null : "Kies minstens één route waar dit op slaat.",
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
          const notice = await api.notice(Number(noticeId));
          if (cancelled) return;
          form.setValues({
            kind: notice.kind,
            title: notice.title,
            description: notice.description,
            start_date: notice.start_date,
            end_date: notice.end_date,
            route_ids: notice.routes.map((r) => String(r.id)),
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
  }, [noticeId]);

  const submit = form.onSubmit(async (values) => {
    setBusy(true);
    try {
      // Payload binnen de try opbouwen: een fout hierin moet in catch landen
      // en niet stilletjes de knop laten draaien.
      const payload: NoticeInput = {
        kind: values.kind,
        title: values.title.trim(),
        description: values.description.trim(),
        start_date: values.start_date,
        end_date: values.end_date!,
        route_ids: values.route_ids.map(Number),
      };
      if (editing) {
        await api.updateNotice(Number(noticeId), payload);
        notifications.show({ message: "De melding is bijgewerkt.", color: "green" });
      } else {
        await api.createNotice(payload);
        notifications.show({ message: "De melding is geplaatst.", color: "green" });
      }
      navigate("/werkzaamheden");
    } catch (err) {
      notifications.show({
        message: err instanceof ApiError ? err.message : "Opslaan is mislukt.",
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  });

  if (!ready) {
    return (
      <Center h={240}>
        <Loader color="routeboek" />
      </Center>
    );
  }

  const routeOptions = routes.map((route) => ({
    value: String(route.id),
    label:
      route.distance_km !== null
        ? `${route.name} · ${route.distance_km.toFixed(0)} km`
        : route.name,
  }));

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>{editing ? "Melding bewerken" : "Melding toevoegen"}</Title>
        <Text c="dimmed" size="sm" mt={4}>
          Laat je clubgenoten weten wat er tijdelijk aan de hand is op een route. De melding
          verdwijnt automatisch zodra de einddatum voorbij is.
        </Text>
      </div>

      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      <Card radius="md" withBorder p="lg">
        <form onSubmit={submit}>
          <Stack gap="md">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <Select
                label="Soort melding"
                data={KIND_OPTIONS}
                description={KIND_HINTS[form.values.kind]}
                allowDeselect={false}
                {...form.getInputProps("kind")}
              />
              <TextInput
                label="Titel"
                placeholder="Bijv. Brug bij Lienden afgesloten"
                required
                {...form.getInputProps("title")}
              />
            </SimpleGrid>

            <Textarea
              label="Toelichting"
              description="Optioneel: waar precies, en is er een omleiding?"
              placeholder="Wat moeten je clubgenoten weten?"
              minRows={3}
              autosize
              {...form.getInputProps("description")}
            />

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <DateInput
                label="Vanaf"
                description="Standaard vandaag"
                valueFormat="dddd D MMMM YYYY"
                clearable
                {...form.getInputProps("start_date")}
              />
              <DateInput
                label="Tot en met"
                description="Hierna verdwijnt de melding vanzelf"
                valueFormat="dddd D MMMM YYYY"
                minDate={form.values.start_date ?? todayIso()}
                required
                {...form.getInputProps("end_date")}
              />
            </SimpleGrid>

            <MultiSelect
              label="Routes"
              description="Op welke routes is dit van toepassing? Meerdere mag."
              data={routeOptions}
              placeholder={form.values.route_ids.length ? undefined : "Kies een of meer routes"}
              searchable
              clearable
              required
              {...form.getInputProps("route_ids")}
            />

            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={() => navigate("/werkzaamheden")}>
                Annuleren
              </Button>
              <Button
                type="submit"
                color="routeboek"
                loading={busy}
                leftSection={<IconDeviceFloppy size={18} />}
              >
                {editing ? "Wijzigingen opslaan" : "Melding plaatsen"}
              </Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
