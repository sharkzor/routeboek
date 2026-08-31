import { useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Avatar,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Stack,
  Text,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";

import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import type { Comment } from "../api/types";

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CommentsSection({ routeId }: { routeId: number }) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .comments(routeId)
      .then((result) => {
        if (!cancelled) setComments(result);
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [routeId]);

  const submit = async () => {
    if (!body.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.addComment(routeId, body);
      setComments((prev) => [...(prev ?? []), created]);
      setBody("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reactie plaatsen is mislukt.");
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (commentId: number) => {
    try {
      await api.deleteComment(routeId, commentId);
      setComments((prev) => (prev ?? []).filter((c) => c.id !== commentId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verwijderen is mislukt.");
    }
  };

  return (
    <Card radius="md" withBorder p="lg">
      <Title order={4} mb="sm">
        Reacties
      </Title>

      {comments === null ? (
        <Center py="md">
          <Loader color="routeboek" size="sm" />
        </Center>
      ) : comments.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nog geen reacties. Wees de eerste!
        </Text>
      ) : (
        <Stack gap="md" mb="lg">
          {comments.map((comment) => (
            <Group key={comment.id} align="flex-start" wrap="nowrap" gap="sm">
              <Avatar color="routeboek" radius="xl" size={36}>
                {comment.display_name.slice(0, 1).toUpperCase()}
              </Avatar>
              <Stack gap={2} style={{ flex: 1 }}>
                <Group justify="space-between" wrap="nowrap">
                  <Text fw={600} size="sm">
                    {comment.display_name}
                  </Text>
                  <Group gap={6} wrap="nowrap">
                    <Text size="xs" c="dimmed">
                      {formatDateTime(comment.created_at)}
                    </Text>
                    {(user?.is_admin || comment.is_mine) && (
                      <Tooltip label="Verwijderen">
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="red"
                          onClick={() => remove(comment.id)}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Group>
                </Group>
                <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                  {comment.body}
                </Text>
              </Stack>
            </Group>
          ))}
        </Stack>
      )}

      {error && (
        <Alert color="red" variant="light" mb="sm">
          {error}
        </Alert>
      )}

      <Stack gap="xs">
        <Textarea
          placeholder="Plaats een reactie..."
          autosize
          minRows={2}
          value={body}
          onChange={(event) => setBody(event.currentTarget.value)}
        />
        <Button
          color="routeboek"
          w="fit-content"
          loading={submitting}
          disabled={!body.trim()}
          onClick={submit}
        >
          Plaatsen
        </Button>
      </Stack>
    </Card>
  );
}
