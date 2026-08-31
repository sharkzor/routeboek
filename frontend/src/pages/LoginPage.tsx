import { useState } from "react";
import { Alert, Anchor, Button, Group, PasswordInput, Stack, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconAlertCircle } from "@tabler/icons-react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";

import AuthShell from "../components/AuthShell";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const form = useForm({
    initialValues: { email: "", password: "" },
    validate: {
      email: (value) => (/^\S+@\S+\.\S+$/.test(value) ? null : "Vul een geldig e-mailadres in."),
      password: (value) => (value.length > 0 ? null : "Vul je wachtwoord in."),
    },
  });

  if (!loading && user) {
    const from = (location.state as { from?: string } | null)?.from ?? "/";
    return <Navigate to={from} replace />;
  }

  const submit = form.onSubmit(async (values) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await login(values.email.trim(), values.password);
      navigate((location.state as { from?: string } | null)?.from ?? "/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Inloggen is mislukt.");
    } finally {
      setBusy(false);
    }
  });

  const resend = async () => {
    const email = form.values.email.trim();
    if (!email) {
      setError("Vul eerst je e-mailadres in.");
      return;
    }
    const response = await api.resendVerification(email);
    setError(null);
    setNotice(response.detail);
  };

  return (
    <AuthShell
      title="Inloggen"
      subtitle="Welkom terug bij het routeboek van Maximus Stampers."
      footer={
        <Anchor component={Link} to="/registreren" c="white" fw={600} underline="always">
          Nog geen account? Registreer je hier
        </Anchor>
      }
    >
      <form onSubmit={submit}>
        <Stack gap="md">
          {error && (
            <Alert color="red" icon={<IconAlertCircle size={18} />} variant="light">
              {error}
              {error.includes("bevestigd") && (
                <Anchor component="button" type="button" size="sm" onClick={() => void resend()} display="block" mt={6}>
                  Stuur de bevestigingsmail opnieuw
                </Anchor>
              )}
            </Alert>
          )}
          {notice && (
            <Alert color="green" variant="light">
              {notice}
            </Alert>
          )}

          <TextInput
            label="E-mailadres"
            placeholder="jij@voorbeeld.nl"
            autoComplete="username"
            required
            {...form.getInputProps("email")}
          />
          <PasswordInput
            label="Wachtwoord"
            placeholder="Je wachtwoord"
            autoComplete="current-password"
            required
            {...form.getInputProps("password")}
          />

          <Group justify="space-between">
            <Anchor component={Link} to="/wachtwoord-vergeten" size="sm" c="routeboek.6">
              Wachtwoord vergeten?
            </Anchor>
          </Group>

          <Button type="submit" fullWidth loading={busy} color="routeboek">
            Inloggen
          </Button>
        </Stack>
      </form>
    </AuthShell>
  );
}
