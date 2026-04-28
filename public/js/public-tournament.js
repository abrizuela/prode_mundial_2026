import { leaderboardTable } from "./common.js";

const parts = window.location.pathname.split("/").filter(Boolean);
const tournamentId = parts[1] ?? "";

const title = document.querySelector("#title");
const titleText = title?.querySelector("span");
const subtitle = document.querySelector("#subtitle");
const leaderboardEl = document.querySelector("#leaderboard");
const refreshBtn = document.querySelector("#refreshBtn");

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

async function loadPublicTournament() {
  if (!tournamentId) {
    subtitle.textContent = "Link inválido";
    leaderboardEl.innerHTML = "<p class=\"muted\">No se pudo identificar el torneo.</p>";
    return;
  }

  leaderboardEl.innerHTML = "<p class=\"muted\">Cargando...</p>";

  const res = await fetch(`/api/public/tournaments/${tournamentId}`);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data.error ?? "No se pudo cargar la tabla pública.";
    subtitle.textContent = msg;
    leaderboardEl.innerHTML = `<p class=\"muted\">${msg}</p>`;
    return;
  }

  const tournamentName = data.tournament?.name ?? "Torneo";
  if (titleText) titleText.textContent = `PRODE Mundial 2026: ${tournamentName}`;
  else title.textContent = `PRODE Mundial 2026: ${tournamentName}`;

  const count = data.tournament?.participantCount ?? 0;
  const createdAt = data.tournament?.createdAt ? formatDate(data.tournament.createdAt) : "";
  subtitle.textContent = `${count} participante${count === 1 ? "" : "s"}${createdAt ? ` · creado el ${createdAt}` : ""}`;

  leaderboardEl.innerHTML = leaderboardTable(data.leaderboard || []);
}

refreshBtn.addEventListener("click", loadPublicTournament);
loadPublicTournament();
