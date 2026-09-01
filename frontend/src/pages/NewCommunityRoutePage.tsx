import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  FileInput,
  Group,
  MultiSelect,
  Select,
  SegmentedControl,
  Stack,
  Stepper,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowUpRight, IconBike, IconLink, IconUpload } from "@tabler/icons-react";
import { useNavigate } from "react-router";

import { ApiError, api } from "../api/client";
import {
  CATEGORY_LABELS,
  ROUTE_TYPE_LABELS,
  WIND_LABELS,
  type CategoryCode,
  type RouteImportPreview,
  type RouteType,
  type WindCode,
} from "../api/types";

type ImportMethod = "gpx" | "url";

export default function NewCommunityRoutePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  // Stap 1: importeren
  const [method, setMethod] = useState<ImportMethod>("gpx");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RouteImportPreview | null>(null);

  // Stap 2: metadata
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [routeType, setRouteType] = useState<RouteType>("road");
  const [wind, setWind] = useState<WindCode[]>([]);
  const [categories, setCategories] = useState<CategoryCode[]>([]);
  const [strava, setStrava] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const runImport = async () => {
    setImportError(null);
    setImporting(true);
    try {
      const result =
        method === "gpx" && file
          ? await api.importCommunityRouteGpx(file)
          : await api.importCommunityRouteUrl(url.trim());
      setPreview(result);
      setName(result.name ?? "");
      setWind(result.wind_directions);
      setStep(1);
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : "Importeren is mislukt.");
    } finally {
      setImporting(false);
    }
  };

  const canImport = method === "gpx" ? file !== null : url.trim().length > 4;

  const save = async () => {
    if (!preview) return;
    if (name.trim().length < 2) {
      setSaveError("Geef de route een naam.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const route = await api.createCommunityRoute({
        name: name.trim(),
        description_html: description,
        route_type: routeType,
        wind_directions: wind,
        categories,
        strava_url: strava.trim() || null,
        distance_km: preview.distance_km,
        elevation_m: preview.elevation_m,
        coordinates: preview.coordinates,
      });
      notifications.show({
        message: `'${route.name}' staat nu bij Community routes.`,
        color: "green",
      });
      navigate(`/routes/${route.id}`);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Opslaan is mislukt.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="lg" maw={720}>
      <Stack gap={2}>
        <Title order={2}>Route aanleveren</Title>
        <Text c="dimmed" size="sm">
          Deel een eigen route met de club. Een beheerder kan 'm later promoveren
          naar het officiële routeboek.
        </Text>
      </Stack>

      <Card withBorder radius="md" p="lg">
        <Stepper active={step} color="routeboek" onStepClick={setStep} allowNextStepsSelect={false}>
          <Stepper.Step label="Route importeren" description="GPX of link">
            <Stack gap="md" mt="md">
              {importError && (
                <Alert color="red" variant="light">
                  {importError}
                </Alert>
              )}
              <SegmentedControl
                value={method}
                onChange={(value) => setMethod(value as ImportMethod)}
                data={[
                  { value: "gpx", label: "GPX-bestand" },
                  { value: "url", label: "Link (GPX-export)" },
                ]}
              />
              {method === "gpx" ? (
                <FileInput
                  label="GPX-bestand"
                  placeholder="Kies een .gpx bestand"
                  accept=".gpx,application/gpx+xml"
                  leftSection={<IconUpload size={16} />}
                  value={file}
                  onChange={setFile}
                />
              ) : (
                <>
                  <TextInput
                    label="Link naar een GPX-bestand"
                    description="Bijvoorbeeld een 'exporteer als GPX'-link met deelsleutel uit Komoot. Een kale Strava- of Komoot-paginalink werkt niet: die sites tonen de route alleen aan ingelogde gebruikers. Exporteer in dat geval de GPX en upload die hierboven."
                    placeholder="https://..."
                    leftSection={<IconLink size={16} />}
                    value={url}
                    onChange={(event) => setUrl(event.currentTarget.value)}
                  />
                </>
              )}
              <Group justify="flex-end">
                <Button
                  color="routeboek"
                  loading={importing}
                  disabled={!canImport}
                  onClick={() => void runImport()}
                >
                  Route importeren
                </Button>
              </Group>
            </Stack>
          </Stepper.Step>

          <Stepper.Step label="Gegevens invullen" description="Naam, wind, categorie">
            <Stack gap="md" mt="md">
              {saveError && (
                <Alert color="red" variant="light">
                  {saveError}
                </Alert>
              )}
              {preview && (
                <Group gap="lg">
                  <Badge
                    variant="light"
                    color="routeboek"
                    size="lg"
                    leftSection={<IconBike size={14} />}
                  >
                    {preview.distance_km.toFixed(1)} km
                  </Badge>
                  <Badge
                    variant="light"
                    color="routeboek"
                    size="lg"
                    leftSection={<IconArrowUpRight size={14} />}
                  >
                    {preview.elevation_m} hm
                  </Badge>
                  <Text size="xs" c="dimmed">
                    Berekend uit de GPX, {preview.coordinates.length} punten.
                  </Text>
                </Group>
              )}
              <TextInput
                label="Naam"
                required
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
              <Textarea
                label="Beschrijving"
                autosize
                minRows={3}
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
              />
              <Select
                label="Soort route"
                data={(Object.keys(ROUTE_TYPE_LABELS) as RouteType[]).map((value) => ({
                  value,
                  label: ROUTE_TYPE_LABELS[value],
                }))}
                value={routeType}
                allowDeselect={false}
                onChange={(value) => setRouteType((value ?? "road") as RouteType)}
              />
              <MultiSelect
                label="Windrichtingen"
                description={
                  wind.length > 0 && preview?.wind_directions.length
                    ? "Al ingeschat op basis van de route; pas aan indien nodig."
                    : "Bij welke wind is deze route fijn?"
                }
                data={(Object.keys(WIND_LABELS) as WindCode[]).map((value) => ({
                  value,
                  label: WIND_LABELS[value],
                }))}
                value={wind}
                onChange={(value) => setWind(value as WindCode[])}
              />
              <MultiSelect
                label="Aanbevolen voor"
                data={(Object.keys(CATEGORY_LABELS) as CategoryCode[]).map((value) => ({
                  value,
                  label: CATEGORY_LABELS[value],
                }))}
                value={categories}
                onChange={(value) => setCategories(value as CategoryCode[])}
              />
              <TextInput
                label="Strava-link (optioneel)"
                placeholder="https://www.strava.com/routes/..."
                value={strava}
                onChange={(event) => setStrava(event.currentTarget.value)}
              />
              <Group justify="flex-end">
                <Button variant="subtle" color="gray" onClick={() => setStep(0)}>
                  Terug
                </Button>
                <Button color="routeboek" loading={saving} onClick={() => void save()}>
                  Route aanleveren
                </Button>
              </Group>
            </Stack>
          </Stepper.Step>
        </Stepper>
      </Card>
    </Stack>
  );
}
