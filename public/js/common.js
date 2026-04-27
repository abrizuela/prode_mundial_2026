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
  for (let i = 0; i < 8; i++) {
    teams.OCT.push({
      home: r16Winners[i * 2] ?? `POR DEFINIR R16-${i * 2 + 1}`,
      away: r16Winners[i * 2 + 1] ?? `POR DEFINIR R16-${i * 2 + 2}`
    });
  }

  const octWinners = teams.OCT.map((m, i) => pickWinner(m.home, m.away, picks.OCT?.[`OCT-${i + 1}`]));
  for (let i = 0; i < 4; i++) {
    teams.QF.push({
      home: octWinners[i * 2] ?? `POR DEFINIR OCT-${i * 2 + 1}`,
      away: octWinners[i * 2 + 1] ?? `POR DEFINIR OCT-${i * 2 + 2}`
    });
  }

  const qfWinners = teams.QF.map((m, i) => pickWinner(m.home, m.away, picks.QF?.[`QF-${i + 1}`]));
  for (let i = 0; i < 2; i++) {
    teams.SF.push({
      home: qfWinners[i * 2] ?? `POR DEFINIR QF-${i * 2 + 1}`,
      away: qfWinners[i * 2 + 1] ?? `POR DEFINIR QF-${i * 2 + 2}`
    });
  }

  const sfWinners = teams.SF.map((m, i) => pickWinner(m.home, m.away, picks.SF?.[`SF-${i + 1}`]));
  const sfLosers = teams.SF.map((m, i) => pickLoser(m.home, m.away, picks.SF?.[`SF-${i + 1}`]));

  teams.THIRD = [{
    home: sfLosers[0] ?? "POR DEFINIR SF-1",
    away: sfLosers[1] ?? "POR DEFINIR SF-2"
  }];

  teams.FINAL = [{
    home: sfWinners[0] ?? "POR DEFINIR SF-1",
    away: sfWinners[1] ?? "POR DEFINIR SF-2"
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
