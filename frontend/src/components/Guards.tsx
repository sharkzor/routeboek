import { Center, Loader } from "@mantine/core";
import { Navigate, useLocation } from "react-router";
import type { ReactNode } from "react";

import { useAuth } from "../auth/AuthContext";

/** Laat kinderen alleen zien aan een ingelogde gebruiker. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <Center h="100vh">
        <Loader color="routeboek" />
      </Center>
    );
  }
  if (!user) {
    // Onthoud waar de bezoeker heen wilde, zodat we na inloggen terug kunnen.
    return <Navigate to="/inloggen" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user?.is_admin) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
