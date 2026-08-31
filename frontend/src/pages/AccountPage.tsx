import { useState } from "react";
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
import dayjs from "dayjs";

import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { passwordScore } from "./RegisterPage";

const MIN_LENGTH = 10;

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
    </Stack>
  );
}
