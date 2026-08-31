import { Box, Image, Stack, Text } from "@mantine/core";

/**
 * Merknaam van de app: "Stampers Routeboek".
 *
 * Het clublogo is zwarte lijntekening met transparantie; met een CSS-filter
 * maken we er een witte versie van voor de rode achtergronden, zodat er maar
 * één afbeelding beheerd hoeft te worden.
 */
export default function BrandLogo({
  variant = "dark",
  layout = "inline",
  height = 30,
}: {
  variant?: "light" | "dark";
  layout?: "inline" | "stacked" | "banner";
  height?: number;
}) {
  const color = variant === "light" ? "#fff" : "#1a1a1a";

  if (layout === "stacked") {
    return (
      <Stack gap={10} align="center">
        <Image
          src="/brand/stampers-logo.png"
          alt="Maximus Stampers"
          w={170}
          fit="contain"
          style={{
            filter: variant === "light" ? "brightness(0) invert(1)" : "brightness(0)",
          }}
        />
        <Text
          c={color}
          fw={700}
          fz={20}
          lh={1}
          tt="uppercase"
          style={{ letterSpacing: "0.34em", marginRight: "-0.34em" }}
        >
          Routeboek
        </Text>
      </Stack>
    );
  }

  if (layout === "banner") {
    return (
      <Box style={{ display: "flex", alignItems: "center", gap: height * 0.4 }}>
        <Image
          src="/brand/stampers-logo.png"
          alt="Maximus Stampers"
          h={height}
          w="auto"
          fit="contain"
          style={{
            filter: variant === "light" ? "brightness(0) invert(1)" : "brightness(0)",
          }}
        />
        <Text
          c={color}
          fw={700}
          fz={height * 0.42}
          lh={1}
          tt="uppercase"
          style={{ letterSpacing: "0.3em", marginRight: "-0.3em" }}
        >
          Routeboek
        </Text>
      </Box>
    );
  }

  return (
    <Box
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 7,
        lineHeight: 1,
        fontSize: height * 0.62,
      }}
    >
      <Text component="span" inherit c={color} fw={700} style={{ letterSpacing: "-0.02em" }}>
        Stampers
      </Text>
      <Text component="span" inherit c="routeboek.6" fw={500}>
        Routeboek
      </Text>
    </Box>
  );
}
