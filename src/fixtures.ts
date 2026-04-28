import type { KnockoutMatch, RoundKey, Tournament } from "./types.ts";
import { FIXTURE_KICKOFFS } from "./fixture-kickoffs.ts";
import { KNOCKOUT_KICKOFFS } from "./knockout-kickoffs.ts";

const GROUP_MATCH_PAIRS: Record<string, Array<[string, string]>> = {
  A: [
    ["Mexico", "Sudafrica"],
    ["Corea del Sur", "Republica Checa"],
    ["Republica Checa", "Sudafrica"],
    ["Mexico", "Corea del Sur"],
    ["Republica Checa", "Mexico"],
    ["Sudafrica", "Corea del Sur"]
  ],
  B: [
    ["Canada", "Bosnia Herzegovina"],
    ["Qatar", "Suiza"],
    ["Suiza", "Bosnia Herzegovina"],
    ["Canada", "Qatar"],
    ["Suiza", "Canada"],
    ["Bosnia Herzegovina", "Qatar"]
  ],
  C: [
    ["Brasil", "Marruecos"],
    ["Haiti", "Escocia"],
    ["Escocia", "Marruecos"],
    ["Brasil", "Haiti"],
    ["Escocia", "Brasil"],
    ["Marruecos", "Haiti"]
  ],
  D: [
    ["Estados Unidos", "Paraguay"],
    ["Australia", "Turquía"],
    ["Estados Unidos", "Australia"],
    ["Turquía", "Paraguay"],
    ["Turquía", "Estados Unidos"],
    ["Paraguay", "Australia"]
  ],
  E: [
    ["Alemania", "Curazao"],
    ["Costa de Marfil", "Ecuador"],
    ["Alemania", "Costa de Marfil"],
    ["Ecuador", "Curazao"],
    ["Curazao", "Costa de Marfil"],
    ["Ecuador", "Alemania"]
  ],
  F: [
    ["Países Bajos", "Japón"],
    ["Suecia", "Túnez"],
    ["Países Bajos", "Suecia"],
    ["Túnez", "Japón"],
    ["Japón", "Suecia"],
    ["Túnez", "Países Bajos"]
  ],
  G: [
    ["Bélgica", "Egipto"],
    ["Irán", "Nueva Zelanda"],
    ["Bélgica", "Irán"],
    ["Nueva Zelanda", "Egipto"],
    ["Egipto", "Irán"],
    ["Nueva Zelanda", "Bélgica"]
  ],
  H: [
    ["España", "Cabo Verde"],
    ["Arabia Saudita", "Uruguay"],
    ["España", "Arabia Saudita"],
    ["Uruguay", "Cabo Verde"],
    ["Cabo Verde", "Arabia Saudita"],
    ["Uruguay", "España"]
  ],
  I: [
    ["Francia", "Senegal"],
    ["Irak", "Noruega"],
    ["Francia", "Irak"],
    ["Noruega", "Senegal"],
    ["Noruega", "Francia"],
    ["Senegal", "Irak"]
  ],
  J: [
    ["Argentina", "Argelia"],
    ["Austria", "Jordania"],
    ["Argentina", "Austria"],
    ["Jordania", "Argelia"],
    ["Argelia", "Austria"],
    ["Jordania", "Argentina"]
  ],
  K: [
    ["Portugal", "RD Congo"],
    ["Uzbekistan", "Colombia"],
    ["Portugal", "Uzbekistan"],
    ["Colombia", "RD Congo"],
    ["Colombia", "Portugal"],
    ["RD Congo", "Uzbekistan"]
  ],
  L: [
    ["Inglaterra", "Croacia"],
    ["Ghana", "Panama"],
    ["Inglaterra", "Ghana"],
    ["Panama", "Croacia"],
    ["Panama", "Inglaterra"],
    ["Croacia", "Ghana"]
  ]
};

const GROUP_IDS = Object.keys(GROUP_MATCH_PAIRS);

function buildGroupMatches() {
  const matches = [] as Tournament["groupMatches"];

  for (const group of GROUP_IDS) {
    const pairings = GROUP_MATCH_PAIRS[group] ?? [];

    pairings.forEach(([home, away], index) => {
      const matchId = `G-${group}-${index + 1}`;
      matches.push({
        id: matchId,
        group,
        home,
        away,
        kickoffAt: FIXTURE_KICKOFFS[matchId] ?? null
      });
    });
  }

  return matches;
}

function createRound(round: RoundKey, count: number, prefix: string): KnockoutMatch[] {
  return Array.from({ length: count }).map((_, i) => ({
    id: `${prefix}-${i + 1}`,
    round,
    index: i,
    home: `POR DEFINIR ${prefix}-${(i * 2) + 1}`,
    away: `POR DEFINIR ${prefix}-${(i * 2) + 2}`,
    kickoffAt: KNOCKOUT_KICKOFFS[`${prefix}-${i + 1}`] ?? null
  }));
}

export function buildInitialKnockoutMatches(): Tournament["knockoutMatches"] {
  return {
    R16: Array.from({ length: 16 }).map((_, i) => ({
      id: `R16-${i + 1}`,
      round: "R16",
      index: i,
      home: `POR DEFINIR ${i * 2 + 1}`,
      away: `POR DEFINIR ${i * 2 + 2}`,
      kickoffAt: KNOCKOUT_KICKOFFS[`R16-${i + 1}`] ?? null
    })),
    OCT: createRound("OCT", 8, "OCT"),
    QF: createRound("QF", 4, "QF"),
    SF: createRound("SF", 2, "SF"),
    THIRD: createRound("THIRD", 1, "THIRD"),
    FINAL: createRound("FINAL", 1, "FINAL")
  };
}

export function buildInitialGroupMatches() {
  return buildGroupMatches();
}

export function listCompetingTeams() {
  const teams = new Set<string>();
  for (const pairings of Object.values(GROUP_MATCH_PAIRS)) {
    for (const [home, away] of pairings) {
      teams.add(home);
      teams.add(away);
    }
  }
  return [...teams].sort((a, b) => a.localeCompare(b));
}
