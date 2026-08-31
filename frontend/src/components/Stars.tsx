import { Group, Text } from "@mantine/core";
import { IconStar, IconStarFilled, IconStarHalfFilled } from "@tabler/icons-react";

/** Beoordeling in halve sterren, net als het oude routeboek. */
export default function Stars({
  value,
  count,
  size = 16,
}: {
  value: number | null;
  count?: number;
  size?: number;
}) {
  const rating = value ?? 0;
  return (
    <Group gap={2} wrap="nowrap">
      {[1, 2, 3, 4, 5].map((position) => {
        const color = "#f7b500";
        if (rating >= position - 0.25) {
          return <IconStarFilled key={position} size={size} color={color} />;
        }
        if (rating >= position - 0.75) {
          return <IconStarHalfFilled key={position} size={size} color={color} />;
        }
        return <IconStar key={position} size={size} color="#ced4da" />;
      })}
      {count !== undefined && count > 0 && (
        <Text size="xs" c="dimmed" ml={4}>
          ({count})
        </Text>
      )}
    </Group>
  );
}
