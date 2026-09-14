/**
 * Tabblad "Backup" op de beheerpagina.
 *
 * Toont de aanwezige backups, laat er handmatig een maken, downloaden,
 * verwijderen, uploaden en terugzetten. Een restore is onomkeerbaar en start
 * de container opnieuw op, dus zit er een bevestiging met overtypen achter en
 * pollt de pagina daarna `/api/health` tot de app weer antwoordt.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  FileInput,
  Group,
  Loader,
  Modal,
  Progress,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
  ActionIcon,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconDatabaseExport,
  IconDownload,
  IconRestore,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import dayjs from "dayjs";

import { ApiError, api } from "../../api/client";
import type { Backup, BackupJob, BackupList } from "../../api/types";

const KIND_LABELS: Record<string, string> = {
  auto: "nachtelijk",
  weekly: "wekelijks",
  manual: "handmatig",
};

const KIND_COLORS: Record<string, string> = {
  auto: "blue",
  weekly: "grape",
  manual: "teal",
};

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

export default function BackupTab() {
  const [data, setData] = useState<BackupList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<BackupJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<File | null>(null);
  const [target, setTarget] = useState<Backup | null>(null);
  const [confirm, setConfirm] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [opened, { open, close }] = useDisclosure(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.backups();
      setData(next);
      setJob(next.job);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Laden mislukt.");
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [load]);

  // Zolang er een taak loopt elke 2 s de voortgang ophalen.
  useEffect(() => {
    if (job?.state !== "running") return;
    const id = window.setInterval(async () => {
      try {
        const next = await api.backupJob();
        setJob(next);
        if (next && next.state !== "running") {
          window.clearInterval(id);
          await load();
          notifications.show({
            color: next.state === "error" ? "red" : "green",
            message:
              next.state === "error"
                ? (next.error ?? "De taak is mislukt.")
                : next.message || "Klaar.",
          });
        }
      } catch {
        // Tijdens een restore gaat de server bewust onderuit; dat vangt de
        // wachtscherm-poller hieronder op.
      }
    }, 2000);
    timer.current = id;
    return () => window.clearInterval(id);
  }, [job?.state, load]);

  async function makeBackup(includeMedia: boolean) {
    setBusy(true);
    try {
      setJob(await api.createBackup(includeMedia));
    } catch (err) {
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : "Backup starten mislukt.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function doUpload() {
    if (!upload) return;
    setBusy(true);
    try {
      await api.uploadBackup(upload);
      setUpload(null);
      await load();
      notifications.show({ color: "green", message: "Het backupbestand staat klaar." });
    } catch (err) {
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : "Uploaden mislukt.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove(name: string) {
    try {
      await api.deleteBackup(name);
      await load();
    } catch (err) {
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : "Verwijderen mislukt.",
      });
    }
  }

  async function doRestore() {
    if (!target) return;
    setBusy(true);
    try {
      await api.restoreBackup(target.name);
      close();
      setConfirm("");
      setWaiting(true);
      waitForServer();
    } catch (err) {
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : "Terugzetten mislukt.",
      });
    } finally {
      setBusy(false);
    }
  }

  /** Pollt tot de herstarte container weer antwoordt en laadt dan opnieuw. */
  function waitForServer() {
    const started = Date.now();
    const id = window.setInterval(async () => {
      try {
        const response = await fetch("/api/health");
        if (response.ok && Date.now() - started > 5000) {
          window.clearInterval(id);
          window.location.reload();
        }
      } catch {
        // Server ligt er nog uit; blijven wachten.
      }
      if (Date.now() - started > 180000) {
        window.clearInterval(id);
        setWaiting(false);
        notifications.show({
          color: "orange",
          title: "De app komt niet terug",
          message: "Controleer de containerlogs; de restore kan wel geslaagd zijn.",
          autoClose: false,
        });
      }
    }, 3000);
  }

  if (error) return <Alert color="red">{error}</Alert>;
  if (!data) {
    return (
      <Center py="xl">
        <Loader color="routeboek" />
      </Center>
    );
  }

  const running = job?.state === "running";

  return (
    <Stack gap="lg">
      <Alert color="blue" variant="light">
        Elke nacht om {String(data.backup_hour).padStart(2, "0")}:00 maakt de app
        automatisch een backup van de database. De laatste {data.keep_auto} blijven staan,
        plus {data.keep_weekly} wekelijkse van zondagnacht. Handmatige backups worden nooit
        automatisch opgeruimd. Een backup bevat ook de instellingen en dus de wachtwoorden
        van SMTP en Telegram — bewaar het bestand veilig.
      </Alert>

      <Group>
        <Button
          color="routeboek"
          leftSection={<IconDatabaseExport size={16} />}
          disabled={running || busy}
          onClick={() => makeBackup(false)}
        >
          Backup nu (database)
        </Button>
        <Tooltip label="Duurt langer en levert een bestand van zo'n 140 MB op.">
          <Button
            variant="light"
            leftSection={<IconDatabaseExport size={16} />}
            disabled={running || busy}
            onClick={() => makeBackup(true)}
          >
            Volledige backup incl. media
          </Button>
        </Tooltip>
      </Group>

      {running && job && (
        <Card withBorder radius="md">
          <Text fw={600} mb="xs">
            {job.action === "restore" ? "Bezig met terugzetten" : "Bezig met backuppen"}
          </Text>
          <Progress value={job.progress * 100} color="routeboek" animated mb="xs" />
          <Text size="sm" c="dimmed">
            {job.message}
          </Text>
        </Card>
      )}

      <Card withBorder radius="md" p={0}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Gemaakt</Table.Th>
              <Table.Th>Soort</Table.Th>
              <Table.Th>Inhoud</Table.Th>
              <Table.Th>Grootte</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.items.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Text c="dimmed" ta="center" py="md">
                    Er zijn nog geen backups.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {data.items.map((item) => (
              <Table.Tr key={item.name}>
                <Table.Td>
                  <Text size="sm">{dayjs(item.created_at).format("D MMMM YYYY HH:mm")}</Text>
                  <Text size="xs" c="dimmed" ff="monospace">
                    {item.name}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge variant="light" color={KIND_COLORS[item.kind] ?? "gray"}>
                    {KIND_LABELS[item.kind] ?? item.kind}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{item.has_media ? "database + media" : "database"}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{formatSize(item.size_bytes)}</Text>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end" wrap="nowrap">
                    <Tooltip label="Downloaden">
                      <ActionIcon
                        variant="subtle"
                        component="a"
                        href={api.backupDownloadUrl(item.name)}
                      >
                        <IconDownload size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Terugzetten">
                      <ActionIcon
                        variant="subtle"
                        color="orange"
                        disabled={running}
                        onClick={() => {
                          setTarget(item);
                          setConfirm("");
                          open();
                        }}
                      >
                        <IconRestore size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Verwijderen">
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        disabled={running}
                        onClick={() => void remove(item.name)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Card withBorder radius="md">
        <Title order={4} mb="xs">
          Backup uploaden
        </Title>
        <Text size="sm" c="dimmed" mb="sm">
          Een backupbestand van een andere server toevoegen aan de lijst. Terugzetten doe
          je daarna met de knop in de tabel.
        </Text>
        <Group align="flex-end">
          <FileInput
            placeholder="routeboek-....tar.gz"
            accept=".gz,.tar.gz,application/gzip"
            value={upload}
            onChange={setUpload}
            style={{ flex: 1 }}
          />
          <Button
            variant="light"
            leftSection={<IconUpload size={16} />}
            disabled={!upload || busy}
            onClick={() => void doUpload()}
          >
            Uploaden
          </Button>
        </Group>
      </Card>

      <Modal opened={opened} onClose={close} title="Backup terugzetten" centered>
        <Stack>
          <Alert color="red" icon={<IconAlertTriangle size={16} />}>
            Hiermee wordt de huidige database <strong>volledig gewist</strong> en vervangen
            door de inhoud van deze backup. Alles wat sindsdien is toegevoegd — ritten,
            reacties, nieuwe leden — gaat verloren. Daarna herstart de applicatie zichzelf.
          </Alert>
          {target && (
            <Text size="sm">
              Terug te zetten: <strong>{target.name}</strong> van{" "}
              {dayjs(target.created_at).format("D MMMM YYYY HH:mm")}.
            </Text>
          )}
          <TextInput
            label="Typ TERUGZETTEN om te bevestigen"
            value={confirm}
            onChange={(e) => setConfirm(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              Annuleren
            </Button>
            <Button
              color="red"
              loading={busy}
              disabled={confirm.trim().toUpperCase() !== "TERUGZETTEN"}
              onClick={() => void doRestore()}
            >
              Definitief terugzetten
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={waiting}
        onClose={() => undefined}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        centered
        title="Bezig met terugzetten"
      >
        <Stack align="center" py="md">
          <Loader color="routeboek" />
          <Text ta="center">
            De backup wordt teruggezet en de applicatie herstart. Deze pagina laadt vanzelf
            opnieuw zodra de app weer bereikbaar is.
          </Text>
        </Stack>
      </Modal>
    </Stack>
  );
}
