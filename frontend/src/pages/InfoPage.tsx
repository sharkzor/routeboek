import { useEffect, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  List,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconBrandTelegram,
  IconCheck,
  IconExternalLink,
  IconInfoCircle,
} from "@tabler/icons-react";
import { useNavigate } from "react-router";

import { api } from "../api/client";
import type { TelegramStatus } from "../api/types";

export default function InfoPage() {
  const navigate = useNavigate();
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);

  useEffect(() => {
    api.telegramStatus().then(setTelegram).catch(() => {});
  }, []);

  return (
    <Stack gap="lg">
      <Stack gap={2}>
        <Title order={2}>Informatie</Title>
        <Text c="dimmed" size="sm">
          Uitleg over de handige extra's van het routeboek.
        </Text>
      </Stack>

      <Card withBorder radius="md" p="lg">
        <Group gap="xs" mb="xs">
          <IconBrandTelegram size={22} color="#229ED9" />
          <Title order={4}>Telegram-integratie</Title>
          {telegram?.linked && (
            <Badge
              size="sm"
              variant="light"
              color="green"
              leftSection={<IconCheck size={12} />}
            >
              Gekoppeld
            </Badge>
          )}
        </Group>

        {telegram && !telegram.enabled ? (
          <Alert color="gray" variant="light" icon={<IconInfoCircle size={16} />}>
            Telegram is nog niet ingesteld voor deze club. Kom later nog eens
            terug.
          </Alert>
        ) : (
          <Stack gap="md">
            <Text size="sm">
              Nieuwe (niet-privé) ritten worden automatisch geplaatst in het
              clubkanaal op Telegram. Zo blijft iedereen op de hoogte zonder
              zelf steeds het routeboek te hoeven checken.
            </Text>

            <List size="sm" spacing="xs">
              <List.Item>
                Elke nieuwe rit verschijnt met naam, wegkapitein, datum,
                tijd, afstand en type in het kanaal.
              </List.Item>
              <List.Item>
                Wordt een rit gewijzigd of geannuleerd? Dan wordt hetzelfde
                bericht in het kanaal bijgewerkt, in plaats van een nieuw
                bericht te posten.
              </List.Item>
              <List.Item>
                Privé-ritten worden nooit in het kanaal geplaatst.
              </List.Item>
              <List.Item>
                Ben je wegkapitein van een rit? Dan stuurt de bot je, als je
                je account gekoppeld hebt, vlak voor vertrek automatisch een
                privébericht met wie zich heeft aangemeld.
              </List.Item>
            </List>

            {telegram?.channel_invite_link && (
              <Button
                component="a"
                href={telegram.channel_invite_link}
                target="_blank"
                rel="noopener noreferrer"
                color="routeboek"
                leftSection={<IconBrandTelegram size={18} />}
                rightSection={<IconExternalLink size={16} />}
                w="fit-content"
              >
                Word lid van het Telegram-kanaal
              </Button>
            )}

            <Card withBorder radius="md" p="md" bg="gray.0">
              <Stack gap="xs">
                <Text fw={600} size="sm">
                  Account koppelen (alleen nodig voor de wegkapitein-reminder)
                </Text>
                <Text size="sm" c="dimmed">
                  Om zelf berichten van de bot te ontvangen (bijvoorbeeld de
                  deelnemerslijst als je een rit organiseert) koppel je
                  eenmalig je account. Er is geen telefoonnummer nodig: je
                  klikt op een link die de bot voor je klaarzet, opent
                  daarmee een chat met{" "}
                  {telegram?.bot_username ? (
                    <>@{telegram.bot_username}</>
                  ) : (
                    "de bot"
                  )}{" "}
                  en stuurt eenmalig <code>/start</code>. Klaar.
                </Text>
                {telegram?.linked ? (
                  <Text size="sm" c="green">
                    Je account is al gekoppeld
                    {telegram.username ? ` als @${telegram.username}` : ""}.
                  </Text>
                ) : (
                  <Button
                    variant="light"
                    color="routeboek"
                    w="fit-content"
                    onClick={() => navigate("/account")}
                  >
                    Koppel je account via "Mijn account"
                  </Button>
                )}
              </Stack>
            </Card>
          </Stack>
        )}
      </Card>

      <Card withBorder radius="md" p="lg">
        <Title order={4} mb="xs">
          Vragen of problemen?
        </Title>
        <Text size="sm" c="dimmed">
          Neem contact op met een van de beheerders van het routeboek, of
          stel je vraag gewoon in het{" "}
          {telegram?.channel_invite_link ? (
            <Anchor href={telegram.channel_invite_link} target="_blank" rel="noopener noreferrer">
              Telegram-kanaal
            </Anchor>
          ) : (
            "Telegram-kanaal"
          )}
          .
        </Text>
      </Card>
    </Stack>
  );
}
