import { useCallback, useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Checkbox,
  FileInput,
  Group,
  Loader,
  Modal,
  Progress,
  MultiSelect,
  Select,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconMap,
  IconMapPin,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
  IconRefresh,
  IconUpload,
  IconUsers,
} from "@tabler/icons-react";

import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  CATEGORY_LABELS,
  ROUTE_TYPE_LABELS,
  WIND_LABELS,
  type CategoryCode,
  type OsmMapStatus,
  type RouteSummary,
  type RouteType,
  type User,
  type WindCode,
} from "../api/types";

export default function AdminPage() {
  return (
    <Stack gap="lg">
      <Title order={2}>Beheer</Title>
      <Tabs defaultValue="routes" color="routeboek">
        <Tabs.List mb="md">
          <Tabs.Tab value="routes" leftSection={<IconMap size={16} />}>
            Routes
          </Tabs.Tab>
          <Tabs.Tab value="users" leftSection={<IconUsers size={16} />}>
            Gebruikers
          </Tabs.Tab>
          <Tabs.Tab value="map" leftSection={<IconMapPin size={16} />}>
            Wegenkaart
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="routes">
          <RoutesTab />
        </Tabs.Panel>
        <Tabs.Panel value="users">
          <UsersTab />
        </Tabs.Panel>
        <Tabs.Panel value="map">
          <MapTab />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

// ------------------------------------------------------------------- routes

function RoutesTab() {
  const [routes, setRoutes] = useState<RouteSummary[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [addOpened, addDialog] = useDisclosure(false);
  const [pending, setPending] = useState<RouteSummary | null>(null);
  const [hardDelete, setHardDelete] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const load = useCallback(async (term: string) => {
    setRoutes(null);
    try {
      setRoutes(await api.adminRoutes(term || undefined));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Routes laden is mislukt.");
    }
  }, []);

  useEffect(() => {
    void load(search);
  }, [load, search]);

  const remove = async () => {
    if (!pending) return;
    try {
      const response = await api.adminDeleteRoute(pending.id, hardDelete);
      notifications.show({ message: response.detail, color: "green" });
      setPending(null);
      setHardDelete(false);
      void load(search);
    } catch (err) {
      notifications.show({
        message: err instanceof ApiError ? err.message : "Verwijderen is mislukt.",
        color: "red",
      });
    }
  };

  const restore = async (route: RouteSummary) => {
    try {
      await api.adminUpdateRoute(route.id, { is_active: true });
      notifications.show({ message: `'${route.name}' staat weer in het overzicht.`, color: "green" });
      void load(search);
    } catch (err) {
      notifications.show({
        message: err instanceof ApiError ? err.message : "Terugzetten is mislukt.",
        color: "red",
      });
    }
  };

  const promote = async (route: RouteSummary) => {
    try {
      await api.adminPromoteRoute(route.id);
      notifications.show({ message: `'${route.name}' is gepromoveerd naar het routeboek.`, color: "green" });
      void load(search);
    } catch (err) {
      notifications.show({
        message: err instanceof ApiError ? err.message : "Promoveren is mislukt.",
        color: "red",
      });
    }
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <TextInput
          placeholder="Zoek op naam"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          w={280}
        />
        <Button leftSection={<IconPlus size={18} />} color="routeboek" onClick={addDialog.open}>
          Route toevoegen
        </Button>
      </Group>

      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      {routes === null ? (
        <Center py="xl">
          <Loader color="routeboek" />
        </Center>
      ) : (
        <Card withBorder radius="md" p={0}>
          <Table.ScrollContainer minWidth={720}>
            <Table striped highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Naam</Table.Th>
                  <Table.Th>Afstand</Table.Th>
                  <Table.Th>Soort</Table.Th>
                  <Table.Th>Wind</Table.Th>
                  <Table.Th>Herkomst</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {routes.map((route) => (
                  <Table.Tr key={route.id}>
                    <Table.Td>{route.name}</Table.Td>
                    <Table.Td>
                      {route.distance_km !== null ? `${route.distance_km.toFixed(1)} km` : "–"}
                    </Table.Td>
                    <Table.Td>{ROUTE_TYPE_LABELS[route.route_type]}</Table.Td>
                    <Table.Td>
                      {route.wind_directions.join(", ") || "–"}
                      {route.wind_estimated && route.wind_directions.length > 0 && (
                        <Text span size="xs" c="dimmed">
                          {" "}
                          (geschat)
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {route.origin === "community" ? (
                        <Badge color="grape" variant="light" title={route.submitted_by ?? undefined}>
                          Community {route.upvote_count > 0 ? `· ${route.upvote_count} stemmen` : ""}
                        </Badge>
                      ) : (
                        <Badge color="routeboek" variant="light">
                          Officieel
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {route.is_active ? (
                        <Badge color="green" variant="light">
                          Zichtbaar
                        </Badge>
                      ) : (
                        <Badge color="gray" variant="light">
                          Verborgen
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        {route.origin === "community" && (
                          <Button
                            size="compact-xs"
                            variant="light"
                            color="grape"
                            onClick={() => void promote(route)}
                          >
                            Promoveren
                          </Button>
                        )}
                        {!route.is_active && (
                          <Button
                            size="compact-xs"
                            variant="light"
                            color="green"
                            onClick={() => void restore(route)}
                          >
                            Terugzetten
                          </Button>
                        )}
                        <Tooltip label="Bewerken">
                          <ActionIcon
                            variant="subtle"
                            color="routeboek"
                            onClick={() => setEditingId(route.id)}
                            aria-label={`Bewerk ${route.name}`}
                          >
                            <IconPencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Verwijderen">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            onClick={() => setPending(route)}
                            aria-label={`Verwijder ${route.name}`}
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}

      <AddRouteModal
        opened={addOpened}
        onClose={addDialog.close}
        onCreated={() => {
          addDialog.close();
          void load(search);
        }}
      />

      <EditRouteModal
        routeId={editingId}
        onClose={() => setEditingId(null)}
        onSaved={() => {
          setEditingId(null);
          void load(search);
        }}
      />

      <Modal
        opened={pending !== null}
        onClose={() => setPending(null)}
        title="Route verwijderen"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Weet je zeker dat je <strong>{pending?.name}</strong> wilt verwijderen?
          </Text>
          <Checkbox
            label="Definitief verwijderen (inclusief GPX, TCX en kaart)"
            description="Zonder vinkje wordt de route alleen uit het overzicht gehaald."
            color="red"
            checked={hardDelete}
            onChange={(event) => setHardDelete(event.currentTarget.checked)}
          />
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={() => setPending(null)}>
              Annuleren
            </Button>
            <Button color="red" onClick={() => void remove()}>
              Verwijderen
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

function AddRouteModal({
  opened,
  onClose,
  onCreated,
}: {
  opened: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [routeType, setRouteType] = useState<RouteType>("road");
  const [wind, setWind] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [strava, setStrava] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!file || name.trim().length < 2) {
      setError("Kies een GPX-bestand en vul een naam in.");
      return;
    }
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("gpx", file);
    form.append("name", name.trim());
    form.append("description_html", description);
    form.append("route_type", routeType);
    form.append("wind_directions", wind.join(","));
    form.append("categories", categories.join(","));
    form.append("strava_url", strava.trim());
    try {
      const route = await api.adminCreateRoute(form);
      notifications.show({ message: `'${route.name}' is toegevoegd.`, color: "green" });
      setFile(null);
      setName("");
      setDescription("");
      setWind([]);
      setCategories([]);
      setStrava("");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Toevoegen is mislukt.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Route toevoegen" size="lg" centered>
      <Stack gap="md">
        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}
        <FileInput
          label="GPX-bestand"
          placeholder="Kies een .gpx bestand"
          accept=".gpx,application/gpx+xml"
          leftSection={<IconUpload size={16} />}
          value={file}
          onChange={(next) => {
            setFile(next);
            if (next && name === "") setName(next.name.replace(/\.gpx$/i, ""));
          }}
          required
        />
        <TextInput
          label="Naam"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          required
        />
        <Textarea
          label="Beschrijving"
          autosize
          minRows={3}
          value={description}
          onChange={(event) => setDescription(event.currentTarget.value)}
        />
        <Select
          label="Soort route"
          data={(Object.keys(ROUTE_TYPE_LABELS) as RouteType[]).map((value) => ({
            value,
            label: ROUTE_TYPE_LABELS[value],
          }))}
          value={routeType}
          allowDeselect={false}
          onChange={(value) => setRouteType((value ?? "road") as RouteType)}
        />
        <MultiSelect
          label="Windrichtingen"
          description="Bij welke wind is deze route fijn?"
          data={(Object.keys(WIND_LABELS) as WindCode[]).map((value) => ({
            value,
            label: WIND_LABELS[value],
          }))}
          value={wind}
          onChange={setWind}
        />
        <MultiSelect
          label="Aanbevolen voor"
          data={(Object.keys(CATEGORY_LABELS) as CategoryCode[]).map((value) => ({
            value,
            label: CATEGORY_LABELS[value],
          }))}
          value={categories}
          onChange={setCategories}
        />
        <TextInput
          label="Strava-link"
          placeholder="https://www.strava.com/routes/..."
          value={strava}
          onChange={(event) => setStrava(event.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button variant="subtle" color="gray" onClick={onClose}>
            Annuleren
          </Button>
          <Button color="routeboek" loading={busy} onClick={() => void submit()}>
            Route toevoegen
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function EditRouteModal({
  routeId,
  onClose,
  onSaved,
}: {
  routeId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [routeType, setRouteType] = useState<RouteType>("road");
  const [wind, setWind] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [strava, setStrava] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (routeId === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .adminRoute(routeId)
      .then((route) => {
        if (cancelled) return;
        setName(route.name);
        setDescription(route.description_html);
        setRouteType(route.route_type);
        setWind(route.wind_directions);
        setCategories(route.categories);
        setStrava(route.strava_url ?? "");
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Route laden is mislukt.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [routeId]);

  const submit = async () => {
    if (routeId === null || name.trim().length < 2) {
      setError("Vul een naam in.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const route = await api.adminUpdateRoute(routeId, {
        name: name.trim(),
        description_html: description,
        route_type: routeType,
        wind_directions: wind,
        categories,
        strava_url: strava.trim() || null,
      });
      notifications.show({ message: `'${route.name}' is bijgewerkt.`, color: "green" });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Opslaan is mislukt.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={routeId !== null} onClose={onClose} title="Route bewerken" size="lg" centered>
      {loading ? (
        <Center py="xl">
          <Loader color="routeboek" />
        </Center>
      ) : (
        <Stack gap="md">
          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}
          <TextInput
            label="Naam"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            required
          />
          <Textarea
            label="Beschrijving"
            autosize
            minRows={3}
            value={description}
            onChange={(event) => setDescription(event.currentTarget.value)}
          />
          <Select
            label="Soort route"
            data={(Object.keys(ROUTE_TYPE_LABELS) as RouteType[]).map((value) => ({
              value,
              label: ROUTE_TYPE_LABELS[value],
            }))}
            value={routeType}
            allowDeselect={false}
            onChange={(value) => setRouteType((value ?? "road") as RouteType)}
          />
          <MultiSelect
            label="Windrichtingen"
            description="Bij welke wind is deze route fijn?"
            data={(Object.keys(WIND_LABELS) as WindCode[]).map((value) => ({
              value,
              label: WIND_LABELS[value],
            }))}
            value={wind}
            onChange={setWind}
          />
          <MultiSelect
            label="Aanbevolen voor"
            data={(Object.keys(CATEGORY_LABELS) as CategoryCode[]).map((value) => ({
              value,
              label: CATEGORY_LABELS[value],
            }))}
            value={categories}
            onChange={setCategories}
          />
          <TextInput
            label="Strava-link"
            placeholder="https://www.strava.com/routes/..."
            value={strava}
            onChange={(event) => setStrava(event.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={onClose}>
              Annuleren
            </Button>
            <Button color="routeboek" loading={busy} onClick={() => void submit()}>
              Wijzigingen opslaan
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

// --------------------------------------------------------------- gebruikers

function UsersTab() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<User | null>(null);

  const load = useCallback(async (term: string) => {
    setUsers(null);
    try {
      setUsers(await api.adminUsers(term || undefined));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gebruikers laden is mislukt.");
    }
  }, []);

  useEffect(() => {
    void load(search);
  }, [load, search]);

  const patch = async (target: User, payload: Record<string, unknown>) => {
    try {
      const updated = await api.adminUpdateUser(target.id, payload);
      setUsers((current) =>
        current ? current.map((item) => (item.id === updated.id ? updated : item)) : current,
      );
    } catch (err) {
      notifications.show({
        message: err instanceof ApiError ? err.message : "Aanpassen is mislukt.",
        color: "red",
      });
      void load(search);
    }
  };

  const remove = async () => {
    if (!pending) return;
    try {
      const response = await api.adminDeleteUser(pending.id);
      notifications.show({ message: response.detail, color: "green" });
      setPending(null);
      void load(search);
    } catch (err) {
      notifications.show({
        message: err instanceof ApiError ? err.message : "Verwijderen is mislukt.",
        color: "red",
      });
    }
  };

  return (
    <Stack gap="md">
      <TextInput
        placeholder="Zoek op naam of e-mail"
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
        w={320}
      />

      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      {users === null ? (
        <Center py="xl">
          <Loader color="routeboek" />
        </Center>
      ) : (
        <Card withBorder radius="md" p={0}>
          <Table.ScrollContainer minWidth={760}>
            <Table striped highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Naam</Table.Th>
                  <Table.Th>E-mail</Table.Th>
                  <Table.Th>Bevestigd</Table.Th>
                  <Table.Th>Actief</Table.Th>
                  <Table.Th>Beheerder</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {users.map((item) => (
                  <Table.Tr key={item.id}>
                    <Table.Td>{item.display_name}</Table.Td>
                    <Table.Td>{item.email}</Table.Td>
                    <Table.Td>
                      {item.email_verified_at ? (
                        <Badge color="green" variant="light">
                          Ja
                        </Badge>
                      ) : (
                        <Button
                          size="compact-xs"
                          variant="light"
                          color="routeboek"
                          onClick={() => void patch(item, { verify_email: true })}
                        >
                          Handmatig bevestigen
                        </Button>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Switch
                        checked={item.is_active}
                        color="routeboek"
                        disabled={item.id === me?.id}
                        onChange={(event) =>
                          void patch(item, { is_active: event.currentTarget.checked })
                        }
                        aria-label="Actief"
                      />
                    </Table.Td>
                    <Table.Td>
                      <Switch
                        checked={item.is_admin}
                        color="routeboek"
                        disabled={item.id === me?.id}
                        onChange={(event) =>
                          void patch(item, { is_admin: event.currentTarget.checked })
                        }
                        aria-label="Beheerder"
                      />
                    </Table.Td>
                    <Table.Td>
                      <Group justify="flex-end">
                        <Tooltip label="Verwijderen">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            disabled={item.id === me?.id}
                            onClick={() => setPending(item)}
                            aria-label={`Verwijder ${item.display_name}`}
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}

      <Modal
        opened={pending !== null}
        onClose={() => setPending(null)}
        title="Gebruiker verwijderen"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Weet je zeker dat je <strong>{pending?.display_name}</strong> wilt verwijderen? De
            ritten van deze gebruiker verdwijnen ook.
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={() => setPending(null)}>
              Annuleren
            </Button>
            <Button color="red" onClick={() => void remove()}>
              Verwijderen
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

// -------------------------------------------------------------- wegenkaart

/**
 * De routecontrole ("mag ik hier fietsen?") werkt op een lokale kopie van de
 * Nederlandse wegenkaart uit OpenStreetMap. Die haalt de server normaal
 * vanzelf maandelijks op; hier is te zien hoe oud hij is en kan een beheerder
 * hem meteen bijwerken.
 */
function MapTab() {
  const [state, setState] = useState<OsmMapStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await api.mapStatus());
    } catch {
      // Een mislukte statusopvraging is niet de moeite van een melding waard;
      // de volgende poging komt vanzelf.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Tijdens het bijwerken elke twee seconden de voortgang ophalen.
  const running = state?.job_status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [running, load]);

  const refresh = async () => {
    setBusy(true);
    try {
      setState(await api.refreshMap());
    } catch (error) {
      notifications.show({
        color: "red",
        message:
          error instanceof ApiError ? error.message : "Bijwerken is niet gelukt.",
      });
    } finally {
      setBusy(false);
    }
  };

  if (state === null) {
    return (
      <Center py="xl">
        <Loader color="routeboek" />
      </Center>
    );
  }

  const age =
    state.age_days === null
      ? null
      : state.age_days < 1
        ? "vandaag opgehaald"
        : `${Math.round(state.age_days)} dagen oud`;

  return (
    <Stack gap="md" maw={640}>
      <Card withBorder radius="md" padding="lg">
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start">
            <div>
              <Title order={4}>Wegenkaart van Nederland</Title>
              <Text size="sm" c="dimmed">
                Wordt gebruikt om routes te controleren op paden waar fietsen
                niet mag.
              </Text>
            </div>
            {state.available ? (
              <Badge color={state.stale ? "orange" : "teal"} variant="light">
                {state.stale ? "Verouderd" : "Actueel"}
              </Badge>
            ) : (
              <Badge color="red" variant="light">
                Ontbreekt
              </Badge>
            )}
          </Group>

          {state.available ? (
            <Group gap="xl">
              <div>
                <Text size="xs" c="dimmed">
                  Wegen
                </Text>
                <Text fw={600}>{state.way_count.toLocaleString("nl-NL")}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">
                  Omvang
                </Text>
                <Text fw={600}>{Math.round(state.size_mb)} MB</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">
                  Leeftijd
                </Text>
                <Text fw={600}>{age ?? "onbekend"}</Text>
              </div>
            </Group>
          ) : (
            <Alert color="orange" variant="light">
              De kaart is nog niet opgehaald. Tot die tijd kan een route niet
              op verboden paden worden gecontroleerd.
            </Alert>
          )}

          {running && (
            <Stack gap={6}>
              <Text size="sm">{state.job_message ?? "Bezig..."}</Text>
              <Progress
                value={state.job_progress >= 0 ? state.job_progress * 100 : 100}
                animated
                striped={state.job_progress < 0}
                color="routeboek"
              />
            </Stack>
          )}

          {state.job_status === "error" && (
            <Alert color="red" variant="light">
              Het bijwerken is mislukt: {state.job_error ?? "onbekende fout"}
            </Alert>
          )}

          {state.job_status === "done" && !running && (
            <Alert color="teal" variant="light">
              De kaart is bijgewerkt.
            </Alert>
          )}

          <Group>
            <Button
              leftSection={<IconRefresh size={16} />}
              onClick={() => void refresh()}
              loading={busy || running}
              variant="light"
            >
              Kaart bijwerken
            </Button>
          </Group>

          <Text size="xs" c="dimmed">
            Het bijwerken duurt een paar minuten: er wordt ruim een gigabyte aan
            kaartgegevens opgehaald en opnieuw geindexeerd. De huidige kaart
            blijft gewoon werken zolang dat loopt. De server doet dit uit
            zichzelf zodra de gegevens een maand oud zijn.
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
}
