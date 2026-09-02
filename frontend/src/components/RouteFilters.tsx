import {
  Button,
  Checkbox,
  Divider,
  NumberInput,
  Paper,
  Radio,
  RangeSlider,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconSearch, IconX } from "@tabler/icons-react";

import {
  CATEGORY_LABELS,
  ROUTE_TYPE_LABELS,
  WIND_LABELS,
  type CategoryCode,
  type RouteFilterState,
  type RouteType,
  type WindCode,
} from "../api/types";

export const EMPTY_FILTERS: RouteFilterState = {
  search: "",
  kmMin: null,
  kmMax: null,
  wind: [],
  routeType: null,
  minRating: null,
  categories: [],
  favorite: null,
  ridden: null,
  sort: "distance_asc",
};

const WIND_ORDER: WindCode[] = ["N", "O", "Z", "W"];
const CATEGORY_ORDER: CategoryCode[] = ["beginners", "high_pace", "tourist"];
const TYPE_ORDER: RouteType[] = ["road", "road_gravel", "gravel"];

export function hasActiveFilters(filters: RouteFilterState): boolean {
  return (
    filters.search !== "" ||
    filters.kmMin !== null ||
    filters.kmMax !== null ||
    filters.wind.length > 0 ||
    filters.routeType !== null ||
    filters.minRating !== null ||
    filters.categories.length > 0 ||
    filters.favorite !== null ||
    filters.ridden !== null
  );
}

export default function RouteFilters({
  value,
  onChange,
  bounds,
}: {
  value: RouteFilterState;
  onChange: (next: RouteFilterState) => void;
  bounds: { min: number; max: number };
}) {
  const patch = (next: Partial<RouteFilterState>) => onChange({ ...value, ...next });

  const sliderValue: [number, number] = [
    value.kmMin ?? bounds.min,
    value.kmMax ?? bounds.max,
  ];

  return (
    <Paper radius="md" p="md" withBorder>
      <Stack gap="md">
        <TextInput
          label="Zoeken"
          placeholder="Naam of plaats"
          leftSection={<IconSearch size={16} />}
          value={value.search}
          onChange={(event) => patch({ search: event.currentTarget.value })}
          rightSection={
            value.search ? (
              <IconX
                size={16}
                style={{ cursor: "pointer" }}
                onClick={() => patch({ search: "" })}
              />
            ) : null
          }
        />

        <Divider />

        <Stack gap={6}>
          <Text size="sm" fw={600}>
            Afstand (km)
          </Text>
          <RangeSlider
            min={bounds.min}
            max={bounds.max}
            step={5}
            minRange={5}
            color="routeboek"
            value={sliderValue}
            onChange={([min, max]) => patch({ kmMin: min, kmMax: max })}
            label={(km) => `${km} km`}
          />
          <Stack gap={6} mt={4}>
            <NumberInput
              size="xs"
              label="Van"
              suffix=" km"
              min={0}
              value={value.kmMin ?? ""}
              onChange={(km) => patch({ kmMin: km === "" ? null : Number(km) })}
            />
            <NumberInput
              size="xs"
              label="Tot"
              suffix=" km"
              min={0}
              value={value.kmMax ?? ""}
              onChange={(km) => patch({ kmMax: km === "" ? null : Number(km) })}
            />
          </Stack>
        </Stack>

        <Divider />

        <Stack gap={8}>
          <Text size="sm" fw={600}>
            Persoonlijk
          </Text>
          <Checkbox
            color="routeboek"
            label="Alleen mijn favorieten"
            checked={value.favorite === true}
            onChange={(event) =>
              patch({ favorite: event.currentTarget.checked ? true : null })
            }
          />
          <Radio.Group
            value={value.ridden === null ? "" : value.ridden ? "yes" : "no"}
            onChange={(choice) =>
              patch({ ridden: choice === "" ? null : choice === "yes" })
            }
          >
            <Stack gap={6}>
              <Radio value="" label="Gereden en ongereden" color="routeboek" />
              <Radio value="yes" label="Alleen al gereden" color="routeboek" />
              <Radio value="no" label="Nog niet gereden" color="routeboek" />
            </Stack>
          </Radio.Group>
        </Stack>

        <Divider />

        <Checkbox.Group
          label="Windrichting"
          description="Routes die bij deze wind fijn fietsen"
          value={value.wind}
          onChange={(wind) => patch({ wind: wind as WindCode[] })}
        >
          <Stack gap={6} mt={8}>
            {WIND_ORDER.map((code) => (
              <Checkbox key={code} value={code} label={WIND_LABELS[code]} color="routeboek" />
            ))}
          </Stack>
        </Checkbox.Group>

        <Divider />

        <Radio.Group
          label="Soort route"
          value={value.routeType ?? ""}
          onChange={(type) => patch({ routeType: type === "" ? null : (type as RouteType) })}
        >
          <Stack gap={6} mt={8}>
            <Radio value="" label="Alle routes" color="routeboek" />
            {TYPE_ORDER.map((type) => (
              <Radio key={type} value={type} label={ROUTE_TYPE_LABELS[type]} color="routeboek" />
            ))}
          </Stack>
        </Radio.Group>

        <Divider />

        <Radio.Group
          label="Minimale beoordeling"
          value={value.minRating === null ? "" : String(value.minRating)}
          onChange={(rating) => patch({ minRating: rating === "" ? null : Number(rating) })}
        >
          <Stack gap={6} mt={8}>
            <Radio value="" label="Alle beoordelingen" color="routeboek" />
            {[4, 3, 2, 1].map((rating) => (
              <Radio
                key={rating}
                value={String(rating)}
                label={`${rating} sterren of meer`}
                color="routeboek"
              />
            ))}
          </Stack>
        </Radio.Group>

        <Divider />

        <Checkbox.Group
          label="Aanbevolen voor"
          value={value.categories}
          onChange={(categories) => patch({ categories: categories as CategoryCode[] })}
        >
          <Stack gap={6} mt={8}>
            {CATEGORY_ORDER.map((code) => (
              <Checkbox
                key={code}
                value={code}
                label={CATEGORY_LABELS[code]}
                color="routeboek"
              />
            ))}
          </Stack>
        </Checkbox.Group>

        <Button
          variant="light"
          color="routeboek"
          leftSection={<IconX size={16} />}
          disabled={!hasActiveFilters(value)}
          onClick={() => onChange({ ...EMPTY_FILTERS, sort: value.sort })}
        >
          Filters wissen
        </Button>
      </Stack>
    </Paper>
  );
}
