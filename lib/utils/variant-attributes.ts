/**
 * Human-readable variant attributes (size / colour / …) from the free-form
 * JSON stored on variants.attributes.
 *
 * The catalog writes attribute keys with inconsistent casing ("size",
 * "Size", "Color"), so keys are matched case-insensitively. Order items
 * historically exposed only the SKU string — and a stored variant_name
 * that literally repeats the SKU — leaving staff to decode size/colour
 * from the SKU while packing (S5-1). This helper is the single place
 * that turns the JSON into readable fields.
 */

export interface VariantAttributeView {
  size: string | null;
  color: string | null;
  /** Composed one-line label, e.g. "Size XL (44) · Color Maroon". */
  label: string | null;
  /** The full attribute set with original keys, for generic display. */
  all: Record<string, string>;
}

export function parseVariantAttributes(
  attributes: unknown
): VariantAttributeView {
  const all: Record<string, string> = {};
  if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
    for (const [key, value] of Object.entries(attributes as Record<string, unknown>)) {
      if (value === null || value === undefined) continue;
      const text = String(value).trim();
      if (text) all[key] = text;
    }
  }

  const byLowerKey = new Map<string, string>();
  for (const [key, value] of Object.entries(all)) {
    byLowerKey.set(key.toLowerCase(), value);
  }

  const size = byLowerKey.get("size") ?? null;
  const color = byLowerKey.get("color") ?? byLowerKey.get("colour") ?? null;

  const parts: string[] = [];
  if (size) parts.push(`Size ${size}`);
  if (color) parts.push(`Color ${color}`);
  for (const [key, value] of Object.entries(all)) {
    const lk = key.toLowerCase();
    if (lk === "size" || lk === "color" || lk === "colour") continue;
    parts.push(`${key} ${value}`);
  }

  return {
    size,
    color,
    label: parts.length > 0 ? parts.join(" · ") : null,
    all,
  };
}
