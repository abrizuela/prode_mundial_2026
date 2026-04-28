import type { KnockoutMatch, RoundKey, Tournament } from "./types.ts";
import { FIXTURE_KICKOFFS } from "./fixture-kickoffs.ts";

const GROUP_TEAMS: Record<string, [string, string, string, string]> = {
  A: ["Mexico", "Corea del Sur", "Sudafrica", "Republica Checa"],
  B: ["Canada", "Suiza", "Qatar", "Bosnia Herzegovina"],
  C: ["Brasil", "Marruecos", "Escocia", "Haiti"],
  D: ["Estados Unidos", "Australia", "Paraguay", "Turquía"],
  E: ["Alemania", "Ecuador", "Costa de Marfil", "Curazao"],
  F: ["Países Bajos", "Japón", "Túnez", "Suecia"],
  G: ["Bélgica", "Irán", "Egipto", "Nueva Zelanda"],
  H: ["Cabo Verde", "Arabia Saudita", "España", "Uruguay"],
  I: ["Francia", "Senegal", "Noruega", "Irak"],
  J: ["Argelia", "Argentina", "Austria", "Jordania"],
  K: ["Portugal", "Colombia", "Uzbekistan", "RD Congo"],
  L: ["Inglaterra", "Croacia", "Panama", "Ghana"]
};

const GROUP_IDS = Object.keys(GROUP_TEAMS);

function buildGroupMatches() {
  const matches = [] as Tournament["groupMatches"];

  for (const group of GROUP_IDS) {
    const teams = GROUP_TEAMS[group];
    const pairings: [string, string][] = [
      [teams[0], teams[1]],
      [teams[2], teams[3]],
      [teams[0], teams[2]],
      [teams[1], teams[3]],
      [teams[0], teams[3]],
      [teams[1], teams[2]]
    ];

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
    kickoffAt: null
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
      kickoffAt: null
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
  for (const row of Object.values(GROUP_TEAMS)) {
    for (const team of row) teams.add(team);
  }
  return [...teams].sort((a, b) => a.localeCompare(b));
}
