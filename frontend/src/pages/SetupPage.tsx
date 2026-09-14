/**
 * Installatiewizard voor een verse omgeving.
 *
 * Verschijnt alleen zolang `GET /api/setup/status` meldt dat de installatie
 * nog open staat: geen enkele gebruiker én `setup_completed` niet gezet. Elke
 * wijzigende stap stuurt daarnaast het setup-token mee, dat bij het opstarten
 * in de containerlogs staat (of via de omgevingsvariabele `SETUP_TOKEN` is
 * gezet).
 *
 * De wizard is bewust kort. Na het aanmaken van het beheerdersaccount is de
 * gebruiker meteen ingelogd en lopen alle overige instellingen via het gewone,
 * geauthenticeerde beheerscherm — dat scheelt een handvol ongeauthenticeerde
 * endpoints die na stap 3 toch dicht zouden moeten.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  Alert,
  Anchor,
  Button,
  Card,
  Center,
  Code,
  FileInput,
  Group,
  Loader,
  PasswordInput,
  Progress,
  Radio,
  Stack,
  Stepper,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertTriangle, IconArrowRight, IconCheck, IconUpload } from "@tabler/icons-react";

import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import AuthShell from "../components/AuthShell";

type Mode = "fresh" | "restore";

export default function SetupPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState(0);
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<Mode>("fresh");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [progressText, setProgressText] = useState("");

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");

  // Een voltooide installatie mag de wizard niet meer tonen.
  useEffect(() => {
    api
      .setupStatus()
      .then((status) => {
        if (!status.required) navigate("/inloggen", { replace: true });
        else setChecking(false);
      })
      .catch(() => navigate("/inloggen", { replace: true }));
  }, [navigate]);

  /** Vertaalt een serverfout naar een begrijpelijke melding. */
  function explain(err: unknown, fallback: string): string {
    if (err instanceof ApiError) {
      if (err.status === 403) {
        return "Het setup-token klopt niet. Ga terug naar stap 1 en kijk het na in de containerlogs.";
      }
      if (err.status === 409) {
        return "Deze installatie is inmiddels al voltooid. Ga naar het inlogscherm.";
      }
      return err.message;
    }
    if (err instanceof Error) return err.message;
    return fallback;
  }

  async function doRestore() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const job = await api.setupRestore(file, token.trim());
      setProgress(job.progress);
      setProgressText(job.message);
      pollRestore();
    } catch (err) {
      setError(explain(err, "Terugzetten mislukt."));
      setBusy(false);
    }
  }

  /** Volgt de restore en stuurt daarna door naar het inlogscherm. */
  function pollRestore() {
    const started = Date.now();
    const id = window.setInterval(async () => {
      try {
        const job = await api.setupRestoreJob();
        if (job) {
          setProgress(job.progress);
          setProgressText(job.message);
          if (job.state === "error") {
            window.clearInterval(id);
            setError(job.error ?? "Het terugzetten is mislukt.");
            setBusy(false);
            return;
          }
        }
        // Na een geslaagde restore herstart de container; zodra hij terug is,
        // is de installatie voltooid en stuurt /setup vanzelf door.
        const status = await api.setupStatus();
        if (!status.required && Date.now() - started > 5000) {
          window.clearInterval(id);
          notifications.show({
            color: "green",
            message: "De backup is teruggezet. Log in met je bestaande account.",
            autoClose: 12000,
          });
          navigate("/inloggen", { replace: true });
        }
      } catch {
        // De server herstart; blijven proberen.
      }
      if (Date.now() - started > 300000) {
        window.clearInterval(id);
        setError("Het terugzetten duurt ongewoon lang. Controleer de containerlogs.");
        setBusy(false);
      }
    }, 3000);
  }

  async function createAdmin() {
    setBusy(true);
    setError(null);
    try {
      if (password !== repeat) throw new Error("De wachtwoorden zijn niet gelijk.");
      await api.setupAdmin(
        { email: email.trim(), display_name: name.trim(), password },
        token.trim(),
      );
      // Het endpoint logt meteen in; de context moet dat alleen nog oppikken.
      await refresh();
      setStep(3);
    } catch (err) {
      setError(explain(err, "Aanmaken mislukt."));
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <Center h="100vh">
        <Loader color="routeboek" />
      </Center>
    );
  }

  return (
    <AuthShell
      title="Installatie"
      subtitle="Deze omgeving is nog niet ingericht. Nog een paar stappen en je bent klaar."
    >
      <Stepper active={step} orientation="vertical" size="sm" color="routeboek" iconSize={28}>
        <Stepper.Step label="Setup-token" description="Bewijs dat je bij de server kunt">
          <Stack gap="sm" pt="sm">
            <Text size="sm" c="dimmed">
              Bij het opstarten zet de applicatie een token in de containerlogs. Haal het
              daar op met <Code>docker compose logs app</Code>, of zet het zelf vooraf met
              de omgevingsvariabele <Code>SETUP_TOKEN</Code>.
            </Text>
            <TextInput
              label="Token"
              placeholder="bijv. b_8TdPWqsqMsf78wKLo_5Tq_OFRlgpTE"
              value={token}
              onChange={(e) => setToken(e.currentTarget.value)}
            />
            {error && <Alert color="red">{error}</Alert>}
            <Text size="xs" c="dimmed">
              Het token wordt bij de eerstvolgende stap gecontroleerd.
            </Text>
            <Button
              color="routeboek"
              disabled={!token.trim()}
              rightSection={<IconArrowRight size={16} />}
              onClick={() => {
                setError(null);
                setStep(1);
              }}
            >
              Verder
            </Button>
          </Stack>
        </Stepper.Step>

        <Stepper.Step label="Wat wil je doen?" description="Nieuw beginnen of herstellen">
          <Stack gap="sm" pt="sm">
            <Radio.Group value={mode} onChange={(value) => setMode(value as Mode)}>
              <Stack gap="xs">
                <Radio
                  value="fresh"
                  color="routeboek"
                  label="Nieuw clubrouteboek inrichten"
                  description="Je maakt een beheerdersaccount aan en vult daarna de instellingen in."
                />
                <Radio
                  value="restore"
                  color="routeboek"
                  label="Backup van een andere server terugzetten"
                  description="Alles komt terug: routes, leden, ritten en instellingen. Dit is het pad om te verhuizen."
                />
              </Stack>
            </Radio.Group>
            <Group>
              <Button variant="default" onClick={() => setStep(0)}>
                Terug
              </Button>
              <Button
                color="routeboek"
                rightSection={<IconArrowRight size={16} />}
                onClick={() => setStep(2)}
              >
                Verder
              </Button>
            </Group>
          </Stack>
        </Stepper.Step>

        <Stepper.Step
          label={mode === "restore" ? "Backup terugzetten" : "Beheerdersaccount"}
          description={
            mode === "restore" ? "Upload het backupbestand" : "Jouw eigen inloggegevens"
          }
        >
          {mode === "restore" ? (
            <Stack gap="sm" pt="sm">
              <Alert color="orange" icon={<IconAlertTriangle size={16} />}>
                De applicatie herstart zichzelf na het terugzetten. Log daarna in met het
                account dat je op de oude server gebruikte.
              </Alert>
              <FileInput
                label="Backupbestand"
                placeholder="routeboek-....tar.gz"
                accept=".gz,.tar.gz,application/gzip"
                value={file}
                onChange={setFile}
              />
              {progress !== null && (
                <Card withBorder radius="md">
                  <Progress value={progress * 100} color="routeboek" animated mb="xs" />
                  <Text size="sm" c="dimmed">
                    {progressText}
                  </Text>
                </Card>
              )}
              {error && <Alert color="red">{error}</Alert>}
              <Group>
                <Button variant="default" disabled={busy} onClick={() => setStep(1)}>
                  Terug
                </Button>
                <Button
                  color="routeboek"
                  leftSection={<IconUpload size={16} />}
                  disabled={!file}
                  loading={busy}
                  onClick={() => void doRestore()}
                >
                  Terugzetten
                </Button>
              </Group>
            </Stack>
          ) : (
            <Stack gap="sm" pt="sm">
              <Text size="sm" c="dimmed">
                Dit account is meteen beheerder en hoeft geen e-mail te bevestigen — de
                mailinstellingen zijn immers nog niet ingevuld.
              </Text>
              <TextInput
                label="E-mailadres"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
              />
              <TextInput
                label="Naam"
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
              />
              <PasswordInput
                label="Wachtwoord"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
              <PasswordInput
                label="Wachtwoord herhalen"
                value={repeat}
                onChange={(e) => setRepeat(e.currentTarget.value)}
              />
              {error && <Alert color="red">{error}</Alert>}
              <Group>
                <Button variant="default" disabled={busy} onClick={() => setStep(1)}>
                  Terug
                </Button>
                <Button
                  color="routeboek"
                  loading={busy}
                  disabled={!email.trim() || !name.trim() || password.length < 8}
                  onClick={() => void createAdmin()}
                >
                  Account aanmaken
                </Button>
              </Group>
            </Stack>
          )}
        </Stepper.Step>

        <Stepper.Completed>
          <Stack gap="sm" pt="sm">
            <Alert color="green" icon={<IconCheck size={16} />}>
              Je bent ingelogd als beheerder. De installatie is nu vergrendeld.
            </Alert>
            <Text size="sm">
              Vul als laatste de instellingen in — in elk geval de e-mailserver, anders
              kunnen nieuwe leden zich niet registreren. Dat doe je op de beheerpagina
              onder <strong>Instellingen</strong>.
            </Text>
            <Button color="routeboek" onClick={() => navigate("/beheer", { replace: true })}>
              Naar de instellingen
            </Button>
            <Center>
              <Anchor size="sm" c="dimmed" onClick={() => navigate("/", { replace: true })}>
                Later doen, ga naar het routeboek
              </Anchor>
            </Center>
          </Stack>
        </Stepper.Completed>
      </Stepper>
    </AuthShell>
  );
}
