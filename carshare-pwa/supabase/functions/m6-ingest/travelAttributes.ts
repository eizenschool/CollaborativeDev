type Details = Record<string, any>;

const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4
};

export function priceLevelNumber(value: unknown) {
  return typeof value === "string" && value in PRICE_LEVELS ? PRICE_LEVELS[value] : null;
}

function anyTrue(value: unknown) {
  return Boolean(value) && typeof value === "object"
    && Object.values(value as Record<string, unknown>).some((item) => item === true);
}

export function travelAttributesFor(details: Details, observedAt = new Date().toISOString()) {
  const accessibility = details.accessibilityOptions || {};
  const provenance = (field: string, confidence = "high") => ({
    source: "google_places_details", observedAt, confidence, field
  });
  const rows: Record<string, unknown> = {
    price_level: priceLevelNumber(details.priceLevel),
    opening_hours: details.regularOpeningHours || {},
    indoor_outdoor: details.outdoorSeating === true ? "mixed" : "unknown",
    suitable_for_children: typeof details.goodForChildren === "boolean" ? details.goodForChildren : null,
    suitable_for_groups: typeof details.goodForGroups === "boolean" ? details.goodForGroups : null,
    has_restroom: typeof details.restroom === "boolean" ? details.restroom : null,
    has_parking: details.parkingOptions ? anyTrue(details.parkingOptions) : null,
    wheelchair_accessible: typeof accessibility.wheelchairAccessibleEntrance === "boolean"
      ? accessibility.wheelchairAccessibleEntrance : null,
    enriched_at: observedAt,
    updated_at: observedAt
  };
  rows.field_provenance = {
    price_level: rows.price_level === null ? null : provenance("priceLevel"),
    opening_hours: Object.keys(rows.opening_hours as object).length ? provenance("regularOpeningHours") : null,
    indoor_outdoor: rows.indoor_outdoor === "mixed" ? provenance("outdoorSeating", "medium") : null,
    suitable_for_children: rows.suitable_for_children === null ? null : provenance("goodForChildren"),
    suitable_for_groups: rows.suitable_for_groups === null ? null : provenance("goodForGroups"),
    has_restroom: rows.has_restroom === null ? null : provenance("restroom"),
    has_parking: rows.has_parking === null ? null : provenance("parkingOptions"),
    wheelchair_accessible: rows.wheelchair_accessible === null ? null : provenance("accessibilityOptions.wheelchairAccessibleEntrance")
  };
  return rows;
}

