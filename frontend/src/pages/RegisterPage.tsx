import { useState } from "react";
import {
  Alert,
  Anchor,
  Button,
  PasswordInput,
  Progress,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconCircleCheck } from "@tabler/icons-react";
import { Link } from "react-router";

import AuthShell from "../components/AuthShell";
import { ApiError, api } from "../api/client";

const MIN_LENGTH = 10;

/** Eenvoudige indicatie van de wachtwoordsterkte; de backend valideert echt. */
export function passwordScore(value: string): number {
  let score = 0;
  if (value.length >= MIN_LENGTH) score += 40;
  if (value.length >= 14) score += 15;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 15;
  if (/\d/.test(value)) score += 15;
  if (/[^A-Za-z0-9]/.test(value)) score += 15;
  return Math.min(score, 100);
}

export default function RegisterPage() {
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const form = useForm({
    initialValues: { email: "", display_name: "", password: "", repeat: "" },
    validate: {
      email: (value) => (/^\S+@\S+\.\S+$/.test(value) ? null : "Vul een geldig e-mailadres in."),
      display_name: (value) =>
        value.trim().length >= 2 ? null : "Vul je naam in zoals clubgenoten je kennen.",
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
      const response = await api.register(
        values.email.trim(),
        values.display_name.trim(),
        values.password,
      );
      setDone(response.detail);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registreren is mislukt.");
    } finally {
      setBusy(false);
    }
  });

  const score = passwordScore(form.values.password);

  return (
    <AuthShell
      title="Registreren"
      subtitle="Maak een account aan om routes te bekijken en ritten te organiseren."
      footer={
        <Anchor component={Link} to="/inloggen" c="white" fw={600} underline="always">
          Heb je al een account? Log in
        </Anchor>
      }
    >
      {done ? (
        <Stack gap="md">
          <Alert color="green" icon={<IconCircleCheck size={18} />} variant="light">
            {done}
          </Alert>
          <Button component={Link} to="/inloggen" variant="light" color="routeboek" fullWidth>
            Terug naar inloggen
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
            <TextInput
              label="Naam"
              placeholder="Voornaam Achternaam"
              required
              {...form.getInputProps("display_name")}
            />
            <TextInput
              label="E-mailadres"
              placeholder="jij@voorbeeld.nl"
              autoComplete="username"
              required
              {...form.getInputProps("email")}
            />
            <Stack gap={4}>
              <PasswordInput
                label="Wachtwoord"
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
              Account aanmaken
            </Button>
          </Stack>
        </form>
      )}
    </AuthShell>
  );
}
