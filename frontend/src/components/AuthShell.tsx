import { Box, Center, Image, Paper, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

/** Rode achtergrond met logo; gedeeld door alle in- en uitlogschermen. */
export default function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Box className="rb-auth-page">
      <Stack w="100%" maw={430} gap="md">
        <Center>
          <Image
            src="/brand/routeboek-logo-white.png"
            alt="Routeboek"
            w={220}
            fit="contain"
          />
        </Center>

        <Paper p="xl" radius="md" shadow="lg" bg="white">
          <Stack gap="xs" mb="md">
            <Text fz={24} fw={700} c="routeboek.6">
              {title}
            </Text>
            {subtitle && (
              <Text size="sm" c="dimmed">
                {subtitle}
              </Text>
            )}
          </Stack>
          {children}
        </Paper>

        {footer && <Center>{footer}</Center>}
      </Stack>
    </Box>
  );
}
