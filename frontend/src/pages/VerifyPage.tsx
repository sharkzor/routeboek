import { useEffect, useRef, useState } from "react";
import { Alert, Button, Center, Loader, Stack } from "@mantine/core";
import { IconCircleCheck } from "@tabler/icons-react";
import { Link, useSearchParams } from "react-router";

import AuthShell from "../components/AuthShell";
import { ApiError, api } from "../api/client";

export default function VerifyPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"busy" | "ok" | "error">("busy");
  const [message, setMessage] = useState("");
  // React 19 draait effects in StrictMode dubbel; het token is eenmalig bruikbaar.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!token) {
      setState("error");
      setMessage("Deze link is niet compleet. Vraag een nieuwe bevestigingsmail aan.");
      return;
    }
    api
      .verifyEmail(token)
      .then((response) => {
        setState("ok");
        setMessage(response.detail);
      })
      .catch((err: unknown) => {
        setState("error");
        setMessage(
          err instanceof ApiError ? err.message : "Bevestigen is mislukt. Probeer het opnieuw.",
        );
      });
  }, [token]);

  return (
    <AuthShell title="E-mailadres bevestigen">
      <Stack gap="md">
        {state === "busy" && (
          <Center py="lg">
            <Loader color="routeboek" />
          </Center>
        )}
        {state === "ok" && (
          <>
            <Alert color="green" icon={<IconCircleCheck size={18} />} variant="light">
              {message}
            </Alert>
            <Button component={Link} to="/inloggen" color="routeboek" fullWidth>
              Naar inloggen
            </Button>
          </>
        )}
        {state === "error" && (
          <>
            <Alert color="red" variant="light">
              {message}
            </Alert>
            <Button component={Link} to="/inloggen" variant="light" color="routeboek" fullWidth>
              Terug naar inloggen
            </Button>
          </>
        )}
      </Stack>
    </AuthShell>
  );
}
