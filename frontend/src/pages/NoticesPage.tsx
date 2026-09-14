/**
 * Overzicht van werkzaamheden en bijzonderheden bij routes.
 *
 * Verlopen meldingen komen hier niet meer voorbij: de server filtert ze eruit
 * zodra de einddatum voorbij is en ruimt ze 's nachts definitief op.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Menu,
  Modal,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconBarrierBlock,
  IconDots,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { Link, useNavigate } from "react-router";

import { ApiError, api } from "../api/client";
import { NoticeBadges, noticePeriod } from "../components/NoticeBadges";
import type { Notice } from "../api/types";

export default function NoticesPage() {
  const navigate = useNavigate();
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Notice | null>(null);
  const [deleteOpened, deleteModal] = useDisclosure(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    api
      .notices()
      .then(setNotices)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "Meldingen laden is mislukt."),
      );
  }, []);

  useEffect(load, [load]);

  const confirmDelete = (notice: Notice) => {
    setToDelete(notice);
    deleteModal.open();
  };

  const remove = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.deleteNotice(toDelete.id);
      notifications.show({ message: "De melding is verwijderd.", color: "green" });
      load();
    } catch (err) {
      notifications.show({
        message: err instanceof ApiError ? err.message : "Verwijderen is mislukt.",
        color: "red",
      });
    } finally {
      setDeleting(false);
      deleteModal.close();
      setToDelete(null);
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
        <div>
          <Title order={2}>Werkzaamheden</Title>
          <Text c="dimmed" size="sm" mt={4}>
            Wegwerkzaamheden, gevaarlijke situaties en andere bijzonderheden op onze routes.
            Een melding verdwijnt vanzelf zodra de einddatum verstreken is.
          </Text>
        </div>
        <Button
          leftSection={<IconPlus size={18} />}
          color="routeboek"
          onClick={() => navigate("/werkzaamheden/nieuw")}
        >
          Melding toevoegen
        </Button>
      </Group>

      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      {notices === null && !error && (
        <Center h={160}>
          <Loader color="routeboek" />
        </Center>
      )}

      {notices !== null && notices.length === 0 && (
        <Card radius="md" withBorder p="xl">
          <Stack gap="xs" align="center">
            <IconBarrierBlock size={34} color="var(--mantine-color-gray-5)" />
            <Text fw={600}>Geen lopende meldingen</Text>
            <Text size="sm" c="dimmed" ta="center">
              Kom je onderweg werkzaamheden, een afsluiting of een gevaarlijke situatie tegen?
              Meld het hier, dan weten je clubgenoten het voordat ze vertrekken.
            </Text>
          </Stack>
        </Card>
      )}

      {notices?.map((notice) => (
        <Card key={notice.id} radius="md" withBorder p="lg">
          <Stack gap="sm">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Stack gap={6}>
                <NoticeBadges notice={notice} />
                <Title order={4}>{notice.title}</Title>
              </Stack>
              {notice.can_edit && (
                <Menu position="bottom-end" withinPortal>
                  <Menu.Target>
                    <ActionIcon variant="subtle" color="gray" aria-label="Meer acties">
                      <IconDots size={18} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item
                      leftSection={<IconPencil size={16} />}
                      onClick={() => navigate(`/werkzaamheden/${notice.id}/bewerken`)}
                    >
                      Bewerken
                    </Menu.Item>
                    <Menu.Item
                      color="red"
                      leftSection={<IconTrash size={16} />}
                      onClick={() => confirmDelete(notice)}
                    >
                      Verwijderen
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              )}
            </Group>

            {notice.description && (
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                {notice.description}
              </Text>
            )}

            <Text size="sm" c="dimmed">
              {noticePeriod(notice)}
              {notice.created_by ? ` · gemeld door ${notice.created_by}` : ""}
            </Text>

            <Group gap={6}>
              <Text size="sm" c="dimmed">
                {notice.routes.length === 1 ? "Route:" : "Routes:"}
              </Text>
              {notice.routes.map((route, index) => (
                <Anchor
                  key={route.id}
                  component={Link}
                  to={`/routes/${route.id}`}
                  size="sm"
                  c="routeboek"
                >
                  {route.name}
                  {index < notice.routes.length - 1 ? "," : ""}
                </Anchor>
              ))}
            </Group>
          </Stack>
        </Card>
      ))}

      <Modal
        opened={deleteOpened}
        onClose={deleteModal.close}
        title="Melding verwijderen"
      >
        <Stack gap="md">
          <Text size="sm">
            Weet je zeker dat je <strong>{toDelete?.title}</strong> wilt verwijderen?
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={deleteModal.close}>
              Annuleren
            </Button>
            <Button color="red" loading={deleting} onClick={() => void remove()}>
              Verwijderen
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
