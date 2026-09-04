import {
  ActionIcon,
  AppShell,
  Avatar,
  Box,
  Burger,
  Container,
  Group,
  Menu,
  NavLink,
  Stack,
  Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconBike,
  IconFlag,
  IconInfoCircle,
  IconLogout,
  IconMap2,
  IconSettings,
  IconShieldCog,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";

import BrandLogo from "./BrandLogo";
import { useAuth } from "../auth/AuthContext";

const NAV_ITEMS = [
  { to: "/", label: "Routes", icon: IconMap2 },
  { to: "/ritten", label: "Ritten", icon: IconBike },
  { to: "/events", label: "Events", icon: IconFlag },
  { to: "/community", label: "Community", icon: IconUsers },
  { to: "/informatie", label: "Informatie", icon: IconInfoCircle },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const [opened, { toggle, close }] = useDisclosure(false);
  const location = useLocation();
  const navigate = useNavigate();

  const initials = (user?.display_name ?? "?")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const isActive = (to: string) =>
    to === "/"
      ? location.pathname === "/" || location.pathname.startsWith("/routes")
      : location.pathname.startsWith(to);

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{
        width: 220,
        breakpoint: "sm",
        collapsed: { mobile: !opened, desktop: true },
      }}
      padding={0}
    >
      <AppShell.Header withBorder={false} bg="white">
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="lg" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Link
              to="/"
              style={{ display: "flex", alignItems: "center", textDecoration: "none" }}
            >
              <BrandLogo />
            </Link>
            <Group gap="xs" visibleFrom="sm">
              {NAV_ITEMS.map((item) => (
                <Text
                  key={item.to}
                  component={Link}
                  to={item.to}
                  fw={isActive(item.to) ? 700 : 500}
                  c={isActive(item.to) ? "routeboek.6" : "dark.4"}
                  size="sm"
                  style={{ textDecoration: "none" }}
                >
                  {item.label}
                </Text>
              ))}
              {user?.is_admin && (
                <Text
                  component={Link}
                  to="/beheer"
                  fw={isActive("/beheer") ? 700 : 500}
                  c={isActive("/beheer") ? "routeboek.6" : "dark.4"}
                  size="sm"
                  style={{ textDecoration: "none" }}
                >
                  Beheer
                </Text>
              )}
            </Group>
          </Group>

          <Menu shadow="md" width={210} position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" color="routeboek" size="lg" aria-label="Account">
                <Avatar color="routeboek" radius="xl" size={30}>
                  {initials}
                </Avatar>
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>{user?.display_name}</Menu.Label>
              <Menu.Item
                leftSection={<IconUser size={16} />}
                onClick={() => navigate("/account")}
              >
                Mijn account
              </Menu.Item>
              {user?.is_admin && (
                <Menu.Item
                  leftSection={<IconShieldCog size={16} />}
                  onClick={() => navigate("/beheer")}
                >
                  Beheer
                </Menu.Item>
              )}
              <Menu.Divider />
              <Menu.Item
                color="red"
                leftSection={<IconLogout size={16} />}
                onClick={() => void logout()}
              >
                Uitloggen
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <Stack gap={4}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              component={Link}
              to={item.to}
              label={item.label}
              active={isActive(item.to)}
              color="routeboek"
              leftSection={<item.icon size={18} />}
              onClick={close}
            />
          ))}
          {user?.is_admin && (
            <NavLink
              component={Link}
              to="/beheer"
              label="Beheer"
              active={isActive("/beheer")}
              color="routeboek"
              leftSection={<IconSettings size={18} />}
              onClick={close}
            />
          )}
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <Box className="rb-header" h={100}>
          <Container size="xl" h="100%">
            <Box
              h="100%"
              style={{ display: "flex", alignItems: "center" }}
            >
              <BrandLogo variant="light" layout="banner" height={54} />
            </Box>
          </Container>
        </Box>
        <Container size="xl" py="lg">
          <Outlet />
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
