import { useState } from "react";
import { Alert, Button, PasswordInput, Progress, Stack, Text } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconCircleCheck } from "@tabler/icons-react";
import { Link, useSearchParams } from "react-router";

import AuthShell from "../components/AuthShell";
import { ApiError, api } from "../api/client";
import { passwordScore } from "./RegisterPage";

const MIN_LENGTH = 10;

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const form = useForm({
    initialValues: { password: "", repeat: "" },
    validate: {
      password: (value) =>
        value.length >= MIN_LENGTH
          ? /^\d+$/.test(value) || /^[A-Za-z]+$/.test(value)
            ? "Combineer letters met cijfers of leestekens."
            : null
          : `Gebruik minimaal ${MIN_LENGTH} tekens.`,
      repeat: (value, values) =>
        value === values.password ? null : "De wachtwoorden zijn niet gelijk.",
    },
  });

  const submit = form.onSubmit(async (values) => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.resetPassword(token, values.password);
      setDone(response.detail);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Instellen is mislukt.");
    } finally {
      setBusy(false);
    }
  });

  const score = passwordScore(form.values.password);

  return (
    <AuthShell
      title="Nieuw wachtwoord"
      subtitle="Kies een nieuw wachtwoord voor je account."
    >
      {!token ? (
        <Stack gap="md">
          <Alert color="red" variant="light">
            Deze link is niet compleet. Vraag een nieuwe herstellink aan.
          </Alert>
          <Button component={Link} to="/wachtwoord-vergeten" variant="light" color="routeboek">
            Nieuwe link aanvragen
          </Button>
        </Stack>
      ) : done ? (
        <Stack gap="md">
          <Alert color="green" icon={<IconCircleCheck size={18} />} variant="light">
            {done}
          </Alert>
          <Button component={Link} to="/inloggen" color="routeboek" fullWidth>
            Naar inloggen
          </Button>
        </Stack>
      ) : (
        <form onSubmit={submit}>
          <Stack gap="md">
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}
            <Stack gap={4}>
              <PasswordInput
                label="Nieuw wachtwoord"
                autoComplete="new-password"
                required
                {...form.getInputProps("password")}
              />
              {form.values.password.length > 0 && (
                <>
                  <Progress
                    value={score}
                    size="xs"
                    color={score < 55 ? "red" : score < 80 ? "yellow" : "green"}
                  />
                  <Text size="xs" c="dimmed">
                    Minimaal {MIN_LENGTH} tekens, met cijfers of leestekens.
                  </Text>
                </>
              )}
            </Stack>
            <PasswordInput
              label="Herhaal wachtwoord"
              autoComplete="new-password"
              required
              {...form.getInputProps("repeat")}
            />
            <Button type="submit" fullWidth loading={busy} color="routeboek">
              Wachtwoord instellen
            </Button>
          </Stack>
        </form>
      )}
    </AuthShell>
  );
}
