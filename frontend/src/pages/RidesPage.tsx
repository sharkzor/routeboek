import { useCallback, useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Center,
  Checkbox,
  Collapse,
  Group,
  List,
  Loader,
  Menu,
  Pagination,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue, useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconBrandTelegram,
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
  IconSearch,
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
import { WeatherStrip } from "../components/WeatherStrip";
import {
  buildShareText,
  formatRideMoment,
  isWeatherEligible,
  shareNotice,
  shareText,
} from "./ridesShare";

dayjs.locale("nl");

type Scope = "upcoming" | "mine" | "history";

const HISTORY_PAGE_SIZE = 10;

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

  const [historySearch, setHistorySearch] = useState("");
  const [debouncedHistorySearch] = useDebouncedValue(historySearch, 300);
  const [historyMineOnly, setHistoryMineOnly] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);

  // Nieuwe zoekterm of filter: begin weer bij de eerste pagina.
  useEffect(() => {
    setHistoryPage(1);
  }, [debouncedHistorySearch, historyMineOnly]);


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
      let hours: WeatherHour[] | null = null;
      if (isWeatherEligible(ride)) {
        // Hergebruik de cache van het uitgeklapte weerbericht; anders alsnog
        // ophalen zodat delen ook werkt zonder dat je 'm eerst hebt bekeken.
        const cached = weatherByRide[ride.id]?.hours;
        hours =
          cached !== undefined
            ? cached
            : await api
                .rideWeather(ride.id)
                .then((result) => (result.available ? result.hours : null))
                .catch(() => null);
      }
      const text = buildShareText(ride, hours);
      await shareText(text);
      notifications.show({
        message: shareNotice(ride),
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
      if (scope === "history") {
        const response = await api.ridesHistory({
          search: debouncedHistorySearch.trim() || undefined,
          mine: historyMineOnly,
          page: historyPage,
          page_size: HISTORY_PAGE_SIZE,
        });
        setRides(response.items);
        setHistoryTotal(response.total);
      } else {
        const response = await api.rides(false, scope === "mine");
        setRides(response);
      }
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Ritten laden is mislukt.",
      );
    }
  }, [scope, debouncedHistorySearch, historyMineOnly, historyPage]);

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
          { value: "history", label: "Historie" },
        ]}
        color="routeboek"
        fullWidth={isMobile}
        w={isMobile ? undefined : "fit-content"}
      />

      {scope === "history" && (
        <Group align="flex-end" wrap="wrap" gap="sm">
          <TextInput
            placeholder="Zoek op ritnaam, route of wegkapitein"
            leftSection={<IconSearch size={16} />}
            value={historySearch}
            onChange={(event) => setHistorySearch(event.currentTarget.value)}
            style={{ flex: 1, minWidth: 220 }}
          />
          <Checkbox
            label="Alleen mijn ritten"
            checked={historyMineOnly}
            onChange={(event) =>
              setHistoryMineOnly(event.currentTarget.checked)
            }
          />
        </Group>
      )}

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
            <Text c="dimmed">
              {scope === "history"
                ? "Geen ritten gevonden."
                : "Er staan nog geen ritten gepland."}
            </Text>
            {scope !== "history" && (
              <Button
                variant="light"
                color="routeboek"
                onClick={() => navigate("/ritten/nieuw")}
              >
                Organiseer de eerste rit
              </Button>
            )}
          </Stack>
        </Card>
      ) : (
        <Stack gap="md">
          {rides.map((ride) => {
            const full = ride.participant_count >= ride.max_participants;
            const past = dayjs(ride.ride_date).isBefore(dayjs().startOf("day"));
            const weatherEligible = isWeatherEligible(ride);
            return (
              <Card key={ride.id} withBorder radius="md" p={0}>
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
                        <Text
                          fw={700}
                          fz="lg"
                          lineClamp={2}
                          component={Link}
                          to={`/ritten/${ride.id}`}
                          c="inherit"
                          td="none"
                        >
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
                          {ride.posted_to_telegram && (
                            <Badge
                              size="sm"
                              variant="light"
                              color="blue"
                              leftSection={<IconBrandTelegram size={12} />}
                            >
                              Telegram
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

      {scope === "history" && rides !== null && historyTotal > HISTORY_PAGE_SIZE && (
        <Center>
          <Pagination
            total={Math.ceil(historyTotal / HISTORY_PAGE_SIZE)}
            value={historyPage}
            onChange={(next) => {
              setHistoryPage(next);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            color="routeboek"
          />
        </Center>
      )}
    </Stack>
  );
}
