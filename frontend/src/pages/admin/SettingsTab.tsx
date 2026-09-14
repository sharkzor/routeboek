/**
 * Tabblad "Instellingen" op de beheerpagina.
 *
 * Toont de instellingen die in de database staan en dus zonder herstart
 * aanpasbaar zijn. Geheimen worden nooit door de server teruggegeven: daar
 * staat alleen of er iets is ingesteld. Leeg laten betekent daarom
 * "ongewijzigd" — wissen gaat via een aparte knop, zodat een lege invoer niet
 * per ongeluk een werkend SMTP-wachtwoord weggooit.
 */

import { useEffect, useState } from "react";
import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  NumberInput,
  PasswordInput,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconBrandTelegram, IconDeviceFloppy, IconMail, IconTrash } from "@tabler/icons-react";

import { ApiError, api } from "../../api/client";
import type { AppSettings } from "../../api/types";
import { READONLY_LABELS, SETTINGS_SECTIONS, type FieldSpec } from "./settingsFields";

export default function SettingsTab() {
  const [data, setData] = useState<AppSettings | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [cleared, setCleared] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<"mail" | "telegram" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function adopt(next: AppSettings) {
    setData(next);
    setValues({ ...next.values });
    setSecrets({});
    setCleared([]);
  }

  useEffect(() => {
    api
      .settings()
      .then(adopt)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Laden mislukt."));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...values };
      // Alleen ingevulde geheimen meesturen; leeg = ongewijzigd.
      for (const [key, value] of Object.entries(secrets)) {
        if (value.trim()) payload[key] = value;
      }
      const next = await api.saveSettings({ values: payload, clear: cleared });
      adopt(next);
      notifications.show({
        color: "green",
        message: "De instellingen zijn opgeslagen en meteen actief.",
      });
    } catch (err) {
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : "Opslaan mislukt.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function runTest(kind: "mail" | "telegram") {
    setTesting(kind);
    try {
      const result = kind === "mail" ? await api.testMail() : await api.testTelegram();
      notifications.show({ color: "green", message: result.detail });
    } catch (err) {
      notifications.show({
        color: "red",
        title: "De test is mislukt",
        message: err instanceof ApiError ? err.message : "Onbekende fout.",
        autoClose: 10000,
      });
    } finally {
      setTesting(null);
    }
  }

  if (error) return <Alert color="red">{error}</Alert>;
  if (!data) {
    return (
      <Center py="xl">
        <Loader color="routeboek" />
      </Center>
    );
  }

  function field(spec: FieldSpec) {
    if (spec.kind === "secret") {
      const isSet = data!.secrets_set[spec.key] ?? false;
      const willClear = cleared.includes(spec.key);
      return (
        <Stack gap={4} key={spec.key}>
          <PasswordInput
            label={spec.label}
            description={spec.hint}
            placeholder={
              willClear
                ? "Wordt gewist bij opslaan"
                : isSet
                  ? "Ingesteld — laat leeg om ongewijzigd te laten"
                  : "Nog niet ingesteld"
            }
            value={secrets[spec.key] ?? ""}
            disabled={willClear}
            onChange={(e) =>
              setSecrets((prev) => ({ ...prev, [spec.key]: e.currentTarget.value }))
            }
          />
          {isSet && (
            <Group gap="xs">
              <Badge size="sm" variant="light" color={willClear ? "red" : "green"}>
                {willClear ? "wordt gewist" : "ingesteld"}
              </Badge>
              <Anchor
                component="button"
                type="button"
                size="xs"
                c="dimmed"
                onClick={() =>
                  setCleared((prev) =>
                    prev.includes(spec.key)
                      ? prev.filter((k) => k !== spec.key)
                      : [...prev, spec.key],
                  )
                }
              >
                {willClear ? "toch behouden" : "wissen"}
              </Anchor>
            </Group>
          )}
        </Stack>
      );
    }

    if (spec.kind === "switch") {
      return (
        <Switch
          key={spec.key}
          label={spec.label}
          description={spec.hint}
          color="routeboek"
          checked={Boolean(values[spec.key])}
          onChange={(e) =>
            setValues((prev) => ({ ...prev, [spec.key]: e.currentTarget.checked }))
          }
        />
      );
    }

    if (spec.kind === "number") {
      return (
        <NumberInput
          key={spec.key}
          label={spec.label}
          description={spec.hint}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={(values[spec.key] as number) ?? ""}
          onChange={(value) => setValues((prev) => ({ ...prev, [spec.key]: value }))}
        />
      );
    }

    return (
      <TextInput
        key={spec.key}
        label={spec.label}
        description={spec.hint}
        value={(values[spec.key] as string) ?? ""}
        onChange={(e) => setValues((prev) => ({ ...prev, [spec.key]: e.currentTarget.value }))}
      />
    );
  }

  return (
    <Stack gap="lg">
      <Alert color="blue" variant="light">
        Deze instellingen staan in de database en werken direct, zonder de container te
        herstarten. Ze gaan ook mee in een backup — behandel een backupbestand daarom als
        een wachtwoordkluis.
      </Alert>

      <Accordion multiple defaultValue={["general"]} variant="separated">
        {SETTINGS_SECTIONS.map((section) => (
          <Accordion.Item value={section.id} key={section.id}>
            <Accordion.Control>
              <Text fw={600}>{section.title}</Text>
              <Text size="sm" c="dimmed">
                {section.description}
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="md">
                {section.fields.map(field)}
                {section.id === "mail" && (
                  <Group>
                    <Button
                      variant="light"
                      leftSection={<IconMail size={16} />}
                      loading={testing === "mail"}
                      onClick={() => runTest("mail")}
                    >
                      Stuur een testmail naar mijzelf
                    </Button>
                  </Group>
                )}
                {section.id === "telegram" && (
                  <Group>
                    <Button
                      variant="light"
                      leftSection={<IconBrandTelegram size={16} />}
                      loading={testing === "telegram"}
                      onClick={() => runTest("telegram")}
                    >
                      Stuur een testbericht naar het kanaal
                    </Button>
                  </Group>
                )}
                <Text size="xs" c="dimmed">
                  Een test gebruikt de opgeslagen instellingen, niet wat je hierboven net
                  hebt ingetypt. Sla eerst op.
                </Text>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>

      <Group>
        <Button
          color="routeboek"
          leftSection={<IconDeviceFloppy size={16} />}
          loading={saving}
          onClick={save}
        >
          Opslaan
        </Button>
        {cleared.length > 0 && (
          <Text size="sm" c="red">
            <IconTrash size={14} style={{ verticalAlign: "-2px" }} /> {cleared.length} geheim
            {cleared.length === 1 ? "" : "en"} word{cleared.length === 1 ? "t" : "en"} gewist
            bij opslaan.
          </Text>
        )}
      </Group>

      <Card withBorder radius="md">
        <Title order={4} mb="xs">
          Alleen via de omgeving
        </Title>
        <Text size="sm" c="dimmed" mb="sm">
          Deze waarden staan bewust niet in de database. Aanpassen gaat via de
          omgevingsvariabelen van de container (<code>.env</code>), gevolgd door een
          herstart.
        </Text>
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Instelling</Table.Th>
              <Table.Th>Huidige waarde</Table.Th>
              <Table.Th>Waarom niet hier</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {Object.entries(data.readonly).map(([key, value]) => (
              <Table.Tr key={key}>
                <Table.Td>{READONLY_LABELS[key] ?? key}</Table.Td>
                <Table.Td>
                  <Text size="sm" ff="monospace">
                    {value}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {data.readonly_reasons[key] ?? ""}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}
