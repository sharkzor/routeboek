import { useCallback, useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Avatar,
  Badge,
  Button,
  Card,
  Center,
  Collapse,
  Group,
  Image,
  List,
  Loader,
  Menu,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconCalendarPlus,
  IconChevronDown,
  IconChevronUp,
  IconClock,
  IconCoin,
  IconDots,
  IconExternalLink,
  IconMapPin,
  IconPencil,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import "dayjs/locale/nl";
import { Link, useNavigate } from "react-router";

import { ApiError, api } from "../api/client";
import {
  EVENT_TYPE_LABELS,
  TRANSPORT_LABELS,
  type EventItem,
  type TransportMode,
} from "../api/types";

dayjs.locale("nl");

type Scope = "upcoming" | "mine" | "past";

const TRANSPORT_OPTIONS = (Object.keys(TRANSPORT_LABELS) as TransportMode[]).map((value) => ({
  value,
  label: TRANSPORT_LABELS[value],
}));

export function formatEventMoment(event: EventItem): string {
  const day = dayjs(event.event_date);
  if (!event.event_time) return day.format("dddd D MMMM YYYY");
  return `${day.format("dddd D MMMM YYYY")} om ${event.event_time.slice(0, 5)} uur`;
}

export default function EventsPage() {
  const navigate = useNavigate();
  const [scope, setScope] = useState<Scope>("upcoming");
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggleExpanded = (eventId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

  const load = useCallback(async () => {
    setEvents(null);
    try {
      const response = await api.events(scope === "past", scope === "mine");
      setEvents(scope === "past" ? [...response].reverse() : response);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Events laden is mislukt.");
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (updated: EventItem) =>
    setEvents((current) =>
      current ? current.map((item) => (item.id === updated.id ? updated : item)) : current,
    );

  const join = async (event: EventItem, transport: TransportMode) => {
    try {
      const updated = await api.joinEvent(event.id, transport);
      patch(updated);
      notifications.show({ message: "Je aanmelding is opgeslagen.", color: "green" });
    } catch (err) {
      notifications.show({
        message: err instanceof ApiError ? err.message : "Aanmelden is mislukt.",
        color: "red",
      });
    }
  };

  const leave = async (event: EventItem) => {
    try {
      const updated = await api.leaveEvent(event.id);
      patch(updated);
      notifications.show({ message: "Je bent afgemeld.", color: "green" });
    } catch (err) {
      notifications.show({
        message: err instanceof ApiError ? err.message : "Afmelden is mislukt.",
        color: "red",
      });
    }
  };

  const remove = async (event: EventItem) => {
    try {
      await api.deleteEvent(event.id);
      setEvents((current) => current?.filter((item) => item.id !== event.id) ?? null);
      notifications.show({ message: "Het event is verwijderd.", color: "green" });
    } catch (err) {
      notifications.show({
        message: err instanceof ApiError ? err.message : "Verwijderen is mislukt.",
        color: "red",
      });
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Stack gap={2}>
          <Title order={2}>Events</Title>
          <Text c="dimmed" size="sm">
            Grotere tochten, wedstrijden en meerdaagse ritjes verder in de tijd. Meld je aan
            en vind reisgenoten.
          </Text>
        </Stack>
        <Button
          leftSection={<IconCalendarPlus size={18} />}
          color="routeboek"
          onClick={() => navigate("/events/nieuw")}
        >
          Nieuw event
        </Button>
      </Group>

      <SegmentedControl
        value={scope}
        onChange={(value) => setScope(value as Scope)}
        data={[
          { value: "upcoming", label: "Komende events" },
          { value: "mine", label: "Mijn events" },
          { value: "past", label: "Alle (incl. verleden)" },
        ]}
        color="routeboek"
        w="fit-content"
      />

      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      {events === null ? (
        <Center py="xl">
          <Loader color="routeboek" />
        </Center>
      ) : events.length === 0 ? (
        <Card withBorder radius="md" p="xl">
          <Stack align="center" gap="xs">
            <Text c="dimmed">Er staan nog geen events gepland.</Text>
            <Button variant="light" color="routeboek" onClick={() => navigate("/events/nieuw")}>
              Meld het eerste event aan
            </Button>
          </Stack>
        </Card>
      ) : (
        <Stack gap="md">
          {events.map((event) => {
            const full = event.participant_count >= event.max_participants;
            const past = dayjs(event.event_date).isBefore(dayjs().startOf("day"));
            return (
              <Card key={event.id} withBorder radius="md" p="lg">
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Group align="flex-start" wrap="nowrap" gap="md" style={{ minWidth: 0, flex: 1 }}>
                    {event.route && (
                      <Link to={`/routes/${event.route.id}`} style={{ flexShrink: 0 }}>
                        <Image
                          src={event.route.map_url ?? "/brand/map-pattern.png"}
                          alt={`Kaart van ${event.route.name}`}
                          className="rb-ride-thumb"
                          fallbackSrc="/brand/map-pattern.png"
                        />
                      </Link>
                    )}
                    <Stack gap={8} style={{ minWidth: 0, flex: 1 }}>
                      <Group gap={8} wrap="wrap">
                        <Text fw={700} fz="lg">
                          {event.name}
                        </Text>
                        <Badge variant="light" color="routeboek">
                          {EVENT_TYPE_LABELS[event.event_type]}
                        </Badge>
                        {past && (
                          <Badge variant="outline" color="gray">
                            Geweest
                          </Badge>
                        )}
                      </Group>

                      <Group gap="lg" wrap="wrap">
                        <Group gap={6}>
                          <IconClock size={16} color="var(--rb-red)" />
                          <Text size="sm">{formatEventMoment(event)}</Text>
                        </Group>
                        {event.route && (
                          <Group gap={6}>
                            <IconMapPin size={16} color="var(--rb-red)" />
                            <Text
                              size="sm"
                              component={Link}
                              to={`/routes/${event.route.id}`}
                              c="routeboek.6"
                            >
                              {event.route.name}
                            </Text>
                          </Group>
                        )}
                        <Group gap={6}>
                          <IconUsers size={16} color="var(--rb-red)" />
                          <Text size="sm">
                            {event.participant_count} / {event.max_participants}
                          </Text>
                        </Group>
                        {event.cost_eur !== null && (
                          <Group gap={6}>
                            <IconCoin size={16} color="var(--rb-red)" />
                            <Text size="sm">€ {event.cost_eur.toFixed(2)}</Text>
                          </Group>
                        )}
                        {event.url && (
                          <Anchor href={event.url} target="_blank" rel="noreferrer" size="sm">
                            <Group gap={4}>
                              Eventpagina <IconExternalLink size={14} />
                            </Group>
                          </Anchor>
                        )}
                      </Group>

                      <Text size="sm" c="dimmed">
                        {event.created_by && `Aangemaakt door ${event.created_by.display_name}`}
                        {event.distance_km !== null && ` · ${event.distance_km.toFixed(0)} km`}
                        {event.speed_kmh !== null && ` · ${event.speed_kmh.toFixed(0)} km/u`}
                      </Text>

                      {event.notes_html && (
                        <Text size="sm" className="rb-description" lineClamp={3}>
                          {event.notes_html}
                        </Text>
                      )}

                      <Group gap={6} mt={4}>
                        <UnstyledButton
                          onClick={() => toggleExpanded(event.id)}
                          style={{ display: "flex", alignItems: "center", gap: 8 }}
                        >
                          <Avatar.Group spacing="sm">
                            {event.participants.slice(0, 8).map((participant) => (
                              <Tooltip
                                key={participant.id}
                                label={`${participant.display_name} · ${TRANSPORT_LABELS[participant.transport]}`}
                              >
                                <Avatar size="sm" color="routeboek" radius="xl">
                                  {participant.display_name.slice(0, 2).toUpperCase()}
                                </Avatar>
                              </Tooltip>
                            ))}
                          </Avatar.Group>
                          {event.participant_count > 8 && (
                            <Text size="xs" c="dimmed">
                              +{event.participant_count - 8}
                            </Text>
                          )}
                          {event.participant_count > 0 && (
                            <Group gap={2} c="routeboek.6">
                              <Text size="xs" fw={600}>
                                {expanded.has(event.id) ? "Verberg deelnemers" : "Wie gaan er mee?"}
                              </Text>
                              {expanded.has(event.id) ? (
                                <IconChevronUp size={14} />
                              ) : (
                                <IconChevronDown size={14} />
                              )}
                            </Group>
                          )}
                        </UnstyledButton>
                      </Group>

                      <Collapse expanded={expanded.has(event.id)}>
                        {event.participant_count === 0 ? (
                          <Text size="sm" c="dimmed">
                            Nog geen aanmeldingen.
                          </Text>
                        ) : (
                          <List size="sm" spacing={4} mt={4}>
                            {event.participants.map((participant) => (
                              <List.Item
                                key={participant.id}
                                icon={
                                  <Avatar size={20} color="routeboek" radius="xl">
                                    {participant.display_name.slice(0, 2).toUpperCase()}
                                  </Avatar>
                                }
                              >
                                {participant.display_name}{" "}
                                <Text span size="xs" c="dimmed">
                                  ({TRANSPORT_LABELS[participant.transport]})
                                </Text>
                              </List.Item>
                            ))}
                          </List>
                        )}
                      </Collapse>
                    </Stack>
                  </Group>

                  {event.can_edit && (
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          aria-label="Meer acties"
                          style={{ flexShrink: 0 }}
                        >
                          <IconDots size={18} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          leftSection={<IconPencil size={16} />}
                          onClick={() => navigate(`/events/${event.id}/bewerken`)}
                        >
                          Bewerken
                        </Menu.Item>
                        <Menu.Item
                          color="red"
                          leftSection={<IconTrash size={16} />}
                          onClick={() => void remove(event)}
                        >
                          Verwijderen
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </Group>

                {!past && (
                  <Group justify="flex-end" mt="md" align="flex-end">
                    {event.is_joined ? (
                      <>
                        <Select
                          label="Vervoer"
                          data={TRANSPORT_OPTIONS}
                          allowDeselect={false}
                          value={event.my_transport}
                          onChange={(value) =>
                            value && void join(event, value as TransportMode)
                          }
                          w={180}
                          size="sm"
                        />
                        <Button variant="light" color="gray" size="sm" onClick={() => void leave(event)}>
                          Afmelden
                        </Button>
                      </>
                    ) : (
                      <Button
                        color="routeboek"
                        size="sm"
                        disabled={full}
                        onClick={() => void join(event, "own_transport")}
                      >
                        {full ? "Vol" : "Aanmelden"}
                      </Button>
                    )}
                  </Group>
                )}
              </Card>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
