import { ROUND_ORDER, countryLabel, roundCount } from "./common.js";

const openCreateBtn = document.querySelector("#openCreateBtn");
const createMsg = document.querySelector("#createMsg");
const list = document.querySelector("#tournamentList");

const createModal = document.querySelector("#createModal");
const createModalName = document.querySelector("#createModalName");
const createModalParticipants = document.querySelector("#createModalParticipants");
const createModalCancel = document.querySelector("#createModalCancel");
const createModalSave = document.querySelector("#createModalSave");

const globalScheduleWrap = document.querySelector("#globalSchedule");
const globalScheduleMsg = document.querySelector("#globalScheduleMsg");

const globalR16Editor = document.querySelector("#globalR16Editor");
const saveGlobalR16Btn = document.querySelector("#saveGlobalR16");
const globalR16Msg = document.querySelector("#globalR16Msg");
const toggleFinalStageEnabledBtn = document.querySelector("#toggleFinalStageEnabled");
const finalStageEnabledStatus = document.querySelector("#finalStageEnabledStatus");
const globalKnockoutEditor = document.querySelector("#globalKnockoutEditor");
const globalBonusView = document.querySelector("#globalBonusView");
const globalKnockoutMsg = document.querySelector("#globalKnockoutMsg");
const customNotifTitleInput = document.querySelector("#customNotifTitle");
const customNotifBodyInput = document.querySelector("#customNotifBody");
const customNotifSelector = document.querySelector("#customNotifSelector");
const sendCustomNotifBtn = document.querySelector("#sendCustomNotif");
const customNotifMsg = document.querySelector("#customNotifMsg");

const adminKeyInput = document.querySelector("#adminKey");
const saveAdminKeyBtn = document.querySelector("#saveAdminKey");
const clearAdminKeyBtn = document.querySelector("#clearAdminKey");
const adminAuthMsg = document.querySelector("#adminAuthMsg");

const tabsWrap = document.querySelector("#mainTabs");
const modal = document.querySelector("#appModal");
const modalTitle = document.querySelector("#modalTitle");
const modalText = document.querySelector("#modalText");
const modalCancel = document.querySelector("#modalCancel");
const modalOk = document.querySelector("#modalOk");

const datetimeModal = document.querySelector("#datetimeModal");
const datetimeModalTitle = document.querySelector("#datetimeModalTitle");
const datetimeModalInput = document.querySelector("#datetimeModalInput");
const datetimeModalClear = document.querySelector("#datetimeModalClear");
const datetimeModalCancel = document.querySelector("#datetimeModalCancel");
const datetimeModalSave = document.querySelector("#datetimeModalSave");

const ADMIN_KEY_STORAGE = "prode_admin_key";
let knockoutState = null;
const flashTimers = new Map();
let tournamentsCache = [];
let customNotifSelectedTournaments = new Set();
let customNotifSelectionInitialized = false;

const ROUND_LABELS = {
  R16: "16vos de final",
  OCT: "8vos de final",
  QF: "Cuartos de final",
  SF: "Semifinales",
  THIRD: "Tercer puesto",
  FINAL: "Final"
};

const KNOCKOUT_MATCH_START = {
  R16: 73,
  OCT: 89,
  QF: 97,
  SF: 101,
  THIRD: 103,
  FINAL: 104
};

function roundLabel(round) {
  return ROUND_LABELS[round] ?? round;
}

function knockoutMatchNumber(round, index) {
  const start = KNOCKOUT_MATCH_START[round];
  if (typeof start !== "number") return null;
  return start + index;
}

function groupMatchNumber(matchId) {
  const parsed = /^G-([A-L])-(\d+)$/.exec(matchId ?? "");
  if (!parsed) return null;
  const groupIndex = parsed[1].charCodeAt(0) - 65;
  const inGroupIndex = Number(parsed[2]);
  if (groupIndex < 0 || Number.isNaN(inGroupIndex) || inGroupIndex < 1) return null;
  return groupIndex * 6 + inGroupIndex;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function toDatetimeLocalValue(isoOrNull) {
  if (!isoOrNull) return "";
  const d = new Date(isoOrNull);
  if (Number.isNaN(d.getTime())) return "";
  const offsetMs = d.getTimezoneOffset() * 60000;
  const local = new Date(d.getTime() - offsetMs);
  return local.toISOString().slice(0, 16);
}

function formatKickoffDisplay(isoOrNull) {
  const v = toDatetimeLocalValue(isoOrNull);
  if (!v) return "Sin fecha";
  const [date, time] = v.split("T");
  const [y, mo, d] = date.split("-");
  return `${d}/${mo}/${y} ${time}`;
}

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

function openDatetimeModal({ title, value }) {
  datetimeModalTitle.textContent = title;
  datetimeModalInput.value = value || "";
  datetimeModal.classList.remove("hidden");
  datetimeModalInput.focus();

  return new Promise((resolve) => {
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    const onClear = () => {
      datetimeModalInput.value = "";
    };
    const onSave = () => {
      const next = datetimeModalInput.value || "";
      cleanup();
      resolve(next);
    };
    const cleanup = () => {
      datetimeModal.classList.add("hidden");
      datetimeModalCancel.removeEventListener("click", onCancel);
      datetimeModalClear.removeEventListener("click", onClear);
      datetimeModalSave.removeEventListener("click", onSave);
    };

    datetimeModalCancel.addEventListener("click", onCancel);
    datetimeModalClear.addEventListener("click", onClear);
    datetimeModalSave.addEventListener("click", onSave);
  });
}

function getMatchLabel(cell) {
  const row = cell.closest(".match-line");
  if (!row) return "Partido";

  const staticTeams = row.querySelector("[data-match-label]")?.textContent?.trim();
  if (staticTeams) return staticTeams;

  const home = row.querySelector("select[data-r16-home]")?.value?.trim() || "Local";
  const away = row.querySelector("select[data-r16-away]")?.value?.trim() || "Visitante";
  return `${countryLabel(home)} vs ${countryLabel(away)}`;
}

function wireDtCells(container, onSave) {
  container.querySelectorAll(".dt-cell").forEach((cell) => {
    const btn = cell.querySelector("[data-edit-kickoff]");
    const input = cell.querySelector(".dt-input");
    const display = cell.querySelector(".dt-text");
    btn.addEventListener("click", async () => {
      const matchLabel = getMatchLabel(cell);
      const next = await openDatetimeModal({
        title: `Editar fecha y hora - ${matchLabel}`,
        value: input.value
      });
      if (next === null) return;
      input.value = next;
      display.textContent = next ? formatKickoffDisplay(next) : "Sin fecha";
      if (onSave) await onSave(input, next);
    });
  });
}

async function saveGroupKickoff(matchId, value) {
  const res = await fetch("/api/admin/group-schedule", {
    method: "PATCH",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ kickoffAt: { [matchId]: value || "" }, results: {} })
  });
  if (!res.ok) {
    flashMessage(globalScheduleMsg, "Error al guardar horario", true);
    return;
  }
  flashMessage(globalScheduleMsg, "Cambios guardados.");
}

async function saveGroupResults(results) {
  const res = await fetch("/api/admin/group-schedule", {
    method: "PATCH",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ kickoffAt: {}, results })
  });
  if (!res.ok) {
    flashMessage(globalScheduleMsg, "Error al guardar resultado", true);
    return false;
  }
  return true;
}

async function saveKnockoutResults(round, results) {
  const res = await fetch("/api/admin/knockout/results", {
    method: "PATCH",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ round, results })
  });
  if (!res.ok) {
    flashMessage(globalKnockoutMsg, "Error al guardar resultado", true);
    return false;
  }
  return true;
}

async function saveKnockoutKickoff(round, matchId, value) {
  const res = await fetch("/api/admin/knockout/kickoff", {
    method: "PATCH",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ round, kickoffAt: { [matchId]: value || "" } })
  });
  if (!res.ok) {
    flashMessage(globalKnockoutMsg, "Error al guardar horario", true);
    return;
  }
  flashMessage(globalKnockoutMsg, `Cambios guardados en ${roundLabel(round)}.`);
}

function byGroup(matches) {
  const map = new Map();
  for (const m of matches) {
    if (!map.has(m.group)) map.set(m.group, []);
    map.get(m.group).push(m);
  }
  return map;
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

function setupTabs() {
  tabsWrap.querySelectorAll(".tab").forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => {
      const target = tabBtn.dataset.tab;
      tabsWrap.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      tabBtn.classList.add("active");
      document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.classList.toggle("hidden", panel.dataset.panel !== target);
      });
    });
  });
}

async function validateAdminKey() {
  const key = getAdminKey();
  if (!key) {
    adminAuthMsg.textContent = "Ingresá y guardá la clave admin para usar el panel.";
    return false;
  }

  const res = await fetch("/api/admin/session", {
    headers: adminHeaders()
  });

  if (!res.ok) {
    adminAuthMsg.textContent = "Clave inválida. Revisala y volvé a guardar.";
    return false;
  }

  adminAuthMsg.textContent = "Clave admin validada.";
  return true;
}

function renderTournaments(tournaments) {
  if (!tournaments.length) {
    list.innerHTML = "<p class=\"muted\">Todavia no hay torneos.</p>";
    return;
  }

  list.innerHTML = tournaments
    .map((t) => `
      <div class="group-box stack" data-tournament-id="${t.id}">
        <div class="row" style="justify-content:space-between; align-items:center;">
          <div>
            <h3 style="margin:0">${t.name}</h3>
            <p class="muted" style="margin:4px 0 0;font-size:0.85rem">${formatDate(t.createdAt)} · ${t.participants} participantes</p>
          </div>
        </div>
        <div class="row">
          <a href="/admin/${t.id}" class="btn-primary">Abrir panel</a>
          <a href="/t/${t.id}" class="btn-primary" target="_blank" rel="noreferrer">Ver link público</a>
          <button class="danger" data-action="delete">Eliminar torneo</button>
        </div>
      </div>
    `)
    .join("");

  list.querySelectorAll("button[data-action='delete']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const card = btn.closest("[data-tournament-id]");
      const tournamentId = card?.dataset.tournamentId;
      if (!tournamentId) return;

      const confirmed = await openModal({
        title: "Eliminar torneo",
        text: "Se eliminará el torneo completo con sus participantes. Esta acción no se puede deshacer.",
        confirmText: "Eliminar"
      });
      if (!confirmed) return;

      const res = await fetch(`/api/tournaments/${tournamentId}`, {
        method: "DELETE",
        headers: adminHeaders()
      });
      if (!res.ok) return;
      await loadTournaments();
    });
  });
}

function renderCustomNotifSelector(tournaments) {
  tournamentsCache = tournaments;
  const ids = tournaments.map((t) => t.id);

  if (!customNotifSelectionInitialized) {
    customNotifSelectedTournaments = new Set();
    customNotifSelectionInitialized = true;
  }
  customNotifSelectedTournaments = new Set(ids.filter((id) => customNotifSelectedTournaments.has(id)));

  if (!tournaments.length) {
    customNotifSelector.innerHTML = '<p class="muted">No hay torneos para notificar.</p>';
    return;
  }

  customNotifSelector.innerHTML = `
    <p class="muted" style="margin:0;">Torneos a notificar</p>
    <div class="row" style="gap:8px;">
      <button id="customNotifSelectAll" class="secondary" type="button">Seleccionar todos</button>
      <button id="customNotifSelectNone" class="secondary" type="button">Quitar todos</button>
    </div>
    <div class="stack notif-tournament-list">
      ${tournaments
        .map((t) => `
          <label class="notif-tournament-row">
            <input type="checkbox" data-custom-notif-tournament="${t.id}" ${customNotifSelectedTournaments.has(t.id) ? "checked" : ""} />
            <span>${t.name} (${t.participants} participantes)</span>
          </label>
        `)
        .join("")}
    </div>
  `;

  const syncSelected = () => {
    customNotifSelectedTournaments = new Set(
      [...customNotifSelector.querySelectorAll("input[data-custom-notif-tournament]:checked")].map((el) =>
        el.dataset.customNotifTournament
      )
    );
  };

  customNotifSelector.querySelectorAll("input[data-custom-notif-tournament]").forEach((input) => {
    input.addEventListener("change", syncSelected);
  });

  customNotifSelector.querySelector("#customNotifSelectAll")?.addEventListener("click", () => {
    customNotifSelector.querySelectorAll("input[data-custom-notif-tournament]").forEach((input) => {
      input.checked = true;
    });
    syncSelected();
  });

  customNotifSelector.querySelector("#customNotifSelectNone")?.addEventListener("click", () => {
    customNotifSelector.querySelectorAll("input[data-custom-notif-tournament]").forEach((input) => {
      input.checked = false;
    });
    syncSelected();
  });
}

function renderGlobalGroupSchedule(matches) {
  const grouped = byGroup(matches || []);
  globalScheduleWrap.innerHTML = [...grouped.entries()]
    .map(([group, rows]) => `
      <details class="group-box">
        <summary><strong>Grupo ${group}</strong></summary>
        <div class="stack" style="margin-top:8px;">
          ${rows
            .map((m) => `
              <div class="match-line" style="grid-template-columns:1fr auto 60px;">
                <span data-match-label>${groupMatchNumber(m.id) ? `Partido ${groupMatchNumber(m.id)} - ` : ""}${countryLabel(m.home)} vs ${countryLabel(m.away)}</span>
                <div class="dt-cell">
                  <span class="dt-text">${formatKickoffDisplay(m.kickoffAt)}</span>
                  <button class="icon-btn" data-edit-kickoff type="button">Editar</button>
                  <input type="hidden" class="dt-input" data-global-kickoff="${m.id}" value="${toDatetimeLocalValue(m.kickoffAt)}" />
                </div>
                <div class="result-cell">
                  <select data-global-group-result="${m.id}">
                    <option value="" ${!m.result ? "selected" : ""}>-</option>
                    <option value="L" ${m.result === "L" ? "selected" : ""}>L</option>
                    <option value="E" ${m.result === "E" ? "selected" : ""}>E</option>
                    <option value="V" ${m.result === "V" ? "selected" : ""}>V</option>
                  </select>
                  <span class="save-flash"></span>
                </div>
              </div>
            `)
            .join("")}
        </div>
      </details>
    `)
    .join("");

  wireDtCells(globalScheduleWrap, (input, v) => saveGroupKickoff(input.dataset.globalKickoff, v));

  globalScheduleWrap.querySelectorAll("select[data-global-group-result]").forEach((select) => {
    select.addEventListener("change", async () => {
      const results = {};
      globalScheduleWrap.querySelectorAll("select[data-global-group-result]").forEach((s) => {
        if (s.value) results[s.dataset.globalGroupResult] = s.value;
      });
      const ok = await saveGroupResults(results);
      if (ok) {
        const flash = select.closest(".result-cell")?.querySelector(".save-flash");
        if (flash) flashMessage(flash, "Resultado guardado");
      }
    });
  });
}

function countrySelect(opts) {
  return `<option value="">Dejar en blanco</option>${opts.map((x) => `<option value="${x}">${countryLabel(x)}</option>`).join("")}`;
}

function r16SelectOptions(currentValue, teams) {
  const options = Array.isArray(teams) ? teams : [];
  let html = "";

  if (currentValue && !options.includes(currentValue)) {
    const escapedCurrent = escapeHtml(currentValue);
    html += `<option value="${escapedCurrent}">${escapeHtml(countryLabel(currentValue))}</option>`;
  }

  html += options
    .map((team) => `<option value="${escapeHtml(team)}">${escapeHtml(countryLabel(team))}</option>`)
    .join("");

  return html;
}

function renderR16Editor(data) {
  globalR16Editor.innerHTML = data.knockoutMatches.R16
    .map((m, i) => `
      <div class="match-line" style="grid-template-columns:auto 1fr 1fr auto;">
        <span class="muted" style="font-weight:700; white-space:nowrap;">Partido ${knockoutMatchNumber("R16", i) ?? m.id}</span>
        <select data-r16-home="${m.id}">${r16SelectOptions(m.home, data.teams || [])}</select>
        <select data-r16-away="${m.id}">${r16SelectOptions(m.away, data.teams || [])}</select>
        <div class="dt-cell">
          <span class="dt-text">${formatKickoffDisplay(m.kickoffAt)}</span>
          <button class="icon-btn" data-edit-kickoff type="button">Editar</button>
          <input type="hidden" class="dt-input" data-r16-kickoff="${m.id}" value="${toDatetimeLocalValue(m.kickoffAt)}" />
        </div>
      </div>
    `)
    .join("");

  data.knockoutMatches.R16.forEach((m) => {
    const homeSelect = globalR16Editor.querySelector(`select[data-r16-home="${m.id}"]`);
    const awaySelect = globalR16Editor.querySelector(`select[data-r16-away="${m.id}"]`);
    if (homeSelect) homeSelect.value = m.home;
    if (awaySelect) awaySelect.value = m.away;
  });

  wireDtCells(globalR16Editor, null);
}

function renderGlobalKnockout(data) {
  knockoutState = data;
  renderR16Editor(data);
  const finalStageEnabled = Boolean(data.finalStageEnabled);
  toggleFinalStageEnabledBtn.textContent = finalStageEnabled
    ? "Deshabilitar carga de 16vos para usuarios"
    : "Habilitar carga de 16vos para usuarios";
  finalStageEnabledStatus.innerHTML = `Estado: <span class="status-chip ${finalStageEnabled ? "is-on" : "is-off"}">${finalStageEnabled ? "Habilitado" : "Deshabilitado"}</span>`;

  globalKnockoutEditor.innerHTML = ROUND_ORDER.map((round) => {
    const count = roundCount(round);
    const lines = Array.from({ length: count }).map((_, i) => {
      const matchId = `${round}-${i + 1}`;
      const matchNumber = knockoutMatchNumber(round, i);
      const teamLine = data.actualTeams?.[round]?.[i] ?? { home: "POR DEFINIR", away: "POR DEFINIR" };
      const result = data.actual?.knockout?.[round]?.[matchId] ?? "";
      const kickoff = data.knockoutMatches?.[round]?.find((m) => m.id === matchId)?.kickoffAt ?? null;
      return `
        <div class="match-line" style="grid-template-columns:1fr auto 60px;">
          <span data-match-label>${matchNumber ? `Partido ${matchNumber} - ` : ""}${countryLabel(teamLine.home)} vs ${countryLabel(teamLine.away)}</span>
          <div class="dt-cell">
            <span class="dt-text">${formatKickoffDisplay(kickoff)}</span>
            <button class="icon-btn" data-edit-kickoff type="button">Editar</button>
            <input type="hidden" class="dt-input" data-round-kickoff="${round}" data-match="${matchId}" value="${toDatetimeLocalValue(kickoff)}" />
          </div>
          <div class="result-cell">
            <select data-round="${round}" data-match="${matchId}">
              <option value="" ${!result ? "selected" : ""}>-</option>
              <option value="L" ${result === "L" ? "selected" : ""}>L</option>
              <option value="V" ${result === "V" ? "selected" : ""}>V</option>
            </select>
            <span class="save-flash"></span>
          </div>
        </div>
      `;
    });

    return `
      <details class="group-box">
        <summary><strong>${roundLabel(round)}</strong></summary>
        <div class="stack" style="margin-top:8px;">
          ${lines.join("")}
        </div>
      </details>
    `;
  }).join("");

  globalBonusView.textContent = `Bonus real automatico: Campeón ${data.bonusFinal?.champion || "-"}, Subcampeón ${data.bonusFinal?.runnerUp || "-"}, Tercero ${data.bonusFinal?.third || "-"}, Cuarto ${data.bonusFinal?.fourth || "-"}.`;

  wireDtCells(globalKnockoutEditor, (input, v) =>
    saveKnockoutKickoff(input.dataset.roundKickoff, input.dataset.match, v)
  );

  globalKnockoutEditor.querySelectorAll("select[data-round]").forEach((select) => {
    select.addEventListener("change", async () => {
      const round = select.dataset.round;
      const results = {};
      globalKnockoutEditor.querySelectorAll(`select[data-round="${round}"]`).forEach((s) => {
        if (s.value) results[s.dataset.match] = s.value;
      });
      const ok = await saveKnockoutResults(round, results);
      if (ok) {
        const flash = select.closest(".result-cell")?.querySelector(".save-flash");
        if (flash) flashMessage(flash, "Resultado guardado");
      }
    });
  });
}

async function loadGlobalSchedule() {
  globalScheduleWrap.innerHTML = "Cargando...";
  const res = await fetch("/api/admin/group-schedule", { headers: adminHeaders() });
  if (!res.ok) {
    globalScheduleWrap.innerHTML = "<p class=\"muted\">No se pudo cargar fase de grupos global.</p>";
    return;
  }
  const data = await res.json();
  renderGlobalGroupSchedule(data.matches || []);
}

async function loadGlobalKnockout() {
  globalR16Editor.innerHTML = "Cargando...";
  globalKnockoutEditor.innerHTML = "Cargando...";
  const res = await fetch("/api/admin/knockout", { headers: adminHeaders() });
  if (!res.ok) {
    globalR16Editor.innerHTML = "<p class=\"muted\">No se pudo cargar fase final global.</p>";
    globalKnockoutEditor.innerHTML = "";
    return;
  }
  const data = await res.json();
  renderGlobalKnockout(data);
}

async function loadTournaments() {
  const ok = await validateAdminKey();
  if (!ok) {
    list.innerHTML = "<p class=\"muted\">Panel bloqueado hasta validar clave admin.</p>";
    globalScheduleWrap.innerHTML = "<p class=\"muted\">Panel bloqueado hasta validar clave admin.</p>";
    globalR16Editor.innerHTML = "<p class=\"muted\">Panel bloqueado hasta validar clave admin.</p>";
    globalKnockoutEditor.innerHTML = "";
    customNotifSelector.innerHTML = "<p class=\"muted\">Panel bloqueado hasta validar clave admin.</p>";
    customNotifSelectedTournaments = new Set();
    tournamentsCache = [];
    return;
  }

  await loadGlobalSchedule();
  await loadGlobalKnockout();

  list.innerHTML = "Cargando...";
  const res = await fetch("/api/tournaments", { headers: adminHeaders() });
  const data = await res.json();
  const tournaments = data.tournaments || [];
  renderTournaments(tournaments);
  renderCustomNotifSelector(tournaments);
}

saveAdminKeyBtn.addEventListener("click", async () => {
  const key = adminKeyInput.value.trim();
  localStorage.setItem(ADMIN_KEY_STORAGE, key);
  await loadTournaments();
});

clearAdminKeyBtn.addEventListener("click", async () => {
  localStorage.removeItem(ADMIN_KEY_STORAGE);
  adminKeyInput.value = "";
  await loadTournaments();
});

saveGlobalR16Btn.addEventListener("click", async () => {
  globalR16Msg.textContent = "";
  const matches = [...globalR16Editor.querySelectorAll(".match-line")].map((row) => {
    const homeInput = row.querySelector("select[data-r16-home]");
    const awayInput = row.querySelector("select[data-r16-away]");
    const kickoffInput = row.querySelector("input[data-r16-kickoff]");
    return {
      id: homeInput.dataset.r16Home,
      home: homeInput.value,
      away: awayInput.value,
      kickoffAt: kickoffInput.value || ""
    };
  });

  const res = await fetch("/api/admin/knockout/r16", {
    method: "PATCH",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ matches })
  });

  const data = await res.json();
  if (!res.ok) {
    flashMessage(globalR16Msg, data.error ?? "No se pudo guardar 16vos globales", true);
    return;
  }

  flashMessage(globalR16Msg, "16vos globales guardados.");
  await loadGlobalKnockout();
});

toggleFinalStageEnabledBtn.addEventListener("click", async () => {
  const current = Boolean(knockoutState?.finalStageEnabled);
  const next = !current;

  const confirmed = await openModal({
    title: next ? "Habilitar 16vos para usuarios" : "Deshabilitar 16vos para usuarios",
    text: next
      ? "Los usuarios podrán completar y enviar la fase final."
      : "Los usuarios no podrán enviar la fase final hasta volver a habilitarla.",
    confirmText: next ? "Habilitar" : "Deshabilitar"
  });
  if (!confirmed) return;

  const res = await fetch("/api/admin/knockout/final-stage-enabled", {
    method: "PATCH",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ enabled: next })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    flashMessage(globalR16Msg, data.error ?? "No se pudo actualizar el estado de 16vos", true);
    return;
  }

  if (next) {
    const notified = Number(data.notifiedCount ?? 0);
    flashMessage(globalR16Msg, `16vos habilitados para usuarios. Avisos enviados: ${notified}.`);
  } else {
    flashMessage(globalR16Msg, "16vos deshabilitados para usuarios.");
  }
  await loadGlobalKnockout();
});

sendCustomNotifBtn.addEventListener("click", async () => {
  customNotifMsg.textContent = "";

  const title = customNotifTitleInput.value.trim();
  const body = customNotifBodyInput.value.trim();
  const tournamentIds = [...customNotifSelectedTournaments];

  if (!title || !body) {
    flashMessage(customNotifMsg, "Completá título y mensaje para enviar la notificación.", true);
    return;
  }

  const res = await fetch("/api/admin/notifications/custom", {
    method: "POST",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      title,
      body,
      tournamentIds
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    flashMessage(customNotifMsg, data.error ?? "No se pudo enviar la notificación.", true);
    return;
  }

  flashMessage(
    customNotifMsg,
    `Enviado. Torneos: ${data.selectedTournamentCount ?? tournamentIds.length}. Participantes notificados: ${data.deliveredParticipants ?? 0}. Notificaciones enviadas: ${data.sentNotifications ?? 0}.`
  );
});

adminKeyInput.value = getAdminKey();
setupTabs();
loadTournaments();

openCreateBtn.addEventListener("click", () => {
  createModalName.value = "";
  createModalParticipants.value = "";
  createModal.classList.remove("hidden");
  createModalName.focus();
});

createModalCancel.addEventListener("click", () => {
  createModal.classList.add("hidden");
});

createModalSave.addEventListener("click", async () => {
  createMsg.textContent = "";
  const name = createModalName.value.trim();
  const participants = createModalParticipants.value
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);

  const res = await fetch("/api/tournaments", {
    method: "POST",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ name, participants })
  });

  const data = await res.json();
  if (!res.ok) {
    createMsg.textContent = data.error ?? "No se pudo crear el torneo";
    return;
  }

  createModal.classList.add("hidden");
  createMsg.textContent = `Torneo "${name}" creado.`;
  await loadTournaments();
});
