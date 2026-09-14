/**
 * Gedeelde presentatie van een melding (werkzaamheden/gevaar/bijzonderheid).
 *
 * Staat los van de pagina's zodat zowel het overzicht (`NoticesPage`) als het
 * vak onderaan de routedetailpagina dezelfde badges en looptijd-tekst gebruikt.
 */
import { Badge, Group } from "@mantine/core";
import { IconAlertTriangle, IconBarrierBlock, IconInfoCircle } from "@tabler/icons-react";
import dayjs from "dayjs";
import "dayjs/locale/nl";

import {
  NOTICE_KIND_COLORS,
  NOTICE_KIND_LABELS,
  type Notice,
  type NoticeKind,
} from "../api/types";

dayjs.locale("nl");

const KIND_ICONS: Record<NoticeKind, typeof IconBarrierBlock> = {
  works: IconBarrierBlock,
  hazard: IconAlertTriangle,
  info: IconInfoCircle,
};

/** Looptijd in gewone taal; geplande meldingen tonen ook hun startdatum. */
export function noticePeriod(notice: Notice): string {
  const end = dayjs(notice.end_date).format("D MMMM");
  if (notice.is_active) return `Nog tot en met ${end}`;
  return `Van ${dayjs(notice.start_date).format("D MMMM")} tot en met ${end}`;
}

export function NoticeBadges({ notice }: { notice: Notice }) {
  const Icon = KIND_ICONS[notice.kind];
  return (
    <Group gap={6}>
      <Badge
        color={NOTICE_KIND_COLORS[notice.kind]}
        variant="light"
        leftSection={<Icon size={13} />}
      >
        {NOTICE_KIND_LABELS[notice.kind]}
      </Badge>
      {!notice.is_active && (
        <Badge color="gray" variant="light">
          Gepland
        </Badge>
      )}
    </Group>
  );
}
