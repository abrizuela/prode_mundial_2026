import { countryFlag, countryLabel, leaderboardTable } from "./common.js";

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

let currentSummaries = [];
let currentTournamentName = "Torneo";

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
  return lines.join("\n");
}

function renderWhatsAppSection(tournamentName, summaries) {
  currentSummaries = Array.isArray(summaries) ? summaries : [];
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
  whatsappMatchSelect.value = currentSummaries[0].key;
  whatsappPreview.value = buildWhatsAppSummary(tournamentName, currentSummaries[0]);
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
