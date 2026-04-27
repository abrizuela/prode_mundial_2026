import { leaderboardTable } from "./common.js";

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

const adminKeyInput = document.querySelector("#adminKey");
const saveAdminKeyBtn = document.querySelector("#saveAdminKey");
const clearAdminKeyBtn = document.querySelector("#clearAdminKey");
const adminAuthMsg = document.querySelector("#adminAuthMsg");

const modal = document.querySelector("#appModal");
const modalTitle = document.querySelector("#modalTitle");
const modalText = document.querySelector("#modalText");
const modalCancel = document.querySelector("#modalCancel");
const modalOk = document.querySelector("#modalOk");

const ADMIN_KEY_STORAGE = "prode_admin_key";
let currentTournamentName = "";

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

function renderParticipants(tournament) {
  if (!tournament.participants.length) {
    links.innerHTML = "<p class=\"muted\">No hay participantes en este torneo.</p>";
    return;
  }

  links.innerHTML = tournament.participants
    .map((p) => `
      <div class="group-box stack" data-participant-id="${p.id}">
        <div class="stack">
          <span>
            <strong>${p.name}</strong>
            ${p.groupLockedAt ? "<span class='tag'>Grupos enviado</span>" : ""}
            ${p.finalLockedAt ? "<span class='tag'>Final enviado</span>" : ""}
          </span>
          <a href="${p.groupUrl}" target="_blank" rel="noreferrer">Link grupos: ${window.location.origin}${p.groupUrl}</a>
          <a href="${p.finalUrl}" target="_blank" rel="noreferrer">Link fase final: ${window.location.origin}${p.finalUrl}</a>
        </div>
        <div class="row">
          <input data-participant-name value="${p.name}" />
          <button data-action="rename-participant">Guardar nombre</button>
          <button class='secondary' data-action='unlock-group'>Habilitar grupos</button>
          <button class='secondary' data-action='unlock-final'>Habilitar fase final</button>
          <button class="danger" data-action="delete-participant">Eliminar</button>
        </div>
      </div>
    `)
    .join("");

  links.querySelectorAll("button[data-action='rename-participant']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const card = btn.closest("[data-participant-id]");
      const participantId = card?.dataset.participantId;
      const name = card?.querySelector("input[data-participant-name]")?.value?.trim() ?? "";
      if (!participantId || !name) return;

      const res = await fetch(`/api/tournaments/${tournamentId}/participants/${participantId}`, {
        method: "PATCH",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ name })
      });

      if (!res.ok) return;
      await load();
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
      const card = btn.closest("[data-participant-id]");
      const participantId = card?.dataset.participantId;
      if (!participantId) return;

      const confirmed = await openModal({
        title: "Habilitar grupos",
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
      const card = btn.closest("[data-participant-id]");
      const participantId = card?.dataset.participantId;
      if (!participantId) return;

      const confirmed = await openModal({
        title: "Habilitar fase final",
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
}

function renderLeaderboard(leaderboard) {
  leaderboardEl.innerHTML = leaderboardTable(leaderboard);
}

async function load() {
  const ok = await validateAdminKey();
  if (!ok) {
    title.textContent = "Panel admin bloqueado";
    links.innerHTML = "";
    leaderboardEl.innerHTML = "";
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

  renderParticipants(tournament);
  renderLeaderboard(data.leaderboard);
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

adminKeyInput.value = getAdminKey();

load();
