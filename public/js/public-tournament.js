import { KNOCKOUT_RESULT, computeRoundTeams, countryFlag, countryLabel, leaderboardTable } from "./common.js";

const parts = window.location.pathname.split("/").filter(Boolean);
const tournamentSlug = parts[1] ?? "";

const title = document.querySelector("#title");
const titleText = title?.querySelector("span");
const subtitle = document.querySelector("#subtitle");
const leaderboardEl = document.querySelector("#leaderboard");
const refreshBtn = document.querySelector("#refreshBtn");
const whatsappMatchSelect = document.querySelector("#whatsappMatchSelect");
const whatsappPreview = document.querySelector("#whatsappPreview");
const copyWhatsappBtn = document.querySelector("#copyWhatsappBtn");
const whatsappMsg = document.querySelector("#whatsappMsg");
const finalStageBracket = document.querySelector("#finalStageBracket");

let currentSummaries = [];
let currentTournamentName = "Torneo";

const roundLabel = {
  R16: "Dieciseisavos",
  OCT: "Octavos",
  QF: "Cuartos",
  SF: "Semifinales",
  FINAL: "Final",
  THIRD: "3er. Puesto"
};

const knockoutMatchStart = {
  R16: 73,
  OCT: 89,
  QF: 97,
  SF: 101,
  THIRD: 103,
  FINAL: 104
};

const PUBLIC_ROUND_ORDER = ["R16", "OCT", "QF", "SF", "THIRD", "FINAL"];

let currentFinalStageData = null;
let selectedFinalStageRound = "R16";

function onBracketUpdated() {
  void loadPublicTournament();
}

window.addEventListener("prode-bracket-updated", onBracketUpdated);
window.addEventListener("storage", (event) => {
  if (event.key === "prode_bracket_update_at") {
    onBracketUpdated();
  }
});

function formatDate(isoOrNull) {
  if (!isoOrNull) return "";
  const d = new Date(isoOrNull);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function setNotice(el, text, isError = false) {
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? "#a62d2d" : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizePlaceholderName(teamName) {
  const text = String(teamName ?? "").trim();
  const winner = text.match(/^GANADOR\s+Partido\s+(\d+)$/i);
  if (winner) return `Ganador Partido ${winner[1]}`;

  const loser = text.match(/^PERDEDOR\s+Partido\s+(\d+)$/i);
  if (loser) return `Perdedor Partido ${loser[1]}`;

  if (/^POR DEFINIR\b/i.test(text)) {
    return "Por definir";
  }

  return text;
}

function isPlaceholderTeam(teamName) {
  return /^(GANADOR|PERDEDOR)\s+Partido\s+\d+$/i.test(String(teamName ?? "")) || /^POR DEFINIR\b/i.test(String(teamName ?? ""));
}

function displayTeam(teamName) {
  if (isPlaceholderTeam(teamName)) {
    return normalizePlaceholderName(teamName);
  }
  return countryLabel(teamName || "Por definir");
}

function displayKickoff(kickoffAt) {
  const formatted = formatDate(kickoffAt);
  return formatted || "Día y hora a confirmar";
}

function matchNumber(round, index) {
  const start = knockoutMatchStart[round];
  if (typeof start !== "number") return null;
  return start + index;
}

function winnerSide(result) {
  if (!result) return "";
  return result === KNOCKOUT_RESULT.HOME ? "home" : "away";
}

function renderBracketCard({ round, index, match, projected, result }) {
  const side = winnerSide(result);
  const number = matchNumber(round, typeof match.index === "number" ? match.index : index);

  const homeClasses = ["bracket-team-line"];
  const awayClasses = ["bracket-team-line"];

  if (isPlaceholderTeam(projected.home)) homeClasses.push("is-placeholder");
  if (isPlaceholderTeam(projected.away)) awayClasses.push("is-placeholder");
  if (side === "home") homeClasses.push("is-winner");
  if (side === "away") awayClasses.push("is-winner");

  return `
    <article class="bracket-match-card">
      <div class="bracket-match-top">
        <span class="tag">${number ? `Partido ${number}` : escapeHtml(match.id)}</span>
        <span class="bracket-kickoff">${escapeHtml(displayKickoff(match.kickoffAt))}</span>
      </div>
      <div class="${homeClasses.join(" ")}">${escapeHtml(displayTeam(projected.home))}</div>
      <div class="${awayClasses.join(" ")}">${escapeHtml(displayTeam(projected.away))}</div>
      <div class="bracket-status ${result ? "is-loaded" : "is-pending"}">${result ? "Resultado cargado" : "Pendiente"}</div>
    </article>
  `;
}

function getAvailableRounds(knockoutMatches) {
  return PUBLIC_ROUND_ORDER.filter((round) => {
    const matches = knockoutMatches?.[round];
    return Array.isArray(matches) && matches.length > 0;
  });
}

function buildRoundSelector(availableRounds, selectedRound) {
  const buttons = availableRounds.map((round) => {
    const active = selectedRound === round;
    return `<button type="button" class="round-chip ${active ? "is-active" : ""}" data-round="${round}">${escapeHtml(roundLabel[round] ?? round)}</button>`;
  }).join("");

  return `<div class="round-chip-list" role="tablist" aria-label="Seleccionar ronda">${buttons}</div>`;
}

function buildRoundMatches(round, knockoutMatches, roundTeams, actualKnockout) {
  const matches = Array.isArray(knockoutMatches?.[round]) ? knockoutMatches[round] : [];
  const projectedTeams = Array.isArray(roundTeams?.[round]) ? roundTeams[round] : [];

  if (!matches.length) {
    return '<p class="muted">No hay partidos para esta ronda.</p>';
  }

  const projectedById = new Map(matches.map((match, index) => [match.id, projectedTeams[index] ?? { home: match.home, away: match.away }]));

  const sortedMatches = [...matches].sort((a, b) => {
    const aTime = a?.kickoffAt ? Date.parse(a.kickoffAt) : Number.POSITIVE_INFINITY;
    const bTime = b?.kickoffAt ? Date.parse(b.kickoffAt) : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    const aIndex = typeof a.index === "number" ? a.index : Number.POSITIVE_INFINITY;
    const bIndex = typeof b.index === "number" ? b.index : Number.POSITIVE_INFINITY;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });

  const cards = sortedMatches.map((match) => {
    const projected = projectedById.get(match.id) ?? { home: match.home, away: match.away };
    const result = actualKnockout?.[round]?.[match.id];
    const index = typeof match.index === "number" ? match.index : 0;
    return renderBracketCard({ round, index, match, projected, result });
  }).join("");

  return `<div class="round-match-list">${cards}</div>`;
}

function bindRoundSelector() {
  if (!finalStageBracket) return;
  finalStageBracket.querySelectorAll(".round-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextRound = btn.getAttribute("data-round") || "";
      if (!nextRound || nextRound === selectedFinalStageRound) return;
      selectedFinalStageRound = nextRound;
      renderFinalStage(currentFinalStageData);
    });
  });
}

function renderFinalStage(finalStage) {
  if (!finalStageBracket) return;

  currentFinalStageData = finalStage;

  const knockoutMatches = finalStage?.knockoutMatches ?? {};
  const actualKnockout = finalStage?.actualKnockout ?? {};
  const r16Matches = Array.isArray(knockoutMatches.R16) ? knockoutMatches.R16 : [];
  const roundTeams = finalStage?.roundTeams ?? computeRoundTeams(r16Matches, actualKnockout);

  if (!r16Matches.length) {
    finalStageBracket.innerHTML = '<p class="muted">Todavía no hay cruces de fase final para mostrar.</p>';
    return;
  }

  const availableRounds = getAvailableRounds(knockoutMatches);
  if (!availableRounds.length) {
    finalStageBracket.innerHTML = '<p class="muted">Todavía no hay rondas disponibles.</p>';
    return;
  }

  if (!availableRounds.includes(selectedFinalStageRound)) {
    selectedFinalStageRound = availableRounds[0];
  }

  finalStageBracket.innerHTML = `
    <section class="unified-final-stage">
      ${buildRoundSelector(availableRounds, selectedFinalStageRound)}
      <div class="round-panel">
        ${buildRoundMatches(selectedFinalStageRound, knockoutMatches, roundTeams, actualKnockout)}
      </div>
    </section>
  `;

  bindRoundSelector();
}

function formatNames(names) {
  if (!Array.isArray(names) || !names.length) return "nadie";
  return names.join(", ");
}

function sideMarker(teamName) {
  return countryFlag(teamName) || countryLabel(teamName) || teamName;
}

function buildWhatsAppSummary(tournamentName, match) {
  const lines = [
    `🏆 ${tournamentName}`,
    `📍 ${match.stageLabel}`,
    `🗓️ ${formatDate(match.kickoffAt)}`,
    `⚽ ${countryLabel(match.home)} vs ${countryLabel(match.away)}`,
    "",
    `${sideMarker(match.home)} ${formatNames(match.localNames)}`
  ];

  if (match.type === "group") {
    lines.push(`🤝 ${formatNames(match.drawNames)}`);
  }

  lines.push(`${sideMarker(match.away)} ${formatNames(match.awayNames)}`);
  if (match.type === "knockout") {
    lines.push(`☠️ ${formatNames(match.skullNames)}`);
  }
  return lines.join("\n");
}

function renderWhatsAppSection(tournamentName, summaries) {
  currentSummaries = Array.isArray(summaries) ? [...summaries] : [];
  currentSummaries.sort((a, b) => {
    const aTime = a?.kickoffAt ? Date.parse(a.kickoffAt) : Number.NEGATIVE_INFINITY;
    const bTime = b?.kickoffAt ? Date.parse(b.kickoffAt) : Number.NEGATIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    return String(a.key ?? "").localeCompare(String(b.key ?? ""));
  });
  whatsappMatchSelect.innerHTML = "";

  if (!currentSummaries.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No hay partidos con edición cerrada";
    whatsappMatchSelect.append(option);
    whatsappMatchSelect.disabled = true;
    copyWhatsappBtn.disabled = true;
    whatsappPreview.value = "";
    setNotice(whatsappMsg, "El resumen se habilita cuando cierre la edición de cada partido.");
    return;
  }

  for (const match of currentSummaries) {
    const option = document.createElement("option");
    option.value = match.key;
    option.textContent = `${match.stageLabel} · ${countryLabel(match.home)} vs ${countryLabel(match.away)} · ${formatDate(match.kickoffAt)}`;
    whatsappMatchSelect.append(option);
  }

  whatsappMatchSelect.disabled = false;
  copyWhatsappBtn.disabled = false;
  const defaultMatch = currentSummaries[currentSummaries.length - 1];
  whatsappMatchSelect.value = defaultMatch.key;
  whatsappPreview.value = buildWhatsAppSummary(tournamentName, defaultMatch);
  setNotice(whatsappMsg, "");
}

function refreshWhatsAppPreview(tournamentName) {
  const selected = currentSummaries.find((m) => m.key === whatsappMatchSelect.value);
  if (!selected) {
    whatsappPreview.value = "";
    copyWhatsappBtn.disabled = true;
    return;
  }

  copyWhatsappBtn.disabled = false;
  whatsappPreview.value = buildWhatsAppSummary(tournamentName, selected);
}

async function loadPublicTournament() {
  if (!tournamentSlug) {
    subtitle.textContent = "Link inválido";
    leaderboardEl.innerHTML = "<p class=\"muted\">No se pudo identificar el torneo.</p>";
    return;
  }

  leaderboardEl.innerHTML = "<p class=\"muted\">Cargando...</p>";

  const res = await fetch(`/api/public/tournaments/${encodeURIComponent(tournamentSlug)}`);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data.error ?? "No se pudo cargar la tabla pública.";
    subtitle.textContent = msg;
    leaderboardEl.innerHTML = `<p class=\"muted\">${msg}</p>`;
    return;
  }

  const tournamentName = data.tournament?.name ?? "Torneo";
  currentTournamentName = tournamentName;
  if (titleText) titleText.textContent = `PRODE Mundial 2026: ${tournamentName}`;
  else title.textContent = `PRODE Mundial 2026: ${tournamentName}`;

  const count = data.tournament?.participantCount ?? 0;
  const createdAt = data.tournament?.createdAt ? formatDate(data.tournament.createdAt) : "";
  subtitle.textContent = `${count} participante${count === 1 ? "" : "s"}${createdAt ? ` · creado el ${createdAt}` : ""}`;

  leaderboardEl.innerHTML = leaderboardTable(data.leaderboard || []);
  renderFinalStage(data.finalStage || null);
  renderWhatsAppSection(tournamentName, data.whatsappSummaries || []);
}

whatsappMatchSelect?.addEventListener("change", () => {
  refreshWhatsAppPreview(currentTournamentName);
});

copyWhatsappBtn?.addEventListener("click", async () => {
  const text = whatsappPreview.value.trim();
  if (!text) {
    setNotice(whatsappMsg, "No hay texto para copiar.", true);
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setNotice(whatsappMsg, "Texto copiado. Listo para pegar en WhatsApp.");
  } catch {
    setNotice(whatsappMsg, "No se pudo copiar al portapapeles.", true);
  }
});

refreshBtn.addEventListener("click", loadPublicTournament);
loadPublicTournament();
