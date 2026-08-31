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
  Image,
  Loader,
  Menu,
  SegmentedControl,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconCalendarPlus,
  IconClock,
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
import { RIDE_TYPE_LABELS, type Ride } from "../api/types";

dayjs.locale("nl");

type Scope = "upcoming" | "mine" | "past";

export function formatRideMoment(ride: Ride): string {
  const day = dayjs(ride.ride_date);
  return `${day.format("dddd D MMMM YYYY")} om ${ride.ride_time.slice(0, 5)} uur`;
}

export default function RidesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [scope, setScope] = useState<Scope>("upcoming");
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRides(null);
    try {
      const response = await api.rides(scope === "past", scope === "mine");
      setRides(scope === "past" ? [...response].reverse() : response);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ritten laden is mislukt.");
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = async (action: () => Promise<Ride>, message: string) => {
    try {
      const updated = await action();
      setRides((current) =>
        current ? current.map((ride) => (ride.id === updated.id ? updated : ride)) : current,
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
      setRides((current) => current?.filter((item) => item.id !== ride.id) ?? null);
      notifications.show({ message: "De rit is verwijderd.", color: "green" });
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
            <Button variant="light" color="routeboek" onClick={() => navigate("/ritten/nieuw")}>
              Organiseer de eerste rit
            </Button>
          </Stack>
        </Card>
      ) : (
        <Stack gap="md">
          {rides.map((ride) => {
            const full = ride.participant_count >= ride.max_participants;
            const past = dayjs(ride.ride_date).isBefore(dayjs().startOf("day"));
            return (
              <Card key={ride.id} withBorder radius="md" p="lg">
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  {ride.route && (
                    <Link to={`/routes/${ride.route.id}`} style={{ flexShrink: 0 }}>
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
                        <Badge variant="light" color="gray" leftSection={<IconLock size={12} />}>
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
                      {ride.distance_km !== null && ` · ${ride.distance_km.toFixed(0)} km`}
                      {ride.speed_kmh !== null && ` · ${ride.speed_kmh.toFixed(0)} km/u`}
                    </Text>

                    {ride.notes_html && (
                      <Text size="sm" className="rb-description" lineClamp={3}>
                        {ride.notes_html}
                      </Text>
                    )}

                    <Group gap={6} mt={4}>
                      <Avatar.Group spacing="sm">
                        {ride.participants.slice(0, 8).map((participant) => (
                          <Tooltip key={participant.id} label={participant.display_name}>
                            <Avatar size="sm" color="routeboek" radius="xl">
                              {participant.display_name.slice(0, 2).toUpperCase()}
                            </Avatar>
                          </Tooltip>
                        ))}
                      </Avatar.Group>
                      {ride.participant_count > 8 && (
                        <Text size="xs" c="dimmed">
                          +{ride.participant_count - 8}
                        </Text>
                      )}
                    </Group>
                  </Stack>

                  <Stack gap="xs" align="flex-end" style={{ flexShrink: 0 }}>
                    {!past &&
                      (ride.is_joined ? (
                        <Button
                          variant="light"
                          color="gray"
                          size="sm"
                          disabled={ride.owner.id === user?.id}
                          onClick={() =>
                            void mutate(() => api.leaveRide(ride.id), "Je bent afgemeld.")
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
                            void mutate(() => api.joinRide(ride.id), "Je bent aangemeld.")
                          }
                        >
                          {full ? "Vol" : "Aanmelden"}
                        </Button>
                      ))}

                    {ride.can_edit && (
                      <Menu position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon variant="subtle" color="gray" aria-label="Meer acties">
                            <IconDots size={18} />
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
                            onClick={() => void remove(ride)}
                          >
                            Verwijderen
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    )}
                  </Stack>
                </Group>
              </Card>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
