export const ROUND_ORDER = ["R16", "OCT", "QF", "SF", "THIRD", "FINAL"];

const COUNTRY_CODE_BY_NAME = {
  mexico: "MX",
  "corea del sur": "KR",
  sudafrica: "ZA",
  "republica checa": "CZ",
  canada: "CA",
  suiza: "CH",
  qatar: "QA",
  "bosnia herzegovina": "BA",
  brasil: "BR",
  marruecos: "MA",
  escocia: "GB",
  haiti: "HT",
  "estados unidos": "US",
  australia: "AU",
  paraguay: "PY",
  turquia: "TR",
  alemania: "DE",
  ecuador: "EC",
  "costa de marfil": "CI",
  curazao: "CW",
  "paises bajos": "NL",
  japon: "JP",
  tunez: "TN",
  suecia: "SE",
  belgica: "BE",
  iran: "IR",
  egipto: "EG",
  "nueva zelanda": "NZ",
  "cabo verde": "CV",
  "arabia saudita": "SA",
  espana: "ES",
  uruguay: "UY",
  francia: "FR",
  senegal: "SN",
  noruega: "NO",
  irak: "IQ",
  argelia: "DZ",
  argentina: "AR",
  austria: "AT",
  jordania: "JO",
  portugal: "PT",
  colombia: "CO",
  uzbekistan: "UZ",
  "rd congo": "CD",
  inglaterra: "GB",
  croacia: "HR",
  panama: "PA",
  ghana: "GH"
};

const KNOCKOUT_MATCH_START = {
  R16: 73,
  OCT: 89,
  QF: 97,
  SF: 101,
  THIRD: 103,
  FINAL: 104
};

function knockoutMatchNumber(round, index) {
  const start = KNOCKOUT_MATCH_START[round];
  if (typeof start !== "number") return null;
  return start + index;
}

function winnerPlaceholder(round, index) {
  const n = knockoutMatchNumber(round, index);
  return n ? `GANADOR Partido ${n}` : `GANADOR ${round}-${index + 1}`;
}

function loserPlaceholder(round, index) {
  const n = knockoutMatchNumber(round, index);
  return n ? `PERDEDOR Partido ${n}` : `PERDEDOR ${round}-${index + 1}`;
}

function normalizeCountryName(name) {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function codeToFlagEmoji(code) {
  return String.fromCodePoint(
    ...code
      .toUpperCase()
      .split("")
      .map((char) => 127397 + char.charCodeAt())
  );
}

export function countryFlag(countryName) {
  const normalized = normalizeCountryName(countryName);
  if (!normalized || normalized.startsWith("por definir")) return "";
  const code = COUNTRY_CODE_BY_NAME[normalized];
  if (!code) return "";
  return codeToFlagEmoji(code);
}

export function countryLabel(countryName) {
  const flag = countryFlag(countryName);
  if (!flag) return countryName;
  return `${flag} ${countryName}`;
}

function pickWinner(home, away, result) {
  if (!result) return null;
  return result === "L" ? home : away;
}

function pickLoser(home, away, result) {
  if (!result) return null;
  return result === "L" ? away : home;
}

const OCT_FROM_R16 = [
  [1, 4], // Partido 89: ganador 74 vs ganador 77
  [0, 2], // Partido 90: ganador 73 vs ganador 75
  [3, 5], // Partido 91: ganador 76 vs ganador 78
  [6, 7], // Partido 92: ganador 79 vs ganador 80
  [10, 11], // Partido 93: ganador 83 vs ganador 84
  [8, 9], // Partido 94: ganador 81 vs ganador 82
  [13, 15], // Partido 95: ganador 86 vs ganador 88
  [12, 14] // Partido 96: ganador 85 vs ganador 87
];

const QF_FROM_OCT = [
  [0, 1], // Partido 97: ganador 89 vs ganador 90
  [4, 5], // Partido 98: ganador 93 vs ganador 94
  [2, 3], // Partido 99: ganador 91 vs ganador 92
  [6, 7] // Partido 100: ganador 95 vs ganador 96
];

const SF_FROM_QF = [
  [0, 1], // Partido 101: ganador 97 vs ganador 98
  [2, 3] // Partido 102: ganador 99 vs ganador 100
];

export function computeRoundTeams(r16Base, picks) {
  const teams = {
    R16: r16Base.map((m) => ({ home: m.home, away: m.away })),
    OCT: [],
    QF: [],
    SF: [],
    THIRD: [],
    FINAL: []
  };

  const r16Winners = teams.R16.map((m, i) => pickWinner(m.home, m.away, picks.R16?.[`R16-${i + 1}`]));
  for (let i = 0; i < OCT_FROM_R16.length; i++) {
    const [leftSource, rightSource] = OCT_FROM_R16[i];
    teams.OCT.push({
      home: r16Winners[leftSource] ?? winnerPlaceholder("R16", leftSource),
      away: r16Winners[rightSource] ?? winnerPlaceholder("R16", rightSource)
    });
  }

  const octWinners = teams.OCT.map((m, i) => pickWinner(m.home, m.away, picks.OCT?.[`OCT-${i + 1}`]));
  for (let i = 0; i < QF_FROM_OCT.length; i++) {
    const [leftSource, rightSource] = QF_FROM_OCT[i];
    teams.QF.push({
      home: octWinners[leftSource] ?? winnerPlaceholder("OCT", leftSource),
      away: octWinners[rightSource] ?? winnerPlaceholder("OCT", rightSource)
    });
  }

  const qfWinners = teams.QF.map((m, i) => pickWinner(m.home, m.away, picks.QF?.[`QF-${i + 1}`]));
  for (let i = 0; i < SF_FROM_QF.length; i++) {
    const [leftSource, rightSource] = SF_FROM_QF[i];
    teams.SF.push({
      home: qfWinners[leftSource] ?? winnerPlaceholder("QF", leftSource),
      away: qfWinners[rightSource] ?? winnerPlaceholder("QF", rightSource)
    });
  }

  const sfWinners = teams.SF.map((m, i) => pickWinner(m.home, m.away, picks.SF?.[`SF-${i + 1}`]));
  const sfLosers = teams.SF.map((m, i) => pickLoser(m.home, m.away, picks.SF?.[`SF-${i + 1}`]));

  teams.THIRD = [{
    home: sfLosers[0] ?? loserPlaceholder("SF", 0),
    away: sfLosers[1] ?? loserPlaceholder("SF", 1)
  }];

  teams.FINAL = [{
    home: sfWinners[0] ?? winnerPlaceholder("SF", 0),
    away: sfWinners[1] ?? winnerPlaceholder("SF", 1)
  }];

  return teams;
}

export function byGroup(matches) {
  const map = new Map();
  for (const m of matches) {
    if (!map.has(m.group)) map.set(m.group, []);
    map.get(m.group).push(m);
  }
  return map;
}

export function leaderboardTable(leaderboard) {
  if (!leaderboard?.length) return "<p class=\"muted\">Sin datos todavía.</p>";

  const rows = leaderboard
    .map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${r.participantName}</td>
        <td>${r.group}</td>
        <td>${r.knockout}</td>
        <td>${r.bonus}</td>
        <td><strong>${r.total}</strong></td>
      </tr>
    `)
    .join("");

  return `
    <table class="table">
      <thead>
        <tr>
          <th>#</th>
          <th>Participante</th>
          <th>Grupos</th>
          <th>Final</th>
          <th>Bonus</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export function roundCount(round) {
  if (round === "R16") return 16;
  if (round === "OCT") return 8;
  if (round === "QF") return 4;
  if (round === "SF") return 2;
  return 1;
}
