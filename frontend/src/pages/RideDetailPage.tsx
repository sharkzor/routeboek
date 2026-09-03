import { useCallback, useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Center,
  Group,
  List,
  Loader,
  Menu,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowLeft,
  IconBrandTelegram,
  IconClock,
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
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

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

export default function RideDetailPage() {
  const { rideId } = useParams();
  // Een gedeelde link naar een prive-rit draagt de sleutel mee; die geeft de
  // ontvanger eenmalig toegang, waarna de server hem als genodigde onthoudt.
  const [searchParams] = useSearchParams();
  const shareKey = searchParams.get("sleutel");
  const navigate = useNavigate();
  const { user } = useAuth();
  const [ride, setRide] = useState<Ride | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [weather, setWeather] = useState<{
    loading: boolean;
    hours: WeatherHour[] | null;
  }>({ loading: false, hours: null });

  const load = useCallback(async () => {
    if (!rideId) return;
    try {
      const result = await api.ride(Number(rideId), shareKey);
      setRide(result);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Rit laden is mislukt.",
      );
    }
  }, [rideId, shareKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const past = ride ? dayjs(ride.ride_date).isBefore(dayjs().startOf("day")) : false;
  const weatherEligible = ride !== null && isWeatherEligible(ride);

  useEffect(() => {
    if (!weatherEligible || !ride) return;
    setWeather({ loading: true, hours: null });
    void api
      .rideWeather(ride.id)
      .then((result) =>
        setWeather({ loading: false, hours: result.available ? result.hours : null }),
      )
      .catch(() => setWeather({ loading: false, hours: null }));
    // We willen dit alleen opnieuw ophalen als de rit zelf wisselt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weatherEligible, ride?.id]);

  const mutate = async (action: () => Promise<Ride>, message: string) => {
    try {
      const updated = await action();
      setRide(updated);
      notifications.show({ message, color: "green" });
    } catch (err) {
      notifications.show({
        message: err instanceof ApiError ? err.message : "Dat lukte niet.",
        color: "red",
      });
    }
  };

  const remove = async () => {
    if (!ride) return;
    try {
      await api.deleteRide(ride.id);
      notifications.show({ message: "De rit is verwijderd.", color: "green" });
      navigate("/ritten");
    } catch (err) {
      notifications.show({
        message:
          err instanceof ApiError ? err.message : "Verwijderen is mislukt.",
        color: "red",
      });
    }
  };

  const share = async () => {
    if (!ride || sharing) return;
    setSharing(true);
    try {
      const text = buildShareText(ride, weather.hours);
      await shareText(text);
      notifications.show({
        message: shareNotice(ride),
        color: "green",
      });
    } catch {
      notifications.show({ message: "Delen is mislukt.", color: "red" });
    } finally {
      setSharing(false);
    }
  };

  if (error) {
    return (
      <Stack gap="md">
        <Button
          variant="subtle"
          color="gray"
          leftSection={<IconArrowLeft size={16} />}
          onClick={() => navigate("/ritten")}
        >
          Terug naar ritten
        </Button>
        <Alert color="red" variant="light">
          {error}
        </Alert>
      </Stack>
    );
  }

  if (ride === null) {
    return (
      <Center py="xl">
        <Loader color="routeboek" />
      </Center>
    );
  }

  const full = ride.participant_count >= ride.max_participants;

  return (
    <Stack gap="lg">
      <Button
        variant="subtle"
        color="gray"
        leftSection={<IconArrowLeft size={16} />}
        onClick={() => navigate("/ritten")}
        w="fit-content"
      >
        Terug naar ritten
      </Button>

      <Card withBorder radius="md" p={0}>
        {ride.route && (
          <div className="rb-ride-detail-media">
            <img
              src={ride.route.map_url ?? "/brand/map-pattern.png"}
              alt={`Kaart van ${ride.route.name}`}
              onError={(event) => {
                event.currentTarget.src = "/brand/map-pattern.png";
              }}
            />
            <div className="rb-ride-date rb-ride-date--lg">
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
          </div>
        )}

        <Stack gap="md" p="lg">
          <Group justify="space-between" align="flex-start" wrap="wrap">
            <Stack gap={6} style={{ minWidth: 0, flex: 1 }}>
              <Title order={2}>{ride.name}</Title>
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

            <Group gap={4} wrap="nowrap">
              <Tooltip label="Delen via WhatsApp/Telegram">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="lg"
                  aria-label="Rit delen"
                  loading={sharing}
                  onClick={() => void share()}
                >
                  <IconShare2 size={20} />
                </ActionIcon>
              </Tooltip>
              {ride.can_edit && (
                <Menu position="bottom-end" withinPortal>
                  <Menu.Target>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="lg"
                      aria-label="Meer acties"
                    >
                      <IconDots size={20} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item
                      leftSection={<IconPencil size={16} />}
                      onClick={() => navigate(`/ritten/${ride.id}/bewerken`)}
                    >
                      Bewerken
                    </Menu.Item>
                    <Menu.Item
                      color="red"
                      leftSection={<IconTrash size={16} />}
                      onClick={() => void remove()}
                    >
                      Verwijderen
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              )}
            </Group>
          </Group>

          <Group gap={6} wrap="nowrap">
            <IconClock size={18} color="var(--rb-red)" style={{ flexShrink: 0 }} />
            <Text>{formatRideMoment(ride)}</Text>
          </Group>

          <div className="rb-ride-detail-facts">
            <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
              <IconUser size={18} color="var(--rb-red)" style={{ flexShrink: 0 }} />
              <Text truncate>
                {ride.owner.display_name} · wegkapitein
              </Text>
            </Group>
            <Group gap={6} wrap="nowrap">
              <IconUsers size={18} color="var(--rb-red)" style={{ flexShrink: 0 }} />
              <Text c={full ? "red" : undefined}>
                {ride.participant_count} / {ride.max_participants} deelnemers
              </Text>
            </Group>
            {ride.distance_km !== null && (
              <Group gap={6} wrap="nowrap">
                <IconMapPin size={18} color="var(--rb-red)" style={{ flexShrink: 0 }} />
                <Text>{ride.distance_km.toFixed(0)} km</Text>
              </Group>
            )}
            {ride.speed_kmh !== null && (
              <Group gap={6} wrap="nowrap">
                <IconGauge size={18} color="var(--rb-red)" style={{ flexShrink: 0 }} />
                <Text>{ride.speed_kmh.toFixed(0)} km/u</Text>
              </Group>
            )}
          </div>

          {ride.route && (
            <Group gap={6} wrap="nowrap">
              <IconRoute size={18} color="var(--rb-red)" style={{ flexShrink: 0 }} />
              <Text
                component={Link}
                to={`/routes/${ride.route.id}`}
                c="routeboek.6"
                fw={600}
              >
                {ride.route.name}
              </Text>
            </Group>
          )}

          {ride.notes_html && (
            <Text className="rb-description" style={{ whiteSpace: "pre-wrap" }}>
              {ride.notes_html}
            </Text>
          )}

          <Stack gap={4}>
            <Text fw={700} size="sm">
              Wie gaan er mee?
            </Text>
            {ride.participant_count === 0 ? (
              <Text size="sm" c="dimmed">
                Nog geen aanmeldingen.
              </Text>
            ) : (
              <List size="sm" spacing={6}>
                {ride.participants.map((participant) => (
                  <List.Item
                    key={participant.id}
                    icon={
                      <Avatar size={22} color="routeboek" radius="xl">
                        {participant.display_name.slice(0, 2).toUpperCase()}
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
          </Stack>

          {weatherEligible && (
            <Stack gap={4}>
              <Text fw={700} size="sm">
                Weerbericht
              </Text>
              <WeatherStrip loading={weather.loading} hours={weather.hours} />
            </Stack>
          )}

          {!past && (
            <Group justify="flex-end">
              {ride.is_joined ? (
                <Button
                  variant="light"
                  color="gray"
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
      </Card>
    </Stack>
  );
}
