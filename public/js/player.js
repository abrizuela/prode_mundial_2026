import { GROUP_RESULT, KNOCKOUT_RESULT, ROUND_ORDER, byGroup, computeRoundTeams, countryLabel, leaderboardTable, roundCount } from "./common.js";

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
const phaseNotice = document.querySelector("#phaseNotice");
const leaderboardSection = document.querySelector("#leaderboardSection");
const groupsWrap = document.querySelector("#groups");
const knockoutWrap = document.querySelector("#knockout");
const leaderboardEl = document.querySelector("#leaderboard");

const submitGroupMsg = document.querySelector("#submitGroupMsg");
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
const groupsStageDetails = document.querySelector("#groupsStageDetails");
const knockoutStageDetails = document.querySelector("#knockoutStageDetails");
const enableKickoffNotifBtn = document.querySelector("#enableKickoffNotif");
const disableKickoffNotifBtn = document.querySelector("#disableKickoffNotif");
const notifStatus = document.querySelector("#notifStatus");

const modal = document.querySelector("#appModal");
const modalTitle = document.querySelector("#modalTitle");
const modalText = document.querySelector("#modalText");
const modalCancel = document.querySelector("#modalCancel");
const modalOk = document.querySelector("#modalOk");

let state = null;
let isLoading = false;
const flashTimers = new WeakMap();
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
let groupSaveTimer = null;
let finalSaveTimer = null;
const touchedGroupMatches = new Set();
const touchedFinalMatches = new Set();
const GROUPS_COLLAPSED_KEY = "prode_player_groups_collapsed";
const KNOCKOUT_COLLAPSED_KEY = "prode_player_knockout_collapsed";

const ROUND_LABELS = {
  R16: "16vos de final",
  OCT: "8vos de final",
  QF: "Cuartos de final",
  SF: "Semifinales",
  THIRD: "Tercer puesto",
  FINAL: "Final"
};

function getEditDeadline(matches) {
  const kickoffTimes = matches
    .map((m) => (m?.kickoffAt ? new Date(m.kickoffAt).getTime() : Number.NaN))
    .filter((v) => Number.isFinite(v));

  if (!kickoffTimes.length) return null;
  const firstKickoff = Math.min(...kickoffTimes);
  return new Date(firstKickoff - 60 * 60 * 1000);
}

function isPast(dateOrNull) {
  if (!dateOrNull) return false;
  return Date.now() >= dateOrNull.getTime();
}

function canEditGroup(participant, tournament) {
  return Boolean(tournament);
}

function canEditFinal(participant, tournament) {
  if (!tournament.finalStageEnabled) return false;
  return true;
}

function hasKickoffStarted(kickoffAt) {
  if (!kickoffAt) return false;
  const kickoffTs = new Date(kickoffAt).getTime();
  if (!Number.isFinite(kickoffTs)) return false;
  return Date.now() >= kickoffTs;
}

function refreshPhaseNotice() {
  if (!phaseNotice) return;
  const finalStageEnabled = Boolean(state?.tournament?.finalStageEnabled);

  const groupPending = [...groupsWrap.querySelectorAll("select[data-group-match]")]
    .filter((select) => !select.disabled && !select.value)
    .length;
  const finalPending = finalStageEnabled
    ? [...knockoutWrap.querySelectorAll("select[data-round]")]
      .filter((select) => !select.disabled && !select.value)
      .length
    : 0;

  const parts = [];
  if (groupPending > 0) {
    parts.push(`Fase de grupos incompleta: faltan ${groupPending} resultado(s).`);
  }
  if (finalStageEnabled && finalPending > 0) {
    parts.push(`Fase final incompleta: faltan ${finalPending} resultado(s).`);
  }

  phaseNotice.textContent = parts.join(" ");
}

function showAutosaveMessage(el, text, isError = false) {
  el.textContent = text;
  el.style.color = isError ? "#a62d2d" : "";
}

function initSectionCollapseControls() {
  const groupsCollapsed = localStorage.getItem(GROUPS_COLLAPSED_KEY) === "1";
  const knockoutCollapsed = localStorage.getItem(KNOCKOUT_COLLAPSED_KEY) === "1";

  if (groupsStageDetails) {
    groupsStageDetails.open = !groupsCollapsed;
    groupsStageDetails.addEventListener("toggle", () => {
      localStorage.setItem(GROUPS_COLLAPSED_KEY, groupsStageDetails.open ? "0" : "1");
    });
  }

  if (knockoutStageDetails) {
    knockoutStageDetails.open = !knockoutCollapsed;
    knockoutStageDetails.addEventListener("toggle", () => {
      localStorage.setItem(KNOCKOUT_COLLAPSED_KEY, knockoutStageDetails.open ? "0" : "1");
    });
  }
}

function setStageDetailsOpen(detailsEl, open) {
  if (!detailsEl) return;
  detailsEl.open = open;
}

function syncStageDetailsVisibility() {
  const groupsVisible = groupsSection.style.display !== "none";
  const knockoutVisible = knockoutSection.style.display !== "none";
  if (groupsVisible) {
    setStageDetailsOpen(groupsStageDetails, localStorage.getItem(GROUPS_COLLAPSED_KEY) !== "1");
  }
  if (knockoutVisible) {
    setStageDetailsOpen(knockoutStageDetails, localStorage.getItem(KNOCKOUT_COLLAPSED_KEY) !== "1");
  }
}

function flashMessage(target, text, isError = false) {
  if (!target) return;

  const prev = flashTimers.get(target);
  if (prev) clearTimeout(prev);

  target.style.opacity = "1";
  target.style.color = isError ? "#b02a37" : "";
  target.textContent = text;

  const timer = window.setTimeout(() => {
    target.style.opacity = "0";
    window.setTimeout(() => {
      target.textContent = "";
      target.style.color = "";
      target.style.opacity = "1";
    }, 200);
  }, 2200);

  flashTimers.set(target, timer);
}

function flashTouchedGroupMatches(text, isError = false) {
  for (const matchId of touchedGroupMatches) {
    const flash = groupsWrap.querySelector(`[data-group-save-flash="${matchId}"]`);
    flashMessage(flash, text, isError);
  }
  touchedGroupMatches.clear();
}

function flashTouchedFinalMatches(text, isError = false) {
  for (const key of touchedFinalMatches) {
    const [round, matchId] = key.split("|");
    const flash = knockoutWrap.querySelector(
      `[data-final-round="${round}"][data-final-save-flash="${matchId}"]`
    );
    flashMessage(flash, text, isError);
  }
  touchedFinalMatches.clear();
}

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

function renderGroupResultOptions(match, selectedValue) {
  return `
    <option value="">-</option>
    <option value="${GROUP_RESULT.HOME}" ${selectedValue === GROUP_RESULT.HOME ? "selected" : ""}>${countryLabel(match.home)}</option>
    <option value="${GROUP_RESULT.DRAW}" ${selectedValue === GROUP_RESULT.DRAW ? "selected" : ""}>🫱🏼‍🫲🏼 Empate</option>
    <option value="${GROUP_RESULT.AWAY}" ${selectedValue === GROUP_RESULT.AWAY ? "selected" : ""}>${countryLabel(match.away)}</option>
  `;
}

function renderKnockoutResultOptions(homeTeam, awayTeam, selectedValue) {
  return `
    <option value="">-</option>
    <option value="${KNOCKOUT_RESULT.HOME}" ${selectedValue === KNOCKOUT_RESULT.HOME ? "selected" : ""}>${countryLabel(homeTeam)}</option>
    <option value="${KNOCKOUT_RESULT.AWAY}" ${selectedValue === KNOCKOUT_RESULT.AWAY ? "selected" : ""}>${countryLabel(awayTeam)}</option>
  `;
}

function syncPredictionSelectWidths() {
  const selects = [
    ...document.querySelectorAll("#groups .result-row select, #knockout .result-row select")
  ];

  if (!selects.length) return;

  const canvas = syncPredictionSelectWidths.canvas || document.createElement("canvas");
  syncPredictionSelectWidths.canvas = canvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const style = window.getComputedStyle(selects[0]);
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

  let maxTextWidth = 0;
  for (const select of selects) {
    for (const option of select.options) {
      maxTextWidth = Math.max(maxTextWidth, ctx.measureText(option.textContent ?? "").width);
    }
  }

  const horizontalChrome = 54;
  const width = Math.ceil(maxTextWidth + horizontalChrome);
  document.documentElement.style.setProperty("--player-result-select-width", `${width}px`);
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
                <div class="result-cell player-result-cell">
                  <div class="result-row">
                    <select data-group-match="${m.id}" ${hasKickoffStarted(m.kickoffAt) ? "disabled" : ""}>
                      ${renderGroupResultOptions(m, predictions.group[m.id])}
                    </select>
                    ${getGroupOutcomeMark(m.id, predictions.group[m.id])}
                  </div>
                  <span class="save-flash" data-group-save-flash="${m.id}"></span>
                </div>
              </div>
            `)
            .join("")}
        </div>
      </details>
    `)
    .join("");

  groupsWrap.querySelectorAll("select[data-group-match]").forEach((s) => {
    s.addEventListener("change", () => {
      touchedGroupMatches.add(s.dataset.groupMatch);
      scheduleGroupAutosave();
      refreshPhaseNotice();
    });
  });

  syncPredictionSelectWidths();
  refreshPhaseNotice();
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
          <div class="result-cell player-result-cell">
            <div class="result-row">
              <select data-round="${round}" data-match="${matchId}" ${hasKickoffStarted(kickoff) ? "disabled" : ""}>
                ${renderKnockoutResultOptions(t.home, t.away, currentKnockout[round][matchId])}
              </select>
              ${getKnockoutOutcomeMark(round, matchId, currentKnockout[round][matchId])}
            </div>
            <span class="save-flash" data-final-round="${round}" data-final-save-flash="${matchId}"></span>
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
      touchedFinalMatches.add(`${round}|${match}`);
      nextOpenRounds.add(round);
      scheduleFinalAutosave();
      renderKnockout(tournament, nextOpenRounds);
    });
  });

  syncPredictionSelectWidths();
  refreshPhaseNotice();
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

async function saveGroupDraft() {
  if (!state) return;
  if (!canEditGroup(state.participant, state.tournament)) return;

  const res = await fetch(`/api/p/${token}/submit-group`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(readGroupFormData())
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    showAutosaveMessage(submitGroupMsg, data.error ?? "No se pudo guardar", true);
    flashTouchedGroupMatches("Error al guardar", true);
    return;
  }

  showAutosaveMessage(submitGroupMsg, `Guardado automático: ${formatDate(new Date().toISOString())}.`);
  flashTouchedGroupMatches("Resultado guardado");
}

async function saveFinalDraft() {
  if (!state) return;
  if (!canEditFinal(state.participant, state.tournament)) return;

  const res = await fetch(`/api/p/${token}/submit-final`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(readFinalFormData())
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    showAutosaveMessage(submitFinalMsg, data.error ?? "No se pudo guardar", true);
    flashTouchedFinalMatches("Error al guardar", true);
    return;
  }

  showAutosaveMessage(submitFinalMsg, `Guardado automático: ${formatDate(new Date().toISOString())}.`);
  flashTouchedFinalMatches("Resultado guardado");
}

function scheduleGroupAutosave() {
  showAutosaveMessage(submitGroupMsg, "Guardando...");
  if (groupSaveTimer) clearTimeout(groupSaveTimer);
  groupSaveTimer = setTimeout(() => {
    void saveGroupDraft();
  }, 350);
}

function scheduleFinalAutosave() {
  showAutosaveMessage(submitFinalMsg, "Guardando...");
  if (finalSaveTimer) clearTimeout(finalSaveTimer);
  finalSaveTimer = setTimeout(() => {
    void saveFinalDraft();
  }, 350);
}

function setSectionReadOnly(section, readOnly) {
  section.querySelectorAll("select, input, textarea").forEach((el) => {
    el.disabled = readOnly;
  });
}

function applyStageLayout(participant) {
  // Group/knockout per-match disabled state is applied at render time and must
  // not be globally re-enabled here.
  setSectionReadOnly(bonusSection, false);
  lockNotice.style.display = "none";
  lockedAt.textContent = "";
  bonusSection.style.display = "block";
  groupsSection.style.display = "block";
  knockoutSection.style.display = "block";

  const groupDeadline = getEditDeadline(state?.tournament?.groupMatches || []);
  const finalDeadline = getEditDeadline(ROUND_ORDER.flatMap((round) => state?.tournament?.knockoutMatches?.[round] || []));
  const groupClosedByTime = isPast(groupDeadline);
  const finalClosedByTime = isPast(finalDeadline);
  const finalStageEnabled = Boolean(state?.tournament?.finalStageEnabled);
  leaderboardSection.style.display = "";
  heroHint.style.display = "";

  if (groupClosedByTime) {
    setSectionReadOnly(bonusSection, true);
    showAutosaveMessage(submitGroupMsg, "Los partidos iniciados no se pueden editar.");
  } else {
    showAutosaveMessage(submitGroupMsg, "Cambios con guardado automático.");
  }

  if (!finalStageEnabled) {
    setSectionReadOnly(knockoutSection, true);
    showAutosaveMessage(submitFinalMsg, "La fase final todavía no está habilitada.");
    syncStageDetailsVisibility();
    return;
  }

  if (finalClosedByTime) {
    showAutosaveMessage(submitFinalMsg, "Los partidos iniciados no se pueden editar.");
  } else {
    showAutosaveMessage(submitFinalMsg, "Cambios con guardado automático.");
  }

  syncStageDetailsVisibility();
  refreshPhaseNotice();
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
  if (isLoading) return;
  isLoading = true;

  try {
    const res = await fetch(`/api/p/${token}?_ts=${Date.now()}`, { cache: "no-store" });
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
    subtitle.textContent = `Hola ${data.participant.name}. Los cambios se guardan automáticamente.`;

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

    const groupClosedByTime = isPast(getEditDeadline(data.tournament.groupMatches || []));
    renderGroups(data.tournament, data.participant.predictions, { collapsed: groupClosedByTime });
    renderKnockout(data.tournament);
    leaderboardEl.innerHTML = leaderboardTable(data.leaderboard);

    applyStageLayout(data.participant);
    refreshNotificationStatus();
    await showNotificationOptinOnOpen();
  } finally {
    isLoading = false;
  }
}

[bonusChampion, bonusRunnerUp, bonusThird, bonusFourth].forEach((el) => {
  el.addEventListener("change", () => {
    scheduleGroupAutosave();
  });
});

enableKickoffNotifBtn.addEventListener("click", async () => {
  await registerPushSubscription();
});

disableKickoffNotifBtn.addEventListener("click", async () => {
  await unregisterPushSubscription();
});

initSectionCollapseControls();
void load();
