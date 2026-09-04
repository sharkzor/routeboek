import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  PasswordInput,
  Progress,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconBrandTelegram } from "@tabler/icons-react";
import dayjs from "dayjs";

import { ApiError, api } from "../api/client";
import type { TelegramStatus } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { passwordScore } from "./RegisterPage";

const MIN_LENGTH = 10;
const POLL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export default function AccountPage() {
  const { user, refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const form = useForm({
    initialValues: { current_password: "", new_password: "", repeat: "" },
    validate: {
      current_password: (value) => (value ? null : "Vul je huidige wachtwoord in."),
      new_password: (value) =>
        value.length >= MIN_LENGTH
          ? /^\d+$/.test(value) || /^[A-Za-z]+$/.test(value)
            ? "Combineer letters met cijfers of leestekens."
            : null
          : `Gebruik minimaal ${MIN_LENGTH} tekens.`,
      repeat: (value, values) =>
        value === values.new_password ? null : "De wachtwoorden zijn niet gelijk.",
    },
  });

  const submit = form.onSubmit(async (values) => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.changePassword(values.current_password, values.new_password);
      notifications.show({ message: response.detail, color: "green" });
      form.reset();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Wijzigen is mislukt.");
    } finally {
      setBusy(false);
    }
  });

  const score = passwordScore(form.values.new_password);

  // ---------------------------------------------------------- Telegram

  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const pollRef = useRef<{ interval: number; timeout: number } | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current.interval);
      window.clearTimeout(pollRef.current.timeout);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    api.telegramStatus().then(setTelegram).catch(() => {});
    return stopPolling;
  }, []);

  const linkTelegram = async () => {
    setLinking(true);
    try {
      const { link } = await api.telegramLink();
      window.open(link, "_blank", "noopener,noreferrer");
      notifications.show({
        message: "Open de link in Telegram en stuur /start om te koppelen.",
        color: "blue",
      });
      stopPolling();
      const interval = window.setInterval(async () => {
        const status = await api.telegramStatus().catch(() => null);
        if (status?.linked) {
          setTelegram(status);
          setLinking(false);
          stopPolling();
          notifications.show({ message: "Telegram gekoppeld!", color: "green" });
        }
      }, POLL_MS);
      const timeout = window.setTimeout(() => {
        stopPolling();
        setLinking(false);
      }, POLL_TIMEOUT_MS);
      pollRef.current = { interval, timeout };
    } catch (err) {
      setLinking(false);
      notifications.show({
        message: err instanceof ApiError ? err.message : "Koppelen is mislukt.",
        color: "red",
      });
    }
  };

  const unlinkTelegram = async () => {
    setUnlinking(true);
    try {
      await api.telegramUnlink();
      setTelegram((prev) =>
        prev ? { ...prev, linked: false, username: null, linked_at: null } : prev,
      );
      notifications.show({ message: "Telegram-koppeling verwijderd.", color: "green" });
    } catch {
      notifications.show({ message: "Ontkoppelen is mislukt.", color: "red" });
    } finally {
      setUnlinking(false);
    }
  };

  return (
    <Stack gap="lg" maw={620}>
      <Title order={2}>Mijn account</Title>

      <Card withBorder radius="md" p="lg">
        <Stack gap={6}>
          <Group justify="space-between">
            <Text fw={700} fz="lg">
              {user?.display_name}
            </Text>
            {user?.is_admin && (
              <Badge color="routeboek" variant="light">
                Beheerder
              </Badge>
            )}
          </Group>
          <Text size="sm" c="dimmed">
            {user?.email}
          </Text>
          <Text size="sm" c="dimmed">
            Lid sinds {dayjs(user?.created_at).format("D MMMM YYYY")}
            {user?.last_login_at &&
              ` · laatst ingelogd ${dayjs(user.last_login_at).format("D MMMM YYYY HH:mm")}`}
          </Text>
        </Stack>
      </Card>

      <Card withBorder radius="md" p="lg">
        <Title order={4} mb="md">
          Wachtwoord wijzigen
        </Title>
        <form onSubmit={submit}>
          <Stack gap="md">
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}
            <PasswordInput
              label="Huidig wachtwoord"
              autoComplete="current-password"
              required
              {...form.getInputProps("current_password")}
            />
            <Stack gap={4}>
              <PasswordInput
                label="Nieuw wachtwoord"
                autoComplete="new-password"
                required
                {...form.getInputProps("new_password")}
              />
              {form.values.new_password.length > 0 && (
                <Progress
                  value={score}
                  size="xs"
                  color={score < 55 ? "red" : score < 80 ? "yellow" : "green"}
                />
              )}
            </Stack>
            <PasswordInput
              label="Herhaal nieuw wachtwoord"
              autoComplete="new-password"
              required
              {...form.getInputProps("repeat")}
            />
            <Text size="xs" c="dimmed">
              Na het wijzigen blijf je hier ingelogd; andere apparaten worden uitgelogd.
            </Text>
            <Button type="submit" color="routeboek" loading={busy} w="fit-content">
              Wachtwoord wijzigen
            </Button>
          </Stack>
        </form>
      </Card>

      <Card withBorder radius="md" p="lg">
        <Title order={4} mb="md">
          Telegram koppelen
        </Title>
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Koppel je Telegram-account om als wegkapitein vlak voor vertrek
            automatisch de deelnemerslijst van je rit te ontvangen.
          </Text>
          {telegram?.linked ? (
            <Group justify="space-between" wrap="wrap">
              <Group gap="xs">
                <IconBrandTelegram size={20} color="#229ED9" />
                <Text size="sm">
                  Gekoppeld{telegram.username ? ` als @${telegram.username}` : ""}
                  {telegram.linked_at &&
                    ` · sinds ${dayjs(telegram.linked_at).format("D MMMM YYYY")}`}
                </Text>
              </Group>
              <Button
                variant="light"
                color="gray"
                size="xs"
                loading={unlinking}
                onClick={unlinkTelegram}
              >
                Ontkoppelen
              </Button>
            </Group>
          ) : (
            <Button
              variant="light"
              color="routeboek"
              leftSection={<IconBrandTelegram size={18} />}
              loading={linking}
              onClick={linkTelegram}
              w="fit-content"
            >
              Koppel Telegram
            </Button>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
