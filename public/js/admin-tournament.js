import { ROUND_ORDER, countryFlag, countryLabel, leaderboardTable } from "./common.js";

const tournamentId = window.location.pathname.split("/").pop();

const title = document.querySelector("#title");
const links = document.querySelector("#links");
const leaderboardEl = document.querySelector("#leaderboard");

const openRenameTournamentIconBtn = document.querySelector("#openRenameTournamentIcon");
const deleteTournamentBtn = document.querySelector("#deleteTournament");
const newParticipantNameInput = document.querySelector("#newParticipantName");
const addParticipantBtn = document.querySelector("#addParticipant");

const renameTournamentModal = document.querySelector("#renameTournamentModal");
const renameTournamentInput = document.querySelector("#renameTournamentInput");
const renameTournamentCancel = document.querySelector("#renameTournamentCancel");
const renameTournamentSave = document.querySelector("#renameTournamentSave");
const renameParticipantModal = document.querySelector("#renameParticipantModal");
const renameParticipantInput = document.querySelector("#renameParticipantInput");
const renameParticipantCancel = document.querySelector("#renameParticipantCancel");
const renameParticipantSave = document.querySelector("#renameParticipantSave");

const adminKeyInput = document.querySelector("#adminKey");
const saveAdminKeyBtn = document.querySelector("#saveAdminKey");
const clearAdminKeyBtn = document.querySelector("#clearAdminKey");
const adminAuthMsg = document.querySelector("#adminAuthMsg");
const notificationsPanel = document.querySelector("#notificationsPanel");
const customNotifRecipientSelect = document.querySelector("#customNotifRecipient");
const customNotifTitleInput = document.querySelector("#customNotifTitle");
const customNotifBodyInput = document.querySelector("#customNotifBody");
const sendCustomNotifBtn = document.querySelector("#sendCustomNotif");
const customNotifMsg = document.querySelector("#customNotifMsg");
const whatsappMatchSelect = document.querySelector("#whatsappMatchSelect");
const whatsappPreview = document.querySelector("#whatsappPreview");
const copyWhatsappBtn = document.querySelector("#copyWhatsappBtn");
const whatsappMsg = document.querySelector("#whatsappMsg");

const modal = document.querySelector("#appModal");
const modalTitle = document.querySelector("#modalTitle");
const modalText = document.querySelector("#modalText");
const modalCancel = document.querySelector("#modalCancel");
const modalOk = document.querySelector("#modalOk");

const ADMIN_KEY_STORAGE = "prode_admin_key";
let currentTournamentName = "";
let currentParticipantId = "";
let currentTournament = null;

const ROUND_LABELS = {
  R16: "16vos de final",
  OCT: "8vos de final",
  QF: "Cuartos de final",
  SF: "Semifinales",
  THIRD: "Tercer puesto",
  FINAL: "Final"
};

function formatDate(isoOrNull) {
  if (!isoOrNull) return "Sin fecha";
  const d = new Date(isoOrNull);
  if (Number.isNaN(d.getTime())) return "Sin fecha";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function getWhatsAppMatches(tournament) {
  const groupMatches = tournament.groupMatches.map((m) => ({
    key: `group|${m.id}`,
    stageLabel: `Grupo ${m.group}`,
    matchId: m.id,
    home: m.home,
    away: m.away,
    kickoffAt: m.kickoffAt,
    type: "group"
  }));

  const knockoutMatches = ROUND_ORDER.flatMap((round) =>
    (tournament.knockoutMatches?.[round] || []).map((m) => ({
      key: `knockout|${round}|${m.id}`,
      stageLabel: ROUND_LABELS[round] || round,
      round,
      matchId: m.id,
      home: m.home,
      away: m.away,
      kickoffAt: m.kickoffAt,
      type: "knockout"
    }))
  );

  const all = [...groupMatches, ...knockoutMatches];
  all.sort((a, b) => {
    const ta = a.kickoffAt ? new Date(a.kickoffAt).getTime() : Number.POSITIVE_INFINITY;
    const tb = b.kickoffAt ? new Date(b.kickoffAt).getTime() : Number.POSITIVE_INFINITY;
    return ta - tb;
  });

  return all;
}

function formatNames(names) {
  if (!names.length) return "nadie";
  return names.join(", ");
}

function sideMarker(teamName) {
  return countryFlag(teamName) || countryLabel(teamName) || teamName;
}

function buildWhatsAppSummary(tournament, match) {
  const local = [];
  const draw = [];
  const away = [];

  for (const participant of tournament.participants) {
    if (match.type === "group") {
      const value = participant.predictions?.group?.[match.matchId];
      if (value === "L") local.push(participant.name);
      if (value === "E") draw.push(participant.name);
      if (value === "V") away.push(participant.name);
      continue;
    }

    const value = participant.predictions?.knockout?.[match.round]?.[match.matchId];
    if (value === "L") local.push(participant.name);
    if (value === "V") away.push(participant.name);
  }

  const lines = [
    `🏆 ${tournament.name}`,
    `📍 ${match.stageLabel}`,
    `🗓️ ${formatDate(match.kickoffAt)}`,
    `⚽ ${countryLabel(match.home)} vs ${countryLabel(match.away)}`,
    "",
    `${sideMarker(match.home)} ${formatNames(local)}`
  ];

  if (match.type === "group") {
    lines.push(`🤝 ${formatNames(draw)}`);
  }

  lines.push(`${sideMarker(match.away)} ${formatNames(away)}`);

  return lines.join("\n");
}

function refreshWhatsAppPreview() {
  if (!currentTournament || !whatsappMatchSelect.value) {
    whatsappPreview.value = "";
    return;
  }

  const matches = getWhatsAppMatches(currentTournament);
  const selected = matches.find((m) => m.key === whatsappMatchSelect.value);
  if (!selected) {
    whatsappPreview.value = "";
    return;
  }

  whatsappPreview.value = buildWhatsAppSummary(currentTournament, selected);
}

function renderWhatsAppPanel(tournament) {
  const matches = getWhatsAppMatches(tournament);
  whatsappMatchSelect.innerHTML = "";

  if (!matches.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No hay partidos disponibles";
    whatsappMatchSelect.append(option);
    whatsappMatchSelect.disabled = true;
    copyWhatsappBtn.disabled = true;
    whatsappPreview.value = "";
    return;
  }

  whatsappMatchSelect.disabled = false;
  copyWhatsappBtn.disabled = false;

  for (const match of matches) {
    const option = document.createElement("option");
    option.value = match.key;
    option.textContent = `${match.stageLabel} · ${countryLabel(match.home)} vs ${countryLabel(match.away)} · ${formatDate(match.kickoffAt)}`;
    whatsappMatchSelect.append(option);
  }

  const now = Date.now();
  const nextUpcoming = matches.find((m) => {
    if (!m.kickoffAt) return false;
    const ts = new Date(m.kickoffAt).getTime();
    return Number.isFinite(ts) && ts >= now;
  });

  whatsappMatchSelect.value = nextUpcoming?.key || matches[0].key;
  refreshWhatsAppPreview();
}

function setNotice(el, text, isError = false) {
  el.textContent = text;
  el.style.color = isError ? "#a62d2d" : "";
}

function openModal({ title, text, confirmText = "Aceptar", cancelText = "Cancelar" }) {
  modalTitle.textContent = title;
  modalText.textContent = text;
  modalOk.textContent = confirmText;
  modalCancel.textContent = cancelText;
  modal.classList.remove("hidden");

  return new Promise((resolve) => {
    const onCancel = () => {
      cleanup();
      resolve(false);
    };
    const onConfirm = () => {
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      modal.classList.add("hidden");
      modalCancel.removeEventListener("click", onCancel);
      modalOk.removeEventListener("click", onConfirm);
    };

    modalCancel.addEventListener("click", onCancel);
    modalOk.addEventListener("click", onConfirm);
  });
}

function getAdminKey() {
  return localStorage.getItem(ADMIN_KEY_STORAGE) ?? "";
}

function adminHeaders(extra = {}) {
  return {
    ...extra,
    "x-admin-key": getAdminKey()
  };
}

async function validateAdminKey() {
  const key = getAdminKey();
  if (!key) {
    adminAuthMsg.textContent = "Ingresá y guardá la clave admin para usar el panel.";
    return false;
  }

  const res = await fetch("/api/admin/session", { headers: adminHeaders() });
  if (!res.ok) {
    adminAuthMsg.textContent = "Clave inválida. Revisala y volvé a guardar.";
    return false;
  }

  adminAuthMsg.textContent = "Clave admin validada.";
  return true;
}

function copyToClipboard(url, btn) {
  navigator.clipboard.writeText(url).then(() => {
    const original = btn.innerHTML;
    btn.textContent = "OK";
    btn.disabled = true;
    setTimeout(() => {
      btn.innerHTML = original;
      btn.disabled = false;
    }, 1500);
  });
}

function openParticipantNotification(participantId) {
  customNotifRecipientSelect.value = participantId;
  notificationsPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
  customNotifTitleInput.focus();
}

function renderParticipants(tournament) {
  if (!tournament.participants.length) {
    links.innerHTML = `
      <div class="group-box stack">
        <strong>Link público del torneo</strong>
        <div class="row" style="align-items:center;gap:0.5rem;">
          <a href="/t/${tournament.id}" target="_blank" rel="noreferrer">${window.location.origin}/t/${tournament.id}</a>
          <button class="icon-btn copy-btn" data-copy="${window.location.origin}/t/${tournament.id}" aria-label="Copiar link"><img src="/assets/copy.png" alt="" width="14" height="14" /></button>
        </div>
      </div>
      <p class="muted">No hay participantes en este torneo.</p>
    `;
    links.querySelectorAll(".copy-btn").forEach((btn) => {
      btn.addEventListener("click", () => copyToClipboard(btn.dataset.copy, btn));
    });
    return;
  }

  const participantsHtml = tournament.participants
    .map((p) => {
      const canUnlockGroup = Boolean(p.groupLockedAt);
      const canUnlockFinal = Boolean(p.finalLockedAt);
      const url = `${window.location.origin}${p.playerUrl || p.groupUrl}`;
      const notifStatus = p.notificationsEnabled
        ? "<span class='status-chip is-on'>Notificaciones activas</span>"
        : "<span class='status-chip is-off'>Sin notificaciones</span>";
      return `
      <div class="group-box stack" data-participant-id="${p.id}">
        <div class="stack">
          <div class="row" style="align-items:center; gap:8px;">
            <strong>${p.name}</strong>
            <button class="icon-btn" data-action="open-rename-participant" type="button" aria-label="Cambiar nombre del participante">✎</button>
            ${notifStatus}
            ${p.groupLockedAt ? "<span class='tag'>Grupos enviado</span>" : ""}
            ${p.finalLockedAt ? "<span class='tag'>Final enviado</span>" : ""}
          </div>
          <div class="row" style="align-items:center;gap:0.5rem;">
            <a href="${p.playerUrl || p.groupUrl}" target="_blank" rel="noreferrer">${url}</a>
            <button class="icon-btn copy-btn" data-copy="${url}" aria-label="Copiar link"><img src="/assets/copy.png" alt="" width="14" height="14" /></button>
          </div>
        </div>
        <div class="row">
          <button class='secondary' data-action='notify-participant'>Notificar</button>
          <button class='secondary' data-action='unlock-group' ${canUnlockGroup ? "" : "disabled"}>Habilitar edición Fase de Grupos</button>
          <button class='secondary' data-action='unlock-final' ${canUnlockFinal ? "" : "disabled"}>Habilitar edición Fase Final</button>
          <button class="danger" data-action="delete-participant">Eliminar</button>
        </div>
      </div>
    `;
    })
    .join("");

  links.innerHTML = `
    <div class="group-box stack">
      <strong>Link público del torneo</strong>
      <div class="row" style="align-items:center;gap:0.5rem;">
        <a href="/t/${tournament.id}" target="_blank" rel="noreferrer">${window.location.origin}/t/${tournament.id}</a>
        <button class="icon-btn copy-btn" data-copy="${window.location.origin}/t/${tournament.id}" aria-label="Copiar link"><img src="/assets/copy.png" alt="" width="14" height="14" /></button>
      </div>
    </div>
    ${participantsHtml}
  `;

  links.querySelectorAll("button[data-action='open-rename-participant']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest("[data-participant-id]");
      const participantId = card?.dataset.participantId ?? "";
      const participantName = card?.querySelector("strong")?.textContent?.trim() ?? "";
      if (!participantId) return;

      currentParticipantId = participantId;
      renameParticipantInput.value = participantName;
      renameParticipantModal.classList.remove("hidden");
      renameParticipantInput.focus();
    });
  });

  links.querySelectorAll("button[data-action='notify-participant']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest("[data-participant-id]");
      const participantId = card?.dataset.participantId ?? "";
      if (!participantId) return;

      openParticipantNotification(participantId);
    });
  });

  links.querySelectorAll("button[data-action='delete-participant']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const card = btn.closest("[data-participant-id]");
      const participantId = card?.dataset.participantId;
      if (!participantId) return;

      const confirmed = await openModal({
        title: "Eliminar participante",
        text: "Se eliminará el participante y sus links. Esta acción no se puede deshacer.",
        confirmText: "Eliminar"
      });
      if (!confirmed) return;

      const res = await fetch(`/api/tournaments/${tournamentId}/participants/${participantId}`, {
        method: "DELETE",
        headers: adminHeaders()
      });

      if (!res.ok) return;
      await load();
    });
  });

  links.querySelectorAll("button[data-action='unlock-group']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      const card = btn.closest("[data-participant-id]");
      const participantId = card?.dataset.participantId;
      if (!participantId) return;

      const confirmed = await openModal({
        title: "Habilitar edición Fase de Grupos",
        text: "Se habilitará nuevamente la fase de grupos para este participante.",
        confirmText: "Habilitar"
      });
      if (!confirmed) return;

      const res = await fetch(`/api/tournaments/${tournamentId}/participants/${participantId}/unlock`, {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ stage: "group" })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        await openModal({
          title: "No se pudo habilitar",
          text: data.error ?? "No se pudo habilitar la fase de grupos.",
          confirmText: "Cerrar"
        });
        return;
      }
      await load();
    });
  });

  links.querySelectorAll("button[data-action='unlock-final']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      const card = btn.closest("[data-participant-id]");
      const participantId = card?.dataset.participantId;
      if (!participantId) return;

      const confirmed = await openModal({
        title: "Habilitar edición Fase Final",
        text: "Se habilitará nuevamente la fase final para este participante.",
        confirmText: "Habilitar"
      });
      if (!confirmed) return;

      const res = await fetch(`/api/tournaments/${tournamentId}/participants/${participantId}/unlock`, {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ stage: "final" })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        await openModal({
          title: "No se pudo habilitar",
          text: data.error ?? "No se pudo habilitar la fase final.",
          confirmText: "Cerrar"
        });
        return;
      }
      await load();
    });
  });

  links.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", () => copyToClipboard(btn.dataset.copy, btn));
  });
}

function renderLeaderboard(leaderboard) {
  leaderboardEl.innerHTML = leaderboardTable(leaderboard);
}

function renderNotificationRecipients(tournament) {
  customNotifRecipientSelect.innerHTML = '<option value="">Todos los participantes</option>';

  for (const participant of tournament.participants) {
    const option = document.createElement("option");
    option.value = participant.id;
    option.textContent = participant.name;
    customNotifRecipientSelect.append(option);
  }
}

async function load() {
  const ok = await validateAdminKey();
  if (!ok) {
    title.textContent = "Panel admin bloqueado";
    links.innerHTML = "";
    leaderboardEl.innerHTML = "";
    customNotifRecipientSelect.innerHTML = '<option value="">Todos los participantes</option>';
    whatsappMatchSelect.innerHTML = '<option value="">Sin acceso admin</option>';
    whatsappMatchSelect.disabled = true;
    copyWhatsappBtn.disabled = true;
    whatsappPreview.value = "";
    return;
  }

  const res = await fetch(`/api/tournaments/${tournamentId}`, {
    headers: adminHeaders()
  });

  const data = await res.json();
  if (!res.ok) {
    title.textContent = "Torneo no encontrado";
    links.innerHTML = `<p class="muted">${data.error ?? "No se pudo cargar el torneo."}</p>`;
    leaderboardEl.innerHTML = "";
    return;
  }

  const tournament = data.tournament;
  title.textContent = tournament.name;
  currentTournamentName = tournament.name;
  currentTournament = tournament;

  renderParticipants(tournament);
  renderLeaderboard(data.leaderboard);
  renderNotificationRecipients(tournament);
  renderWhatsAppPanel(tournament);
}

function openRenameTournamentModal() {
  renameTournamentInput.value = currentTournamentName;
  renameTournamentModal.classList.remove("hidden");
  renameTournamentInput.focus();
}

openRenameTournamentIconBtn.addEventListener("click", openRenameTournamentModal);

renameTournamentCancel.addEventListener("click", () => {
  renameTournamentModal.classList.add("hidden");
});

renameTournamentSave.addEventListener("click", async () => {
  const name = renameTournamentInput.value.trim();
  if (!name) return;

  const res = await fetch(`/api/tournaments/${tournamentId}`, {
    method: "PATCH",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ name })
  });

  if (!res.ok) return;
  renameTournamentModal.classList.add("hidden");
  await load();
});

renameParticipantCancel.addEventListener("click", () => {
  renameParticipantModal.classList.add("hidden");
  currentParticipantId = "";
});

renameParticipantSave.addEventListener("click", async () => {
  const name = renameParticipantInput.value.trim();
  if (!currentParticipantId || !name) return;

  const res = await fetch(`/api/tournaments/${tournamentId}/participants/${currentParticipantId}`, {
    method: "PATCH",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ name })
  });

  if (!res.ok) return;
  renameParticipantModal.classList.add("hidden");
  currentParticipantId = "";
  await load();
});

deleteTournamentBtn.addEventListener("click", async () => {
  const confirmed = await openModal({
    title: "Eliminar torneo",
    text: "Se eliminará este torneo completo. Esta acción no se puede deshacer.",
    confirmText: "Eliminar"
  });
  if (!confirmed) return;

  const res = await fetch(`/api/tournaments/${tournamentId}`, {
    method: "DELETE",
    headers: adminHeaders()
  });

  if (!res.ok) return;
  window.location.href = "/admin";
});

addParticipantBtn.addEventListener("click", async () => {
  const name = newParticipantNameInput.value.trim();
  if (!name) return;

  const res = await fetch(`/api/tournaments/${tournamentId}/participants`, {
    method: "POST",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ name })
  });

  if (!res.ok) return;
  newParticipantNameInput.value = "";
  await load();
});

saveAdminKeyBtn.addEventListener("click", async () => {
  const key = adminKeyInput.value.trim();
  localStorage.setItem(ADMIN_KEY_STORAGE, key);
  await load();
});

clearAdminKeyBtn.addEventListener("click", async () => {
  localStorage.removeItem(ADMIN_KEY_STORAGE);
  adminKeyInput.value = "";
  await load();
});

sendCustomNotifBtn.addEventListener("click", async () => {
  const participantId = customNotifRecipientSelect.value;
  const title = customNotifTitleInput.value.trim();
  const body = customNotifBodyInput.value.trim();

  if (!title || !body) {
    setNotice(customNotifMsg, "Completá título y mensaje para enviar la notificación.", true);
    return;
  }

  setNotice(customNotifMsg, "");

  const res = await fetch("/api/admin/notifications/custom", {
    method: "POST",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      title,
      body,
      tournamentIds: [tournamentId],
      participantIds: participantId ? [participantId] : undefined
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setNotice(customNotifMsg, data.error ?? "No se pudo enviar la notificación.", true);
    return;
  }

  customNotifBodyInput.value = "";
  setNotice(
    customNotifMsg,
    `Enviado. Participantes notificados: ${data.deliveredParticipants ?? 0}. Notificaciones enviadas: ${data.sentNotifications ?? 0}.`
  );
});

whatsappMatchSelect.addEventListener("change", () => {
  setNotice(whatsappMsg, "");
  refreshWhatsAppPreview();
});

copyWhatsappBtn.addEventListener("click", async () => {
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

adminKeyInput.value = getAdminKey();

load();
