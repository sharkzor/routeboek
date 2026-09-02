import dayjs from "dayjs";

import { RIDE_TYPE_LABELS, type Ride, type WeatherHour } from "../api/types";
import { weatherLabel } from "../components/WeatherStrip";

/** Gedeeld tussen het ritten-overzicht en de rit-detailpagina, zodat het
 *  deelbericht (WhatsApp/Telegram) overal exact hetzelfde formaat heeft. */

/** Open-Meteo voorspelt niet verder dan ~15 dagen vooruit. */
export const FORECAST_HORIZON_DAYS = 15;

export function isWeatherEligible(ride: Ride): boolean {
  const past = dayjs(ride.ride_date).isBefore(dayjs().startOf("day"));
  return (
    !past &&
    ride.route !== null &&
    dayjs(ride.ride_date).diff(dayjs().startOf("day"), "day") <=
      FORECAST_HORIZON_DAYS
  );
}

export function formatRideMoment(ride: Ride): string {
  const day = dayjs(ride.ride_date);
  // Het jaartal alleen tonen als de rit niet in het huidige jaar valt; dat
  // scheelt op mobiel net genoeg ruimte om op één regel te passen.
  const pattern =
    day.year() === dayjs().year() ? "dddd D MMMM" : "dddd D MMMM YYYY";
  return `${day.format(pattern)} · ${ride.ride_time.slice(0, 5)}`;
}

/** Zoekt het weeruur dat het dichtst bij het vertrektijdstip van de rit ligt. */
export function nearestWeatherHour(
  ride: Ride,
  hours: WeatherHour[] | null,
): WeatherHour | null {
  if (!hours || hours.length === 0) return null;
  const target = dayjs(`${ride.ride_date}T${ride.ride_time.slice(0, 5)}`);
  return hours.reduce((closest, hour) => {
    const diff = Math.abs(dayjs(hour.time).diff(target));
    const closestDiff = Math.abs(dayjs(closest.time).diff(target));
    return diff < closestDiff ? hour : closest;
  }, hours[0]);
}

/** Bouwt de deeltekst voor WhatsApp/Telegram, naar het formaat van het oude
 *  routeboek.cc (naam, wegkapitein, datum/tijd, kerngegevens, weer en
 *  opmerkingen, met de link naar de rit-detailpagina onderaan). De link
 *  wijst bewust naar de rit zelf, niet de route: wie 'm opent moet meteen
 *  kunnen zien wie er meegaan en zich kunnen aan-/afmelden. */
export function buildShareText(
  ride: Ride,
  hours: WeatherHour[] | null,
): string {
  const weatherHour = nearestWeatherHour(ride, hours);
  const lines: string[] = [ride.name, `🚴 ${ride.owner.display_name}`];
  lines.push(`📅 ${dayjs(ride.ride_date).format("dddd D MMMM")}`);
  lines.push(`⏰ ${ride.ride_time.slice(0, 5)}`);
  if (ride.distance_km !== null) {
    lines.push(
      `🏁 ${ride.distance_km.toLocaleString("nl-NL", { maximumFractionDigits: 1 })} km`,
    );
  }
  if (ride.speed_kmh !== null) {
    lines.push(`🐢 ${ride.speed_kmh.toFixed(0)} km/u`);
  }
  lines.push(`🚴‍ Max. ${ride.max_participants}`);
  lines.push(`🚲 ${RIDE_TYPE_LABELS[ride.ride_type]}`);
  if (weatherHour) {
    lines.push(
      `☁️ ${weatherLabel(weatherHour.weather_code, weatherHour.is_day)}, ${Math.round(weatherHour.temp_c)}° · ${weatherHour.wind_compass} ${weatherHour.wind_beaufort} Bft`,
    );
  }
  if (ride.notes_html.trim()) {
    lines.push(`💬 ${ride.notes_html.trim()}`);
  }
  lines.push("");
  lines.push(`📈 ${window.location.origin}/ritten/${ride.id}`);
  return lines.join("\n");
}

/** Kopieert tekst naar het klembord, met een fallback voor browsers/omgevingen
 *  zonder (toegang tot de) Clipboard API. */
export async function shareText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}
