export function normalizeCountryName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function buildCountryCanonicalByNormalized(teams: string[]) {
  const map: Record<string, string> = {};
  for (const team of teams) {
    const normalized = normalizeCountryName(team);
    if (!normalized) continue;
    map[normalized] = team;
  }
  return map;
}

export function canonicalizeCountryName(value: string, canonicalByNormalized: Record<string, string>) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const normalized = normalizeCountryName(trimmed);
  if (!normalized) return "";

  return canonicalByNormalized[normalized] ?? trimmed;
}
