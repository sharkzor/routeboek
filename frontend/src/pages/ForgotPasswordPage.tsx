import { useState } from "react";
import { Alert, Anchor, Button, Stack, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconMailCheck } from "@tabler/icons-react";
import { Link } from "react-router";

import AuthShell from "../components/AuthShell";
import { ApiError, api } from "../api/client";

export default function ForgotPasswordPage() {
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const form = useForm({
    initialValues: { email: "" },
    validate: {
      email: (value) => (/^\S+@\S+\.\S+$/.test(value) ? null : "Vul een geldig e-mailadres in."),
    },
  });

  const submit = form.onSubmit(async (values) => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.forgotPassword(values.email.trim());
      setDone(response.detail);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Aanvragen is mislukt.");
    } finally {
      setBusy(false);
    }
  });

  return (
    <AuthShell
      title="Wachtwoord vergeten"
      subtitle="Vul je e-mailadres in; je krijgt een link om een nieuw wachtwoord in te stellen."
      footer={
        <Anchor component={Link} to="/inloggen" c="white" fw={600} underline="always">
          Terug naar inloggen
        </Anchor>
      }
    >
      {done ? (
        <Alert color="green" icon={<IconMailCheck size={18} />} variant="light">
          {done}
        </Alert>
      ) : (
        <form onSubmit={submit}>
          <Stack gap="md">
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}
            <TextInput
              label="E-mailadres"
              placeholder="jij@voorbeeld.nl"
              autoComplete="username"
              required
              {...form.getInputProps("email")}
            />
            <Button type="submit" fullWidth loading={busy} color="routeboek">
              Stuur herstellink
            </Button>
          </Stack>
        </form>
      )}
    </AuthShell>
  );
}
