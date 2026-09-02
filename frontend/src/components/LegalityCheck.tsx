import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Badge, Group, List, Progress, Stack, Text } from "@mantine/core";
import { IconAlertTriangle, IconShieldCheck } from "@tabler/icons-react";

import { ApiError, api } from "../api/client";
import type { LegalityReport, LegalityStatus } from "../api/types";

const POLL_INTERVAL_MS = 2000;

/**
 * Controle op verboden paden: starten en de voortgang volgen.
 *
 * De controle draait als achtergrondtaak op de server (hij bevraagt
 * OpenStreetMap in stukken), dus starten en resultaat ophalen zijn twee
 * verschillende verzoeken.
 */
export function useLegalityCheck(routeId: number) {
  const [status, setStatus] = useState<LegalityStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => {
    setStatus(null);
    setError(null);
    return stop;
  }, [routeId, stop]);

  const poll = useCallback(() => {
    api
      .legalityStatus(routeId)
      .then((next) => {
        setStatus(next);
        if (next.status === "running") {
          timer.current = window.setTimeout(poll, POLL_INTERVAL_MS);
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Controle ophalen is mislukt.");
      });
  }, [routeId]);

  const start = useCallback(() => {
    stop();
    setError(null);
    setStatus({ status: "running", progress: 0, message: "Starten", error: null, report: null });
    api
      .startLegalityCheck(routeId)
      .then((next) => {
        setStatus(next);
        if (next.status === "running") {
          timer.current = window.setTimeout(poll, POLL_INTERVAL_MS);
        }
      })
      .catch((err: unknown) => {
        setStatus(null);
        setError(err instanceof ApiError ? err.message : "Controle starten is mislukt.");
      });
  }, [poll, routeId, stop]);

  return {
    status,
    error,
    start,
    running: status?.status === "running",
    report: status?.status === "done" ? status.report : null,
  };
}

function SegmentBadge({ severity }: { severity: "forbidden" | "warning" }) {
  return severity === "forbidden" ? (
    <Badge color="pink" variant="filled" size="sm">
      Verboden
    </Badge>
  ) : (
    <Badge color="orange" variant="filled" size="sm">
      Let op
    </Badge>
  );
}

export function LegalityResults({
  status,
  error,
}: {
  status: LegalityStatus | null;
  error: string | null;
}) {
  if (error) {
    return (
      <Alert color="red" variant="light">
        {error}
      </Alert>
    );
  }
  if (status === null) return null;

  if (status.status === "running") {
    return (
      <Stack gap={6}>
        <Text size="sm" c="dimmed">
          {status.message ?? "Bezig met controleren"}
        </Text>
        <Progress
          value={Math.max(4, status.progress * 100)}
          color="routeboek"
          animated
          striped
        />
        <Text size="xs" c="dimmed">
          De kaartgegevens komen van OpenStreetMap. De eerste controle van een route duurt een paar minuten; daarna is het resultaat meteen beschikbaar.
        </Text>
      </Stack>
    );
  }

  if (status.status === "error") {
    return (
      <Alert color="red" variant="light">
        {status.error ?? "De controle is mislukt."}
      </Alert>
    );
  }

  const report: LegalityReport | null = status.report;
  if (report === null) return null;

  if (report.segments.length === 0) {
    return (
      <Alert
        color="green"
        variant="light"
        icon={<IconShieldCheck size={20} />}
        title="Geen verboden paden gevonden"
      >
        Over {report.total_distance_km.toFixed(1)} km is geen enkel stuk gevonden waar fietsen
        volgens OpenStreetMap niet is toegestaan.
      </Alert>
    );
  }

  return (
    <Alert
      color={report.forbidden_count > 0 ? "red" : "orange"}
      variant="light"
      icon={<IconAlertTriangle size={20} />}
      title={
        report.forbidden_count > 0
          ? `${report.forbidden_count} stuk(ken) waar fietsen niet mag`
          : `${report.warning_count} stuk(ken) om op te letten`
      }
    >
      <Stack gap="xs">
        <Text size="sm">
          Op de kaart hierboven staan deze stukken in het rood (verboden) en oranje (let op);
          klik erop voor de bron.
        </Text>
        <List spacing={6} listStyleType="none" pl={0}>
          {report.segments.map((segment, index) => (
            <List.Item key={`${segment.way_id ?? "x"}-${segment.start_km}-${index}`}>
              <Group gap="xs" wrap="nowrap" align="flex-start">
                <SegmentBadge severity={segment.severity} />
                <Text size="sm">
                  <strong>{segment.label}</strong>
                  {segment.way_name ? ` (${segment.way_name})` : ""} — op{" "}
                  {segment.start_km.toFixed(1)} km, {Math.round(segment.length_m)} m lang
                </Text>
              </Group>
            </List.Item>
          ))}
        </List>
        <Text size="xs" c="dimmed">
          Gebaseerd op {report.source}. Een melding betekent niet altijd dat het pad echt
          verboden is; controleer het ter plekke of via de link op de kaart.
        </Text>
      </Stack>
    </Alert>
  );
}
