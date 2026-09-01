import { useCallback, useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
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
  IconCloudRain,
  IconDots,
  IconLock,
  IconMapPin,
  IconPencil,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import "dayjs/locale/nl";
import { Link, useNavigate } from "react-router";

import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { RIDE_TYPE_LABELS, type Ride, type WeatherHour } from "../api/types";
import { WeatherStrip } from "../components/WeatherStrip";

dayjs.locale("nl");

type Scope = "upcoming" | "mine" | "past";

export function formatRideMoment(ride: Ride): string {
  const day = dayjs(ride.ride_date);
  return `${day.format("dddd D MMMM YYYY")} om ${ride.ride_time.slice(0, 5)} uur`;
}

const FORECAST_HORIZON_DAYS = 15;

export default function RidesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [scope, setScope] = useState<Scope>("upcoming");
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [weatherExpanded, setWeatherExpanded] = useState<Set<number>>(
    new Set(),
  );
  const [weatherByRide, setWeatherByRide] = useState<
    Record<number, { loading: boolean; hours: WeatherHour[] | null }>
  >({});

  const toggleExpanded = (rideId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rideId)) next.delete(rideId);
      else next.add(rideId);
      return next;
    });
  };

  const toggleWeather = (rideId: number) => {
    setWeatherExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rideId)) {
        next.delete(rideId);
        return next;
      }
      next.add(rideId);
      return next;
    });
    setWeatherByRide((prev) => {
      if (prev[rideId]) return prev;
      void api
        .rideWeather(rideId)
        .then((result) =>
          setWeatherByRide((current) => ({
            ...current,
            [rideId]: {
              loading: false,
              hours: result.available ? result.hours : null,
            },
          })),
        )
        .catch(() =>
          setWeatherByRide((current) => ({
            ...current,
            [rideId]: { loading: false, hours: null },
          })),
        );
      return { ...prev, [rideId]: { loading: true, hours: null } };
    });
  };

  const load = useCallback(async () => {
    setRides(null);
    try {
      const response = await api.rides(scope === "past", scope === "mine");
      setRides(scope === "past" ? [...response].reverse() : response);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Ritten laden is mislukt.",
      );
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = async (action: () => Promise<Ride>, message: string) => {
    try {
      const updated = await action();
      setRides((current) =>
        current
          ? current.map((ride) => (ride.id === updated.id ? updated : ride))
          : current,
      );
      notifications.show({ message, color: "green" });
    } catch (err) {
      notifications.show({
        message: err instanceof ApiError ? err.message : "Dat lukte niet.",
        color: "red",
      });
    }
  };

  const remove = async (ride: Ride) => {
    try {
      await api.deleteRide(ride.id);
      setRides(
        (current) => current?.filter((item) => item.id !== ride.id) ?? null,
      );
      notifications.show({ message: "De rit is verwijderd.", color: "green" });
    } catch (err) {
      notifications.show({
        message:
          err instanceof ApiError ? err.message : "Verwijderen is mislukt.",
        color: "red",
      });
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Stack gap={2}>
          <Title order={2}>Ritten</Title>
          <Text c="dimmed" size="sm">
            Plan een rit of meld je aan bij een clubgenoot.
          </Text>
        </Stack>
        <Button
          leftSection={<IconCalendarPlus size={18} />}
          color="routeboek"
          onClick={() => navigate("/ritten/nieuw")}
        >
          Nieuwe rit
        </Button>
      </Group>

      <SegmentedControl
        value={scope}
        onChange={(value) => setScope(value as Scope)}
        data={[
          { value: "upcoming", label: "Komende ritten" },
          { value: "mine", label: "Mijn ritten" },
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

      {rides === null ? (
        <Center py="xl">
          <Loader color="routeboek" />
        </Center>
      ) : rides.length === 0 ? (
        <Card withBorder radius="md" p="xl">
          <Stack align="center" gap="xs">
            <Text c="dimmed">Er staan nog geen ritten gepland.</Text>
            <Button
              variant="light"
              color="routeboek"
              onClick={() => navigate("/ritten/nieuw")}
            >
              Organiseer de eerste rit
            </Button>
          </Stack>
        </Card>
      ) : (
        <Stack gap="md">
          {rides.map((ride) => {
            const full = ride.participant_count >= ride.max_participants;
            const past = dayjs(ride.ride_date).isBefore(dayjs().startOf("day"));
            const weatherEligible =
              !past &&
              ride.route !== null &&
              dayjs(ride.ride_date).diff(dayjs().startOf("day"), "day") <=
                FORECAST_HORIZON_DAYS;
            return (
              <Card key={ride.id} withBorder radius="md" p="lg">
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Group
                    align="flex-start"
                    wrap="nowrap"
                    gap="md"
                    style={{ minWidth: 0, flex: 1 }}
                  >
                    {ride.route && (
                      <Link
                        to={`/routes/${ride.route.id}`}
                        style={{ flexShrink: 0 }}
                      >
                        <Image
                          src={ride.route.map_url ?? "/brand/map-pattern.png"}
                          alt={`Kaart van ${ride.route.name}`}
                          className="rb-ride-thumb"
                          fallbackSrc="/brand/map-pattern.png"
                        />
                      </Link>
                    )}
                    <Stack gap={8} style={{ minWidth: 0, flex: 1 }}>
                      <Group gap={8} wrap="wrap">
                        <Text fw={700} fz="lg">
                          {ride.name}
                        </Text>
                        <Badge variant="light" color="routeboek">
                          {RIDE_TYPE_LABELS[ride.ride_type]}
                        </Badge>
                        {ride.is_private && (
                          <Badge
                            variant="light"
                            color="gray"
                            leftSection={<IconLock size={12} />}
                          >
                            Privé
                          </Badge>
                        )}
                        {past && (
                          <Badge variant="outline" color="gray">
                            Geweest
                          </Badge>
                        )}
                      </Group>

                      <Group gap="lg" wrap="wrap">
                        <Group gap={6}>
                          <IconClock size={16} color="var(--rb-red)" />
                          <Text size="sm">{formatRideMoment(ride)}</Text>
                        </Group>
                        {ride.route && (
                          <Group gap={6}>
                            <IconMapPin size={16} color="var(--rb-red)" />
                            <Text
                              size="sm"
                              component={Link}
                              to={`/routes/${ride.route.id}`}
                              c="routeboek.6"
                            >
                              {ride.route.name}
                            </Text>
                          </Group>
                        )}
                        <Group gap={6}>
                          <IconUsers size={16} color="var(--rb-red)" />
                          <Text size="sm">
                            {ride.participant_count} / {ride.max_participants}
                          </Text>
                        </Group>
                      </Group>

                      <Text size="sm" c="dimmed">
                        Wegkapitein: {ride.owner.display_name}
                        {ride.distance_km !== null &&
                          ` · ${ride.distance_km.toFixed(0)} km`}
                        {ride.speed_kmh !== null &&
                          ` · ${ride.speed_kmh.toFixed(0)} km/u`}
                      </Text>

                      {ride.notes_html && (
                        <Text
                          size="sm"
                          className="rb-description"
                          lineClamp={3}
                        >
                          {ride.notes_html}
                        </Text>
                      )}

                      <Group gap={6} mt={4}>
                        <UnstyledButton
                          onClick={() => toggleExpanded(ride.id)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <Avatar.Group spacing="sm">
                            {ride.participants
                              .slice(0, 8)
                              .map((participant) => (
                                <Tooltip
                                  key={participant.id}
                                  label={participant.display_name}
                                >
                                  <Avatar
                                    size="sm"
                                    color="routeboek"
                                    radius="xl"
                                  >
                                    {participant.display_name
                                      .slice(0, 2)
                                      .toUpperCase()}
                                  </Avatar>
                                </Tooltip>
                              ))}
                          </Avatar.Group>
                          {ride.participant_count > 8 && (
                            <Text size="xs" c="dimmed">
                              +{ride.participant_count - 8}
                            </Text>
                          )}
                          {ride.participant_count > 0 && (
                            <Group gap={2} c="routeboek.6">
                              <Text size="xs" fw={600}>
                                {expanded.has(ride.id)
                                  ? "Verberg deelnemers"
                                  : "Wie gaan er mee?"}
                              </Text>
                              {expanded.has(ride.id) ? (
                                <IconChevronUp size={14} />
                              ) : (
                                <IconChevronDown size={14} />
                              )}
                            </Group>
                          )}
                        </UnstyledButton>
                      </Group>

                      <Collapse expanded={expanded.has(ride.id)}>
                        {ride.participant_count === 0 ? (
                          <Text size="sm" c="dimmed">
                            Nog geen aanmeldingen.
                          </Text>
                        ) : (
                          <List size="sm" spacing={4} mt={4}>
                            {ride.participants.map((participant) => (
                              <List.Item
                                key={participant.id}
                                icon={
                                  <Avatar
                                    size={20}
                                    color="routeboek"
                                    radius="xl"
                                  >
                                    {participant.display_name
                                      .slice(0, 2)
                                      .toUpperCase()}
                                  </Avatar>
                                }
                              >
                                {participant.display_name}
                                {participant.id === ride.owner.id && (
                                  <Text span size="xs" c="dimmed">
                                    {" "}
                                    (wegkapitein)
                                  </Text>
                                )}
                              </List.Item>
                            ))}
                          </List>
                        )}
                      </Collapse>

                      {weatherEligible && (
                        <>
                          <UnstyledButton
                            onClick={() => toggleWeather(ride.id)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <Group gap={2} c="routeboek.6">
                              <IconCloudRain size={16} />
                              <Text size="xs" fw={600}>
                                {weatherExpanded.has(ride.id)
                                  ? "Verberg weerbericht"
                                  : "Weerbericht"}
                              </Text>
                              {weatherExpanded.has(ride.id) ? (
                                <IconChevronUp size={14} />
                              ) : (
                                <IconChevronDown size={14} />
                              )}
                            </Group>
                          </UnstyledButton>
                          <Collapse expanded={weatherExpanded.has(ride.id)}>
                            <WeatherStrip
                              loading={
                                weatherByRide[ride.id]?.loading ?? false
                              }
                              hours={weatherByRide[ride.id]?.hours ?? null}
                            />
                          </Collapse>
                        </>
                      )}
                    </Stack>
                  </Group>

                  {ride.can_edit && (
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
                          onClick={() =>
                            navigate(`/ritten/${ride.id}/bewerken`)
                          }
                        >
                          Bewerken
                        </Menu.Item>
                        <Menu.Item
                          color="red"
                          leftSection={<IconTrash size={16} />}
                          onClick={() => void remove(ride)}
                        >
                          Verwijderen
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </Group>

                {!past && (
                  <Group justify="flex-end" mt="md">
                    {ride.is_joined ? (
                      <Button
                        variant="light"
                        color="gray"
                        size="sm"
                        disabled={ride.owner.id === user?.id}
                        onClick={() =>
                          void mutate(
                            () => api.leaveRide(ride.id),
                            "Je bent afgemeld.",
                          )
                        }
                      >
                        Afmelden
                      </Button>
                    ) : (
                      <Button
                        color="routeboek"
                        size="sm"
                        disabled={full}
                        onClick={() =>
                          void mutate(
                            () => api.joinRide(ride.id),
                            "Je bent aangemeld.",
                          )
                        }
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
