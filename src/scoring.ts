import { ROUND_ORDER, ROUND_POINTS } from "./types.ts";
import type { RoundKey, Tournament } from "./types.ts";

type RoundTeams = Record<RoundKey, { home: string; away: string }[]>;

function pickWinner(home: string, away: string, result: "L" | "V" | undefined) {
  if (!result) {
    return null;
  }
  return result === "L" ? home : away;
}

function pickLoser(home: string, away: string, result: "L" | "V" | undefined) {
  if (!result) {
    return null;
  }
  return result === "L" ? away : home;
}

const KNOCKOUT_MATCH_START: Partial<Record<RoundKey, number>> = {
  R16: 73,
  OCT: 89,
  QF: 97,
  SF: 101,
  THIRD: 103,
  FINAL: 104
};

function knockoutMatchNumber(round: RoundKey, index: number) {
  const start = KNOCKOUT_MATCH_START[round];
  if (typeof start !== "number") return null;
  return start + index;
}

function winnerPlaceholder(round: RoundKey, index: number) {
  const n = knockoutMatchNumber(round, index);
  return n ? `GANADOR Partido ${n}` : `GANADOR ${round}-${index + 1}`;
}

function loserPlaceholder(round: RoundKey, index: number) {
  const n = knockoutMatchNumber(round, index);
  return n ? `PERDEDOR Partido ${n}` : `PERDEDOR ${round}-${index + 1}`;
}

const OCT_FROM_R16: [number, number][] = [
  [1, 4], // Partido 89: ganador 74 vs ganador 77
  [0, 2], // Partido 90: ganador 73 vs ganador 75
  [3, 5], // Partido 91: ganador 76 vs ganador 78
  [6, 7], // Partido 92: ganador 79 vs ganador 80
  [10, 11], // Partido 93: ganador 83 vs ganador 84
  [8, 9], // Partido 94: ganador 81 vs ganador 82
  [13, 15], // Partido 95: ganador 86 vs ganador 88
  [12, 14] // Partido 96: ganador 85 vs ganador 87
];

const QF_FROM_OCT: [number, number][] = [
  [0, 1], // Partido 97: ganador 89 vs ganador 90
  [4, 5], // Partido 98: ganador 93 vs ganador 94
  [2, 3], // Partido 99: ganador 91 vs ganador 92
  [6, 7] // Partido 100: ganador 95 vs ganador 96
];

const SF_FROM_QF: [number, number][] = [
  [0, 1], // Partido 101: ganador 97 vs ganador 98
  [2, 3] // Partido 102: ganador 99 vs ganador 100
];

export function computeRoundTeams(
  r16Base: Tournament["knockoutMatches"]["R16"],
  picks: Tournament["actual"]["knockout"]
): RoundTeams {
  const teams: RoundTeams = {
    R16: r16Base.map((m) => ({ home: m.home, away: m.away })),
    OCT: [],
    QF: [],
    SF: [],
    THIRD: [],
    FINAL: []
  };

  const r16Winners = teams.R16.map((m, i) => pickWinner(m.home, m.away, picks.R16[`R16-${i + 1}`]));
  for (let i = 0; i < OCT_FROM_R16.length; i++) {
    const [leftSource, rightSource] = OCT_FROM_R16[i];
    teams.OCT.push({
      home: r16Winners[leftSource] ?? winnerPlaceholder("R16", leftSource),
      away: r16Winners[rightSource] ?? winnerPlaceholder("R16", rightSource)
    });
  }

  const octWinners = teams.OCT.map((m, i) => pickWinner(m.home, m.away, picks.OCT[`OCT-${i + 1}`]));
  for (let i = 0; i < QF_FROM_OCT.length; i++) {
    const [leftSource, rightSource] = QF_FROM_OCT[i];
    teams.QF.push({
      home: octWinners[leftSource] ?? winnerPlaceholder("OCT", leftSource),
      away: octWinners[rightSource] ?? winnerPlaceholder("OCT", rightSource)
    });
  }

  const qfWinners = teams.QF.map((m, i) => pickWinner(m.home, m.away, picks.QF[`QF-${i + 1}`]));
  for (let i = 0; i < SF_FROM_QF.length; i++) {
    const [leftSource, rightSource] = SF_FROM_QF[i];
    teams.SF.push({
      home: qfWinners[leftSource] ?? winnerPlaceholder("QF", leftSource),
      away: qfWinners[rightSource] ?? winnerPlaceholder("QF", rightSource)
    });
  }

  const sfWinners = teams.SF.map((m, i) => pickWinner(m.home, m.away, picks.SF[`SF-${i + 1}`]));
  const sfLosers = teams.SF.map((m, i) => pickLoser(m.home, m.away, picks.SF[`SF-${i + 1}`]));

  teams.THIRD.push({
    home: sfLosers[0] ?? loserPlaceholder("SF", 0),
    away: sfLosers[1] ?? loserPlaceholder("SF", 1)
  });

  teams.FINAL.push({
    home: sfWinners[0] ?? winnerPlaceholder("SF", 0),
    away: sfWinners[1] ?? winnerPlaceholder("SF", 1)
  });

  return teams;
}

function previousRound(round: RoundKey): RoundKey | null {
  if (round === "R16") return null;
  if (round === "OCT") return "R16";
  if (round === "QF") return "OCT";
  if (round === "SF") return "QF";
  if (round === "THIRD" || round === "FINAL") return "SF";
  return null;
}

function getMatchId(round: RoundKey, index: number): string {
  return `${round}-${index + 1}`;
}

function getPreviousMatchIndexes(round: RoundKey, matchIndex: number): number[] {
  if (round === "OCT") return [...(OCT_FROM_R16[matchIndex] ?? [])];
  if (round === "QF") return [...(QF_FROM_OCT[matchIndex] ?? [])];
  if (round === "SF") return [...(SF_FROM_QF[matchIndex] ?? [])];
  if (round === "THIRD" || round === "FINAL") return [0, 1];
  return [];
}

function getPrevIndexForWinner(round: RoundKey, matchIndex: number, winnerTeam: string, prevMatches: { home: string; away: string }[]) {
  const indexes = getPreviousMatchIndexes(round, matchIndex);
  for (const index of indexes) {
    const prev = prevMatches[index];
    if (prev && (prev.home === winnerTeam || prev.away === winnerTeam)) {
      return index;
    }
  }
  return null;
}

function computeKnockoutPoints(tournament: Tournament, participantIndex: number) {
  const participant = tournament.participants[participantIndex];
  const actualTeams = computeRoundTeams(tournament.knockoutMatches.R16, tournament.actual.knockout);
  const predictedTeams = computeRoundTeams(tournament.knockoutMatches.R16, participant.predictions.knockout);

  const awarded: Record<RoundKey, number> = {
    R16: 0,
    OCT: 0,
    QF: 0,
    SF: 0,
    THIRD: 0,
    FINAL: 0
  };

  const correctMatchMap: Record<RoundKey, boolean[]> = {
    R16: Array(16).fill(false),
    OCT: Array(8).fill(false),
    QF: Array(4).fill(false),
    SF: Array(2).fill(false),
    THIRD: Array(1).fill(false),
    FINAL: Array(1).fill(false)
  };

  for (const round of ROUND_ORDER) {
    const count = actualTeams[round].length;

    for (let i = 0; i < count; i++) {
      const matchId = getMatchId(round, i);
      const actualMatch = actualTeams[round][i];
      const predictedMatch = predictedTeams[round][i];
      const actualWinner = pickWinner(actualMatch.home, actualMatch.away, tournament.actual.knockout[round][matchId]);
      const predictedWinner = pickWinner(predictedMatch.home, predictedMatch.away, participant.predictions.knockout[round][matchId]);

      if (!actualWinner || !predictedWinner || actualWinner !== predictedWinner) {
        continue;
      }

      const prevRound = previousRound(round);
      if (!prevRound) {
        correctMatchMap[round][i] = true;
        awarded[round] += ROUND_POINTS[round];
        continue;
      }

      const prevIndex = getPrevIndexForWinner(round, i, predictedWinner, predictedTeams[prevRound]);
      if (prevIndex === null) {
        continue;
      }

      if (!correctMatchMap[prevRound][prevIndex]) {
        continue;
      }

      correctMatchMap[round][i] = true;
      awarded[round] += ROUND_POINTS[round];
    }
  }

  return {
    pointsByRound: awarded,
    total: Object.values(awarded).reduce((acc, n) => acc + n, 0)
  };
}

function normalizeTeamName(name: string) {
  return name.trim().toLowerCase();
}

export function deriveBonusFinal(tournament: Tournament) {
  const teams = computeRoundTeams(tournament.knockoutMatches.R16, tournament.actual.knockout);
  const finalMatch = teams.FINAL[0] ?? { home: "", away: "" };
  const thirdMatch = teams.THIRD[0] ?? { home: "", away: "" };

  const finalResult = tournament.actual.knockout.FINAL["FINAL-1"];
  const thirdResult = tournament.actual.knockout.THIRD["THIRD-1"];

  const champion = pickWinner(finalMatch.home, finalMatch.away, finalResult) ?? "";
  const runnerUp = pickLoser(finalMatch.home, finalMatch.away, finalResult) ?? "";
  const third = pickWinner(thirdMatch.home, thirdMatch.away, thirdResult) ?? "";
  const fourth = pickLoser(thirdMatch.home, thirdMatch.away, thirdResult) ?? "";

  return { champion, runnerUp, third, fourth };
}

function computeBonusPoints(tournament: Tournament, participantIndex: number) {
  const participant = tournament.participants[participantIndex];
  const real = deriveBonusFinal(tournament);
  const mine = participant.predictions.bonus;

  let points = 0;
  if (normalizeTeamName(mine.champion) && normalizeTeamName(mine.champion) === normalizeTeamName(real.champion)) points += 8;
  if (normalizeTeamName(mine.runnerUp) && normalizeTeamName(mine.runnerUp) === normalizeTeamName(real.runnerUp)) points += 6;
  if (normalizeTeamName(mine.third) && normalizeTeamName(mine.third) === normalizeTeamName(real.third)) points += 4;
  if (normalizeTeamName(mine.fourth) && normalizeTeamName(mine.fourth) === normalizeTeamName(real.fourth)) points += 2;
  return points;
}

function computeGroupPoints(tournament: Tournament, participantIndex: number) {
  const participant = tournament.participants[participantIndex];
  let points = 0;
  for (const match of tournament.groupMatches) {
    const actual = tournament.actual.group[match.id];
    const mine = participant.predictions.group[match.id];
    if (actual && mine && actual === mine) {
      points += 1;
    }
  }
  return points;
}

export function computeParticipantScore(tournament: Tournament, participantIndex: number) {
  const group = computeGroupPoints(tournament, participantIndex);
  const knockout = computeKnockoutPoints(tournament, participantIndex);
  const bonus = computeBonusPoints(tournament, participantIndex);

  return {
    group,
    knockout: knockout.total,
    knockoutByRound: knockout.pointsByRound,
    bonus,
    total: group + knockout.total + bonus
  };
}

export function buildLeaderboard(tournament: Tournament) {
  return tournament.participants
    .map((p, index) => {
      const score = computeParticipantScore(tournament, index);
      return {
        participantId: p.id,
        participantName: p.name,
        ...score
      };
    })
    .sort((a, b) => b.total - a.total || b.knockout - a.knockout || b.group - a.group || a.participantName.localeCompare(b.participantName));
}
