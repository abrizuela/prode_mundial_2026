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

const title = document.querySelector("#title");
const titleText = title?.querySelector("span");
const subtitle = document.querySelector("#subtitle");
const heroHint = document.querySelector("#heroHint");
const leaderboardSection = document.querySelector("#leaderboardSection");
const groupsWrap = document.querySelector("#groups");
const knockoutWrap = document.querySelector("#knockout");
const leaderboardEl = document.querySelector("#leaderboard");

const submitGroupBtn = document.querySelector("#submitGroupBtn");
const submitGroupMsg = document.querySelector("#submitGroupMsg");
const submitFinalBtn = document.querySelector("#submitFinalBtn");
const submitFinalMsg = document.querySelector("#submitFinalMsg");

const lockNotice = document.querySelector("#lockNotice");
const lockedAt = document.querySelector("#lockedAt");

const bonusChampion = document.querySelector("#bonusChampion");
const bonusRunnerUp = document.querySelector("#bonusRunnerUp");
const bonusThird = document.querySelector("#bonusThird");
const bonusFourth = document.querySelector("#bonusFourth");

const bonusSection = document.querySelector("#bonusSection");
const groupsSection = document.querySelector("#groupsSection");
const knockoutSection = document.querySelector("#knockoutSection");
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

const ROUND_LABELS = {
  R16: "16vos de final",
  OCT: "8vos de final",
  QF: "Cuartos de final",
  SF: "Semifinales",
  THIRD: "Tercer puesto",
  FINAL: "Final"
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
    notifStatus.innerHTML = "Estado: <span class=\"status-chip is-neutral\">No disponible</span>";
    return;
  }

  const permissionState = Notification.permission;
  const permission = permissionState === "granted"
    ? "Concedido"
    : permissionState === "denied"
      ? "Rechazado"
      : "Pendiente";
  const permissionClass = permissionState === "granted"
    ? "is-granted"
    : permissionState === "denied"
      ? "is-denied"
      : "is-pending";

  const status = notificationsEnabled() ? "Activadas" : "Desactivadas";
  const statusClass = notificationsEnabled() ? "is-on" : "is-off";

  notifStatus.innerHTML = `Estado: <span class="status-chip ${statusClass}">${status}</span> · Permiso: <span class="status-chip ${permissionClass}">${permission}</span>`;
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

function renderKnockout(tournament, openRounds) {
  const teams = computeRoundTeams(tournament.knockoutMatches.R16, currentKnockout);
  const keptOpenRounds = openRounds ?? new Set(
    [...knockoutWrap.querySelectorAll("details[data-round][open]")].map((el) => el.dataset.round)
  );
  knockoutWrap.classList.add("stack");

  knockoutWrap.innerHTML = ROUND_ORDER.map((round) => {
    const count = roundCount(round);
    const lines = Array.from({ length: count }).map((_, i) => {
      const matchId = `${round}-${i + 1}`;
      const t = teams[round][i] || { home: "POR DEFINIR", away: "POR DEFINIR" };
      const kickoff = tournament.knockoutMatches?.[round]?.find((m) => m.id === matchId)?.kickoffAt;
      return `
        <div class="match-line" style="grid-template-columns:1fr auto auto;">
          <span>${countryLabel(t.home)} vs ${countryLabel(t.away)}</span>
          <div class="dt-cell">
            <span class="dt-text">${kickoff ? formatDate(kickoff) : "Sin fecha"}</span>
          </div>
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

    const roundLabel = ROUND_LABELS[round] ?? round;

    return `
      <details class="group-box" data-round="${round}" ${keptOpenRounds.has(round) ? "open" : ""}>
        <summary><strong>${roundLabel}</strong></summary>
        <div class="stack" style="margin-top:8px;">
          ${lines.join("")}
        </div>
      </details>
    `;
  }).join("");

  knockoutWrap.querySelectorAll("select[data-round]").forEach((s) => {
    s.addEventListener("change", () => {
      const round = s.dataset.round;
      const match = s.dataset.match;
      const nextOpenRounds = new Set(
        [...knockoutWrap.querySelectorAll("details[data-round][open]")].map((el) => el.dataset.round)
      );
      if (!currentKnockout[round]) currentKnockout[round] = {};
      if (s.value) currentKnockout[round][match] = s.value;
      else delete currentKnockout[round][match];
      nextOpenRounds.add(round);
      renderKnockout(tournament, nextOpenRounds);
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

function getMissingGroupSelectionsCount() {
  const selects = [...groupsWrap.querySelectorAll("select[data-group-match]")];
  return selects.filter((s) => !s.value).length;
}

function getMissingFinalSelectionsCount() {
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

function setSectionReadOnly(section, readOnly) {
  section.querySelectorAll("select, input, textarea").forEach((el) => {
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
  bonusSection.style.display = "block";
  groupsSection.style.display = "block";
  knockoutSection.style.display = "block";

  const groupSubmitted = Boolean(participant.predictions.groupLockedAt);
  const finalSubmitted = Boolean(participant.predictions.finalLockedAt);
  const finalStageEnabled = Boolean(state?.tournament?.finalStageEnabled);
  leaderboardSection.style.display = (groupSubmitted || finalSubmitted) ? "" : "none";
  heroHint.style.display = finalSubmitted ? "none" : "";

  submitGroupBtn.disabled = groupSubmitted;
  if (groupSubmitted) {
    setSectionReadOnly(bonusSection, true);
    setSectionReadOnly(groupsSection, true);
    submitGroupMsg.textContent = `Fase de grupos enviada: ${formatDate(participant.predictions.groupLockedAt)}.`;
  } else {
    submitGroupMsg.textContent = "";
  }

  if (!groupSubmitted) {
    setSectionReadOnly(knockoutSection, true);
    submitFinalBtn.disabled = true;
    submitFinalMsg.textContent = "Primero completá y enviá la fase de grupos.";
    return;
  }

  if (!finalStageEnabled) {
    setSectionReadOnly(knockoutSection, true);
    submitFinalBtn.disabled = true;
    submitFinalMsg.textContent = "La fase final todavía no está habilitada.";
    return;
  }

  if (finalSubmitted) {
    setSectionReadOnly(knockoutSection, true);
    submitFinalBtn.disabled = true;
    submitFinalMsg.textContent = `Fase final enviada: ${formatDate(participant.predictions.finalLockedAt)}.`;
  } else {
    submitFinalBtn.disabled = false;
    submitFinalMsg.textContent = "";
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
  subtitle.textContent = `Hola ${data.participant.name}. Completá grupos y luego fase final desde este mismo panel.`;

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

submitGroupBtn.addEventListener("click", async () => {
  submitGroupMsg.textContent = "";

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

  const missingCount = getMissingGroupSelectionsCount();
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
    text: "Vas a enviar la fase de grupos. Después no vas a poder modificarla.",
    confirmText: "Sí, enviar",
    cancelText: "Cancelar"
  });
  if (!confirmed) return;

  const res = await fetch(`/api/p/${token}/submit-group`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(readGroupFormData())
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

  submitGroupMsg.textContent = "Fase de grupos enviada y bloqueada.";
  await load();
});

submitFinalBtn.addEventListener("click", async () => {
  submitFinalMsg.textContent = "";

  const missingCount = getMissingFinalSelectionsCount();
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
    text: "Vas a enviar la fase final. Después no vas a poder modificarla.",
    confirmText: "Sí, enviar",
    cancelText: "Cancelar"
  });
  if (!confirmed) return;

  const res = await fetch(`/api/p/${token}/submit-final`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(readFinalFormData())
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

  submitFinalMsg.textContent = "Fase final enviada y bloqueada.";
  await load();
});

enableKickoffNotifBtn.addEventListener("click", async () => {
  await registerPushSubscription();
});

disableKickoffNotifBtn.addEventListener("click", async () => {
  await unregisterPushSubscription();
});

load();
