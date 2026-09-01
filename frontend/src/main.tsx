import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { DatesProvider } from "@mantine/dates";
import dayjs from "dayjs";
import "dayjs/locale/nl";

import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import "./styles.css";

import { AuthProvider } from "./auth/AuthContext";
import { RequireAdmin, RequireAuth } from "./components/Guards";
import AppLayout from "./components/AppLayout";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import VerifyPage from "./pages/VerifyPage";
import RoutesPage from "./pages/RoutesPage";
import RouteDetailPage from "./pages/RouteDetailPage";
import RidesPage from "./pages/RidesPage";
import RideFormPage from "./pages/RideFormPage";
import CommunityRoutesPage from "./pages/CommunityRoutesPage";
import NewCommunityRoutePage from "./pages/NewCommunityRoutePage";
import AdminPage from "./pages/AdminPage";
import AccountPage from "./pages/AccountPage";
import { theme } from "./theme";

dayjs.locale("nl");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <DatesProvider settings={{ locale: "nl", firstDayOfWeek: 1, weekendDays: [0, 6] }}>
        <Notifications position="top-right" />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/inloggen" element={<LoginPage />} />
              <Route path="/registreren" element={<RegisterPage />} />
              <Route path="/wachtwoord-vergeten" element={<ForgotPasswordPage />} />
              <Route path="/wachtwoord-herstellen" element={<ResetPasswordPage />} />
              <Route path="/verifieren" element={<VerifyPage />} />

              <Route
                element={
                  <RequireAuth>
                    <AppLayout />
                  </RequireAuth>
                }
              >
                <Route path="/" element={<RoutesPage />} />
                <Route path="/routes" element={<RoutesPage />} />
                <Route path="/routes/:routeId" element={<RouteDetailPage />} />
                <Route path="/ritten" element={<RidesPage />} />
                <Route path="/ritten/nieuw" element={<RideFormPage />} />
                <Route path="/ritten/:rideId/bewerken" element={<RideFormPage />} />
                <Route path="/community" element={<CommunityRoutesPage />} />
                <Route path="/community/nieuw" element={<NewCommunityRoutePage />} />
                <Route path="/account" element={<AccountPage />} />
                <Route
                  path="/beheer"
                  element={
                    <RequireAdmin>
                      <AdminPage />
                    </RequireAdmin>
                  }
                />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </DatesProvider>
    </MantineProvider>
  </StrictMode>,
);
