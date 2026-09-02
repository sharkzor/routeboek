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
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconCalendarPlus,
  IconChevronDown,
  IconChevronUp,
  IconClock,
  IconCloudRain,
  IconDots,
  IconGauge,
  IconLock,
  IconMapPin,
  IconPencil,
  IconRoute,
  IconShare2,
  IconTrash,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import "dayjs/locale/nl";
import { Link, useNavigate } from "react-router";

import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { RIDE_TYPE_LABELS, type Ride, type WeatherHour } from "../api/types";
import { WeatherStrip, weatherLabel } from "../components/WeatherStrip";

dayjs.locale("nl");

type Scope = "upcoming" | "mine" | "past";

export function formatRideMoment(ride: Ride): string {
  const day = dayjs(ride.ride_date);
  // Het jaartal alleen tonen als de rit niet in het huidige jaar valt; dat
  // scheelt op mobiel net genoeg ruimte om op één regel te passen.
  const pattern =
    day.year() === dayjs().year() ? "dddd D MMMM" : "dddd D MMMM YYYY";
  return `${day.format(pattern)} · ${ride.ride_time.slice(0, 5)}`;
}

const FORECAST_HORIZON_DAYS = 15;

/** Zoekt het weeruur dat het dichtst bij het vertrektijdstip van de rit ligt. */
function nearestWeatherHour(
  ride: Ride,
  hours: WeatherHour[] | null,
): WeatherHour | null {
  if (!hours || hours.length === 0) return null;
  const target = dayjs(`${ride.ride_date}T${ride.ride_time.slice(0, 5)}`);
  return hours.reduce((closest, hour) => {
    const diff = Math.abs(dayjs(hour.time).diff(target));
    const closestDiff = Math.abs(dayjs(closest.time).diff(target));
    return diff < closestDiff ? hour : closest;
  }, hours[0]);
}

/** Bouwt de deeltekst voor WhatsApp/Telegram, naar het formaat van het oude
 *  routeboek.cc (naam, wegkapitein, datum/tijd, kerngegevens, weer en
 *  opmerkingen, met de routelink onderaan). */
function buildShareText(ride: Ride, weatherHour: WeatherHour | null): string {
  const lines: string[] = [ride.name, `🚴 ${ride.owner.display_name}`];
  lines.push(`📅 ${dayjs(ride.ride_date).format("dddd D MMMM")}`);
  lines.push(`⏰ ${ride.ride_time.slice(0, 5)}`);
  if (ride.distance_km !== null) {
    lines.push(
      `🏁 ${ride.distance_km.toLocaleString("nl-NL", { maximumFractionDigits: 1 })} km`,
    );
  }
  if (ride.speed_kmh !== null) {
    lines.push(`🐢 ${ride.speed_kmh.toFixed(0)} km/u`);
  }
  lines.push(`🚴‍ Max. ${ride.max_participants}`);
  lines.push(`🚲 ${RIDE_TYPE_LABELS[ride.ride_type]}`);
  if (weatherHour) {
    lines.push(
      `☁️ ${weatherLabel(weatherHour.weather_code, weatherHour.is_day)}, ${Math.round(weatherHour.temp_c)}° · ${weatherHour.wind_compass} ${weatherHour.wind_beaufort} Bft`,
    );
  }
  if (ride.notes_html.trim()) {
    lines.push(`💬 ${ride.notes_html.trim()}`);
  }
  lines.push("");
  lines.push(`📈 ${window.location.origin}/ritten#rit-${ride.id}`);
  return lines.join("\n");
}

export default function RidesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width: 48em)");
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
  const [sharing, setSharing] = useState<Set<number>>(new Set());
  const [highlighted, setHighlighted] = useState<number | null>(null);

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

  const shareRide = async (ride: Ride) => {
    if (sharing.has(ride.id)) return;
    setSharing((prev) => new Set(prev).add(ride.id));
    try {
      let weatherHour: WeatherHour | null = null;
      const past = dayjs(ride.ride_date).isBefore(dayjs().startOf("day"));
      const withinHorizon =
        dayjs(ride.ride_date).diff(dayjs().startOf("day"), "day") <=
        FORECAST_HORIZON_DAYS;
      if (ride.route && !past && withinHorizon) {
        // Hergebruik de cache van het uitgeklapte weerbericht; anders alsnog
        // ophalen zodat delen ook werkt zonder dat je 'm eerst hebt bekeken.
        const cached = weatherByRide[ride.id]?.hours;
        const hours =
          cached !== undefined
            ? cached
            : await api
                .rideWeather(ride.id)
                .then((result) => (result.available ? result.hours : null))
                .catch(() => null);
        weatherHour = nearestWeatherHour(ride, hours);
      }
      const text = buildShareText(ride, weatherHour);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback voor browsers zonder Clipboard API (of buiten https).
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      notifications.show({
        message: "Rit gekopieerd naar klembord — plak 'm in WhatsApp of Telegram.",
        color: "green",
      });
    } catch {
      notifications.show({ message: "Delen is mislukt.", color: "red" });
    } finally {
      setSharing((prev) => {
        const next = new Set(prev);
        next.delete(ride.id);
        return next;
      });
    }
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

  // Een gedeelde rit-link (#rit-<id>) moet vindbaar zijn ongeacht scope: zet
  // daarom bij binnenkomst het brede "Alle"-bereik zodat ook een verleden of
  // andermans rit meekomt (visible_rides_query regelt privé-zichtbaarheid).
  useEffect(() => {
    const match = window.location.hash.match(/^#rit-(\d+)$/);
    if (match) setScope("past");
  }, []);

  useEffect(() => {
    const match = window.location.hash.match(/^#rit-(\d+)$/);
    if (!match || rides === null) return;
    const rideId = Number(match[1]);
    const el = document.getElementById(`rit-${rideId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlighted(rideId);
      const timeout = setTimeout(() => setHighlighted(null), 2500);
      return () => clearTimeout(timeout);
    }
  }, [rides]);

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
    <Stack gap={isMobile ? "sm" : "lg"}>
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
        <Stack gap={2}>
          <Title order={2}>Ritten</Title>
          <Text c="dimmed" size="sm">
            Plan een rit of meld je aan bij een clubgenoot.
          </Text>
        </Stack>
        <Button
          leftSection={<IconCalendarPlus size={18} />}
          color="routeboek"
          fullWidth={isMobile}
          onClick={() => navigate("/ritten/nieuw")}
        >
          Nieuwe rit
        </Button>
      </Group>

      <SegmentedControl
        value={scope}
        onChange={(value) => setScope(value as Scope)}
        data={[
          { value: "upcoming", label: isMobile ? "Komend" : "Komende ritten" },
          { value: "mine", label: isMobile ? "Mijn" : "Mijn ritten" },
          {
            value: "past",
            label: isMobile ? "Alles" : "Alle (incl. verleden)",
          },
        ]}
        color="routeboek"
        fullWidth={isMobile}
        w={isMobile ? undefined : "fit-content"}
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
              <Card
                key={ride.id}
                id={`rit-${ride.id}`}
                withBorder
                radius="md"
                p={0}
                className={
                  highlighted === ride.id ? "rb-ride-card--highlight" : undefined
                }
              >
                <div
                  className={
                    "rb-ride-card" + (ride.route ? " rb-ride-card--media" : "")
                  }
                >
                  {ride.route && (
                    <Link
                      to={`/routes/${ride.route.id}`}
                      className="rb-ride-media"
                      aria-label={`Bekijk route ${ride.route.name}`}
                    >
                      <img
                        src={ride.route.map_url ?? "/brand/map-pattern.png"}
                        alt={`Kaart van ${ride.route.name}`}
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.src = "/brand/map-pattern.png";
                        }}
                      />
                      <div className="rb-ride-date">
                        <div className="rb-ride-date__cal">
                          <div className="rb-ride-date__month">
                            {dayjs(ride.ride_date).format("MMM")}
                          </div>
                          <div className="rb-ride-date__day">
                            {dayjs(ride.ride_date).format("DD")}
                          </div>
                        </div>
                        <div className="rb-ride-date__time">
                          {ride.ride_time.slice(0, 5)}
                        </div>
                      </div>
                    </Link>
                  )}

                  <Stack gap={8} p="md" style={{ minWidth: 0 }}>
                    <Group
                      justify="space-between"
                      align="flex-start"
                      wrap="nowrap"
                      gap="xs"
                    >
                      <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
                        <Text fw={700} fz="lg" lineClamp={2}>
                          {ride.name}
                        </Text>
                        <Group gap={6} wrap="wrap">
                          <Badge size="sm" variant="light" color="routeboek">
                            {RIDE_TYPE_LABELS[ride.ride_type]}
                          </Badge>
                          {ride.is_private && (
                            <Badge
                              size="sm"
                              variant="light"
                              color="gray"
                              leftSection={<IconLock size={12} />}
                            >
                              Privé
                            </Badge>
                          )}
                          {past && (
                            <Badge size="sm" variant="outline" color="gray">
                              Geweest
                            </Badge>
                          )}
                        </Group>
                      </Stack>

                      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                        <Tooltip label="Delen via WhatsApp/Telegram">
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            aria-label="Rit delen"
                            loading={sharing.has(ride.id)}
                            onClick={() => void shareRide(ride)}
                          >
                            <IconShare2 size={18} />
                          </ActionIcon>
                        </Tooltip>
                        {ride.can_edit && (
                          <Menu position="bottom-end" withinPortal>
                            <Menu.Target>
                              <ActionIcon
                                variant="subtle"
                                color="gray"
                                aria-label="Meer acties"
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
                    </Group>

                    <Group gap={6} wrap="nowrap">
                      <IconClock
                        size={16}
                        color="var(--rb-red)"
                        style={{ flexShrink: 0 }}
                      />
                      <Text size="sm">{formatRideMoment(ride)}</Text>
                    </Group>

                    <div className="rb-ride-facts">
                      <Group gap={6} wrap="nowrap">
                        <IconUser
                          size={16}
                          color="var(--rb-red)"
                          style={{ flexShrink: 0 }}
                        />
                        <Text size="sm" truncate>
                          {ride.owner.display_name}
                        </Text>
                      </Group>
                      <Group gap={6} wrap="nowrap">
                        <IconUsers
                          size={16}
                          color="var(--rb-red)"
                          style={{ flexShrink: 0 }}
                        />
                        <Text size="sm" c={full ? "red" : undefined}>
                          {ride.participant_count} / {ride.max_participants}
                        </Text>
                      </Group>
                      {ride.distance_km !== null && (
                        <Group gap={6} wrap="nowrap">
                          <IconMapPin
                            size={16}
                            color="var(--rb-red)"
                            style={{ flexShrink: 0 }}
                          />
                          <Text size="sm">
                            {ride.distance_km.toFixed(0)} km
                          </Text>
                        </Group>
                      )}
                      {ride.speed_kmh !== null && (
                        <Group gap={6} wrap="nowrap">
                          <IconGauge
                            size={16}
                            color="var(--rb-red)"
                            style={{ flexShrink: 0 }}
                          />
                          <Text size="sm">
                            {ride.speed_kmh.toFixed(0)} km/u
                          </Text>
                        </Group>
                      )}
                    </div>

                    {ride.route && ride.route.name !== ride.name && (
                      <Group gap={6} wrap="nowrap">
                        <IconRoute
                          size={16}
                          color="var(--rb-red)"
                          style={{ flexShrink: 0 }}
                        />
                        <Text
                          size="sm"
                          component={Link}
                          to={`/routes/${ride.route.id}`}
                          c="routeboek.6"
                          truncate
                        >
                          {ride.route.name}
                        </Text>
                      </Group>
                    )}

                    {ride.notes_html && (
                      <Text size="sm" className="rb-description" lineClamp={2}>
                        {ride.notes_html}
                      </Text>
                    )}

                    <UnstyledButton
                      onClick={() => toggleExpanded(ride.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <Avatar.Group spacing="sm">
                        {ride.participants.slice(0, 6).map((participant) => (
                          <Tooltip
                            key={participant.id}
                            label={participant.display_name}
                          >
                            <Avatar size="sm" color="routeboek" radius="xl">
                              {participant.display_name
                                .slice(0, 2)
                                .toUpperCase()}
                            </Avatar>
                          </Tooltip>
                        ))}
                      </Avatar.Group>
                      {ride.participant_count > 6 && (
                        <Text size="xs" c="dimmed">
                          +{ride.participant_count - 6}
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
                                <Avatar size={20} color="routeboek" radius="xl">
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
                            loading={weatherByRide[ride.id]?.loading ?? false}
                            hours={weatherByRide[ride.id]?.hours ?? null}
                          />
                        </Collapse>
                      </>
                    )}

                    {!past && (
                      <Group justify="flex-end" mt={4}>
                        {ride.is_joined ? (
                          <Button
                            variant="light"
                            color="gray"
                            size="sm"
                            fullWidth={isMobile}
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
                            fullWidth={isMobile}
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
                  </Stack>
                </div>
              </Card>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
