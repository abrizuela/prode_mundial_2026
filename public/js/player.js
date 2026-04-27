import { ROUND_ORDER, byGroup, computeRoundTeams, countryLabel, leaderboardTable, roundCount } from "./common.js";

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

const parts = window.location.pathname.split("/").filter(Boolean);
const token = parts[1] ?? "";
const stage = (parts[2] === "final" ? "final" : "group");

const title = document.querySelector("#title");
const titleText = title?.querySelector("span");
const subtitle = document.querySelector("#subtitle");
const heroHint = document.querySelector("#heroHint");
const leaderboardSection = document.querySelector("#leaderboardSection");
const groupsWrap = document.querySelector("#groups");
const knockoutWrap = document.querySelector("#knockout");
const leaderboardEl = document.querySelector("#leaderboard");

const submitBtn = document.querySelector("#submitBtn");
const submitMsg = document.querySelector("#submitMsg");

const lockNotice = document.querySelector("#lockNotice");
const lockedAt = document.querySelector("#lockedAt");

const bonusChampion = document.querySelector("#bonusChampion");
const bonusRunnerUp = document.querySelector("#bonusRunnerUp");
const bonusThird = document.querySelector("#bonusThird");
const bonusFourth = document.querySelector("#bonusFourth");

const bonusSection = document.querySelector("#bonusSection");
const groupsSection = document.querySelector("#groupsSection");
const knockoutSection = document.querySelector("#knockoutSection");
const submitSection = document.querySelector("#submitSection");
const groupSubmitSlot = document.querySelector("#groupSubmitSlot");
const finalSubmitSlot = document.querySelector("#finalSubmitSlot");
const enableKickoffNotifBtn = document.querySelector("#enableKickoffNotif");
const disableKickoffNotifBtn = document.querySelector("#disableKickoffNotif");
const notifStatus = document.querySelector("#notifStatus");

const modal = document.querySelector("#appModal");
const modalTitle = document.querySelector("#modalTitle");
const modalText = document.querySelector("#modalText");
const modalCancel = document.querySelector("#modalCancel");
const modalOk = document.querySelector("#modalOk");

let state = null;
const NOTIF_ENABLED_KEY = `prode_push_enabled_${token}`;
const NOTIF_MODAL_SEEN_KEY = `prode_push_modal_seen_${token}`;
let currentKnockout = {
  R16: {},
  OCT: {},
  QF: {},
  SF: {},
  THIRD: {},
  FINAL: {}
};

function openModal({ title, text, confirmText = "Aceptar", cancelText = "Cancelar", showCancel = true }) {
  modalTitle.textContent = title;
  modalText.textContent = text;
  modalOk.textContent = confirmText;
  modalCancel.textContent = cancelText;
  modalCancel.style.display = showCancel ? "inline-block" : "none";
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

function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
}

function notificationsEnabled() {
  return localStorage.getItem(NOTIF_ENABLED_KEY) === "1";
}

function setNotificationsEnabled(value) {
  localStorage.setItem(NOTIF_ENABLED_KEY, value ? "1" : "0");
}

function refreshNotificationStatus() {
  if (!notificationsSupported()) {
    notifStatus.textContent = "Este navegador no soporta notificaciones push en segundo plano.";
    return;
  }

  const permission = Notification.permission=== "granted" ? "Concedido" : "Rechazado";
  const status = notificationsEnabled() ? "Activadas" : "Desactivadas";
  notifStatus.textContent = `Estado: ${status} · Permiso: ${permission}`;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function registerPushSubscription() {
  if (!notificationsSupported()) {
    refreshNotificationStatus();
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    setNotificationsEnabled(false);
    refreshNotificationStatus();
    return;
  }

  const reg = await navigator.serviceWorker.register("/sw.js");
  const keyRes = await fetch("/api/push/public-key");
  const keyData = await keyRes.json();
  const applicationServerKey = urlBase64ToUint8Array(keyData.publicKey);

  const existing = await reg.pushManager.getSubscription();
  const subscription = existing ?? await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey
  });

  await fetch(`/api/p/${token}/push-subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON() })
  });

  setNotificationsEnabled(true);
  refreshNotificationStatus();
}

async function unregisterPushSubscription() {
  if (!notificationsSupported()) {
    refreshNotificationStatus();
    return;
  }

  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();

  if (sub) {
    await fetch(`/api/p/${token}/push-subscription`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint })
    });
    await sub.unsubscribe();
  }

  setNotificationsEnabled(false);
  refreshNotificationStatus();
}

function getGroupOutcomeMark(matchId, predicted) {
  const actual = state?.tournament?.actual?.group?.[matchId];
  if (!actual || !predicted) return "";
  return actual === predicted
    ? '<span class="outcome-mark outcome-hit" aria-label="Acertado">✓</span>'
    : '<span class="outcome-mark outcome-miss" aria-label="No acertado">✕</span>';
}

function getKnockoutOutcomeMark(round, matchId, predicted) {
  const actual = state?.tournament?.actual?.knockout?.[round]?.[matchId];
  if (!actual || !predicted) return "";
  return actual === predicted
    ? '<span class="outcome-mark outcome-hit" aria-label="Acertado">✓</span>'
    : '<span class="outcome-mark outcome-miss" aria-label="No acertado">✕</span>';
}

function renderGroups(tournament, predictions, options = {}) {
  const collapsed = Boolean(options.collapsed);
  const grouped = byGroup(tournament.groupMatches);
  groupsWrap.innerHTML = [...grouped.entries()]
    .map(([group, matches]) => `
      <details class="group-box" ${collapsed ? "" : "open"}>
        <summary><strong>Grupo ${group}</strong></summary>
        <div class="stack" style="margin-top:8px;">
          ${matches
            .map((m) => `
              <div class="match-line" style="grid-template-columns:1fr auto auto;">
                <span>${countryLabel(m.home)} vs ${countryLabel(m.away)}</span>
                <div class="dt-cell">
                  <span class="dt-text">${m.kickoffAt ? formatDate(m.kickoffAt) : "Sin fecha"}</span>
                </div>
                <div class="result-cell">
                  <div class="result-row">
                    <select data-group-match="${m.id}">
                      <option value="">-</option>
                      <option value="L" ${predictions.group[m.id] === "L" ? "selected" : ""}>L</option>
                      <option value="E" ${predictions.group[m.id] === "E" ? "selected" : ""}>E</option>
                      <option value="V" ${predictions.group[m.id] === "V" ? "selected" : ""}>V</option>
                    </select>
                    ${getGroupOutcomeMark(m.id, predictions.group[m.id])}
                  </div>
                </div>
              </div>
            `)
            .join("")}
        </div>
      </details>
    `)
    .join("");
}

function renderKnockout(tournament) {
  const teams = computeRoundTeams(tournament.knockoutMatches.R16, currentKnockout);

  knockoutWrap.innerHTML = ROUND_ORDER.map((round) => {
    const count = roundCount(round);
    const lines = Array.from({ length: count }).map((_, i) => {
      const matchId = `${round}-${i + 1}`;
      const t = teams[round][i] || { home: "POR DEFINIR", away: "POR DEFINIR" };
      const kickoff = tournament.knockoutMatches?.[round]?.find((m) => m.id === matchId)?.kickoffAt;
      return `
        <div class="match-line">
          <span>${countryLabel(t.home)} vs ${countryLabel(t.away)}${kickoff ? ` · ${formatDate(kickoff)}` : ""}</span>
          <div class="result-cell">
            <div class="result-row">
              <select data-round="${round}" data-match="${matchId}">
                <option value="">-</option>
                <option value="L" ${currentKnockout[round][matchId] === "L" ? "selected" : ""}>L</option>
                <option value="V" ${currentKnockout[round][matchId] === "V" ? "selected" : ""}>V</option>
              </select>
              ${getKnockoutOutcomeMark(round, matchId, currentKnockout[round][matchId])}
            </div>
          </div>
        </div>
      `;
    });

    return `<div class="group-box stack"><h3>${round}</h3>${lines.join("")}</div>`;
  }).join("");

  knockoutWrap.querySelectorAll("select[data-round]").forEach((s) => {
    s.addEventListener("change", () => {
      const round = s.dataset.round;
      const match = s.dataset.match;
      if (!currentKnockout[round]) currentKnockout[round] = {};
      if (s.value) currentKnockout[round][match] = s.value;
      else delete currentKnockout[round][match];
      renderKnockout(tournament);
    });
  });
}

function readGroupFormData() {
  const group = {};
  groupsWrap.querySelectorAll("select[data-group-match]").forEach((s) => {
    if (s.value) group[s.dataset.groupMatch] = s.value;
  });

  const bonus = {
    champion: bonusChampion.value.trim(),
    runnerUp: bonusRunnerUp.value.trim(),
    third: bonusThird.value.trim(),
    fourth: bonusFourth.value.trim()
  };

  return { group, bonus };
}

function readFinalFormData() {
  return {
    knockout: currentKnockout
  };
}

function getMissingSelectionsCount() {
  if (stage === "group") {
    const selects = [...groupsWrap.querySelectorAll("select[data-group-match]")];
    return selects.filter((s) => !s.value).length;
  }

  const selects = [...knockoutWrap.querySelectorAll("select[data-round]")];
  return selects.filter((s) => !s.value).length;
}

function getMissingBonusLabels() {
  const missing = [];
  if (!bonusChampion.value) missing.push("Campeón");
  if (!bonusRunnerUp.value) missing.push("Subcampeón");
  if (!bonusThird.value) missing.push("Tercero");
  if (!bonusFourth.value) missing.push("Cuarto");
  return missing;
}

function setReadOnlyMode(readOnly) {
  const editableFields = [
    ...bonusSection.querySelectorAll("select, input, textarea"),
    ...groupsSection.querySelectorAll("select, input, textarea"),
    ...knockoutSection.querySelectorAll("select, input, textarea")
  ];

  editableFields.forEach((el) => {
    el.disabled = readOnly;
  });
}

function lockUI(lockedTime, stageLabel) {
  submitSection.style.display = "none";
  lockNotice.style.display = "block";
  lockedAt.textContent = `${stageLabel} enviado: ${formatDate(lockedTime)}`;
  setReadOnlyMode(true);
}

function applyStageLayout(participant) {
  setReadOnlyMode(false);
  lockNotice.style.display = "none";
  lockedAt.textContent = "";
  submitSection.style.display = "block";

  const stageSubmitted = stage === "group"
    ? Boolean(participant.predictions.groupLockedAt)
    : Boolean(participant.predictions.finalLockedAt);
  leaderboardSection.style.display = stageSubmitted ? "" : "none";
  heroHint.style.display = stageSubmitted ? "none" : "";

  if (stage === "group") {
    if (groupSubmitSlot && submitSection.parentElement !== groupSubmitSlot) {
      groupSubmitSlot.appendChild(submitSection);
    }
    bonusSection.style.display = "block";
    groupsSection.style.display = "block";
    knockoutSection.style.display = "none";
    submitBtn.textContent = "Enviar fase de grupos";

    if (participant.predictions.groupLockedAt) {
      lockUI(participant.predictions.groupLockedAt, "Fase de grupos");
    }
  } else {
    if (finalSubmitSlot && submitSection.parentElement !== finalSubmitSlot) {
      finalSubmitSlot.appendChild(submitSection);
    }
    bonusSection.style.display = "none";
    groupsSection.style.display = "none";
    knockoutSection.style.display = "block";
    submitBtn.textContent = "Enviar fase final";

    if (!participant.predictions.groupLockedAt) {
      submitSection.style.display = "none";
      lockNotice.style.display = "block";
      lockedAt.textContent = "Primero tenés que completar la fase de grupos.";
      return;
    }

    if (participant.predictions.finalLockedAt) {
      lockUI(participant.predictions.finalLockedAt, "Fase final");
    }
  }
}

async function showNotificationOptinOnOpen() {
  if (!notificationsSupported()) return;
  if (localStorage.getItem(NOTIF_MODAL_SEEN_KEY) === "1") return;

  localStorage.setItem(NOTIF_MODAL_SEEN_KEY, "1");
  const enable = await openModal({
    title: "Notificaciones",
    text: "Querés activar notificaciones para recibir avisos 5 minutos antes de los partidos?",
    confirmText: "Activar",
    cancelText: "No, gracias"
  });

  if (enable) {
    await registerPushSubscription();
  } else {
    await unregisterPushSubscription();
  }
}

async function load() {
  const res = await fetch(`/api/p/${token}`);
  const data = await res.json();

  if (!res.ok) {
    title.textContent = "Link inválido";
    subtitle.textContent = data.error ?? "No se encontro informacion";
    return;
  }

  state = data;

  const playerPageTitle = `PRODE Mundial 2026: ${data.tournament.name}`;
  if (titleText) titleText.textContent = playerPageTitle;
  else title.textContent = playerPageTitle;
  document.title = playerPageTitle;
  const alreadySubmitted = stage === "group"
    ? Boolean(data.participant.predictions.groupLockedAt)
    : Boolean(data.participant.predictions.finalLockedAt);
  subtitle.textContent = alreadySubmitted
    ? `Hola ${data.participant.name}.`
    : `Hola ${data.participant.name}. ${stage === "group" ? "Completa fase de grupos + bonus." : "Completa fase final."}`;

  currentKnockout = {
    R16: { ...(data.participant.predictions.knockout.R16 || {}) },
    OCT: { ...(data.participant.predictions.knockout.OCT || {}) },
    QF: { ...(data.participant.predictions.knockout.QF || {}) },
    SF: { ...(data.participant.predictions.knockout.SF || {}) },
    THIRD: { ...(data.participant.predictions.knockout.THIRD || {}) },
    FINAL: { ...(data.participant.predictions.knockout.FINAL || {}) }
  };

  const allTeams = [...new Set(
    data.tournament.groupMatches.flatMap((m) => [m.home, m.away])
  )].sort((a, b) => a.localeCompare(b, "es"));

  const bonusOptions = `<option value="">Seleccionar</option>` +
    allTeams.map((t) => `<option value="${t}">${countryLabel(t)}</option>`).join("");

  for (const sel of [bonusChampion, bonusRunnerUp, bonusThird, bonusFourth]) {
    sel.innerHTML = bonusOptions;
  }

  bonusChampion.value = data.participant.predictions.bonus.champion || "";
  bonusRunnerUp.value = data.participant.predictions.bonus.runnerUp || "";
  bonusThird.value = data.participant.predictions.bonus.third || "";
  bonusFourth.value = data.participant.predictions.bonus.fourth || "";

  const groupAlreadySubmitted = Boolean(data.participant.predictions.groupLockedAt);
  renderGroups(data.tournament, data.participant.predictions, { collapsed: groupAlreadySubmitted });
  renderKnockout(data.tournament);
  leaderboardEl.innerHTML = leaderboardTable(data.leaderboard);

  applyStageLayout(data.participant);
  refreshNotificationStatus();
  await showNotificationOptinOnOpen();
}

submitBtn.addEventListener("click", async () => {
  submitMsg.textContent = "";

  const missingBonus = getMissingBonusLabels();
  if (missingBonus.length > 0) {
    await openModal({
      title: "Faltan bonus",
      text: `Debés completar los bonus antes de enviar. Falta: ${missingBonus.join(", ")}.`,
      confirmText: "Entendido",
      showCancel: false
    });
    return;
  }

  const missingCount = getMissingSelectionsCount();
  if (missingCount > 0) {
    await openModal({
      title: "Faltan resultados",
      text: `Tenés ${missingCount} partido${missingCount === 1 ? "" : "s"} sin completar. Debés cargar todos los resultados antes de enviar.`,
      confirmText: "Entendido",
      showCancel: false
    });
    return;
  }

  const confirmed = await openModal({
    title: "Confirmar envío",
    text: `Vas a enviar la ${stage === "group" ? "fase de grupos" : "fase final"}. Después no vas a poder modificarla.`,
    confirmText: "Sí, enviar",
    cancelText: "Cancelar"
  });
  if (!confirmed) return;

  const endpoint = stage === "group" ? `/api/p/${token}/submit-group` : `/api/p/${token}/submit-final`;
  const payload = stage === "group" ? readGroupFormData() : readFinalFormData();

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();

  if (!res.ok) {
    await openModal({
      title: "No se pudo enviar",
      text: data.error ?? "No se pudo guardar",
      confirmText: "Cerrar",
      showCancel: false
    });
    return;
  }

  submitMsg.textContent = `${stage === "group" ? "Fase de grupos" : "Fase final"} enviada y bloqueada.`;
  await load();
});

enableKickoffNotifBtn.addEventListener("click", async () => {
  await registerPushSubscription();
});

disableKickoffNotifBtn.addEventListener("click", async () => {
  await unregisterPushSubscription();
});

load();
