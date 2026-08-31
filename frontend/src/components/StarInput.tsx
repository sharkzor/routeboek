import { useState } from "react";
import { Group } from "@mantine/core";
import { IconStar, IconStarFilled } from "@tabler/icons-react";

/** Klikbare sterren (1-5, gehele getallen) om zelf een route te waarderen. */
export default function StarInput({
  value,
  onChange,
  size = 26,
  disabled,
}: {
  value: number | null;
  onChange: (value: number) => void;
  size?: number;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;

  return (
    <Group gap={4} wrap="nowrap" onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((position) => (
        <span
          key={position}
          role="button"
          aria-label={`${position} ster${position > 1 ? "ren" : ""}`}
          style={{ cursor: disabled ? "default" : "pointer", lineHeight: 0 }}
          onMouseEnter={() => !disabled && setHover(position)}
          onClick={() => !disabled && onChange(position)}
        >
          {shown >= position ? (
            <IconStarFilled size={size} color="#f7b500" />
          ) : (
            <IconStar size={size} color="#ced4da" />
          )}
        </span>
      ))}
    </Group>
  );
}
