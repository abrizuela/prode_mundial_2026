import path from "node:path";
import express from "express";
import { nanoid } from "nanoid";
import webpush from "web-push";
import { buildInitialGroupMatches, buildInitialKnockoutMatches, listCompetingTeams } from "./fixtures.ts";
import { buildLeaderboard, computeRoundTeams, deriveBonusFinal } from "./scoring.ts";
import { findTournamentByParticipantToken, readStore, writeStore } from "./store.ts";
import { ROUND_ORDER } from "./types.ts";
import type { BonusPrediction, GroupResult, KnockoutResult, RoundKey, Store, Tournament } from "./types.ts";

const app = express();
const PORT = Number(process.env.PORT ?? 3000);
const ADMIN_KEY = process.env.ADMIN_KEY ?? "ert.2026";
const PUSH_CHECK_INTERVAL_MS = 30_000;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(process.cwd(), "public")));

function readAdminKey(req: express.Request) {
  const header = req.header("x-admin-key");
  return typeof header === "string" ? header.trim() : "";
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (readAdminKey(req) !== ADMIN_KEY) {
    res.status(401).json({ error: "No autorizado: clave admin inválida" });
    return;
  }
  next();
}

function emptyBonus(): BonusPrediction {
  return {
    champion: "",
    runnerUp: "",
    third: "",
    fourth: ""
  };
}

function emptyKnockoutPredictions() {
  return {
    R16: {} as Record<string, KnockoutResult>,
    OCT: {} as Record<string, KnockoutResult>,
    QF: {} as Record<string, KnockoutResult>,
    SF: {} as Record<string, KnockoutResult>,
    THIRD: {} as Record<string, KnockoutResult>,
    FINAL: {} as Record<string, KnockoutResult>
  };
}

function normalizeParticipantNames(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
}

function participantLinks(token: string) {
  return {
    playerUrl: `/p/${token}`,
    groupUrl: `/p/${token}/group`,
    finalUrl: `/p/${token}/final`
  };
}

function getTournamentOr404(res: express.Response, tournamentId: string): Tournament | null {
  const store = readStore();
  const tournament = store.tournaments.find((t) => t.id === tournamentId);
  if (!tournament) {
    res.status(404).json({ error: "Torneo no encontrado" });
    return null;
  }
  return tournament;
}

function withGlobalTournamentData(store: Store, tournament: Tournament): Tournament {
  const groupMatches = tournament.groupMatches.map((m) => ({
    ...m,
    kickoffAt: store.globalGroupKickoffAt[m.id] ?? m.kickoffAt ?? null
  }));

  const projected: Tournament = {
    ...tournament,
    groupMatches,
    knockoutMatches: {
      R16: store.globalKnockoutMatches.R16.map((m) => ({ ...m })),
      OCT: store.globalKnockoutMatches.OCT.map((m) => ({ ...m })),
      QF: store.globalKnockoutMatches.QF.map((m) => ({ ...m })),
      SF: store.globalKnockoutMatches.SF.map((m) => ({ ...m })),
      THIRD: store.globalKnockoutMatches.THIRD.map((m) => ({ ...m })),
      FINAL: store.globalKnockoutMatches.FINAL.map((m) => ({ ...m }))
    },
    actual: {
      group: { ...store.globalActual.group },
      knockout: {
        R16: { ...store.globalActual.knockout.R16 },
        OCT: { ...store.globalActual.knockout.OCT },
        QF: { ...store.globalActual.knockout.QF },
        SF: { ...store.globalActual.knockout.SF },
        THIRD: { ...store.globalActual.knockout.THIRD },
        FINAL: { ...store.globalActual.knockout.FINAL }
      },
      bonusFinal: emptyBonus()
    }
  };

  projected.actual.bonusFinal = deriveBonusFinal(projected);
  return projected;
}

function ensureVapidKeys(store: Store): Store {
  if (store.pushState.vapidPublicKey && store.pushState.vapidPrivateKey) {
    return store;
  }

  const keys = webpush.generateVAPIDKeys();
  const updated: Store = {
    ...store,
    pushState: {
      ...store.pushState,
      vapidPublicKey: keys.publicKey,
      vapidPrivateKey: keys.privateKey
    }
  };
  writeStore(updated);
  return updated;
}

function configureWebPush(store: Store) {
  const configured = ensureVapidKeys(store);
  webpush.setVapidDetails(
    "mailto:admin@prode.local",
    configured.pushState.vapidPublicKey,
    configured.pushState.vapidPrivateKey
  );
  return configured;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function parseSubscription(input: unknown) {
  if (!isObject(input)) return null;
  if (typeof input.endpoint !== "string") return null;
  if (!isObject(input.keys)) return null;
  const p256dh = typeof input.keys.p256dh === "string" ? input.keys.p256dh : "";
  const auth = typeof input.keys.auth === "string" ? input.keys.auth : "";
  if (!p256dh || !auth) return null;
  return {
    endpoint: input.endpoint,
    keys: { p256dh, auth }
  };
}

function isR16Defined(matches: Array<{ home: string; away: string }>) {
  if (!matches.length) return false;
  const isPlaceholder = (team: string) => team.toUpperCase().startsWith("POR DEFINIR");

  return matches.every((match) => {
    const home = (match.home ?? "").trim();
    const away = (match.away ?? "").trim();
    return home.length > 0 && away.length > 0 && !isPlaceholder(home) && !isPlaceholder(away);
  });
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "html", "admin.html"));
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "html", "admin.html"));
});

app.get("/admin/:id", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "html", "admin-tournament.html"));
});

app.get("/t/:id", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "html", "public-tournament.html"));
});

app.get("/p/:token/:stage(group|final)", (_req, res) => {
  res.redirect(302, `/p/${_req.params.token}`);
});

app.get("/p/:token", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "html", "player.html"));
});

app.get("/sw.js", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "js", "sw.js"));
});

app.get("/api/admin/session", requireAdmin, (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/admin/group-schedule", requireAdmin, (_req, res) => {
  const store = readStore();
  const template = buildInitialGroupMatches().map((match) => ({
    ...match,
    kickoffAt: store.globalGroupKickoffAt[match.id] ?? match.kickoffAt ?? null,
    result: store.globalActual.group[match.id] ?? ""
  }));
  res.json({ matches: template });
});

app.patch("/api/admin/group-schedule", requireAdmin, (req, res) => {
  const store = readStore();
  const kickoffInput = isObject(req.body?.kickoffAt) ? req.body.kickoffAt : {};
  const resultInput = isObject(req.body?.results) ? req.body.results : {};

  const nextKickoff = { ...store.globalGroupKickoffAt };
  for (const [matchId, value] of Object.entries(kickoffInput)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) {
      nextKickoff[matchId] = null;
      continue;
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      nextKickoff[matchId] = parsed.toISOString();
    }
  }

  const nextResults: Record<string, GroupResult> = {};
  for (const [matchId, value] of Object.entries(resultInput)) {
    if (value === "L" || value === "E" || value === "V") {
      nextResults[matchId] = value;
    }
  }

  store.globalGroupKickoffAt = nextKickoff;
  store.globalActual.group = nextResults;
  store.tournaments = store.tournaments.map((t) => ({
    ...t,
    actual: {
      ...t.actual,
      group: { ...nextResults }
    }
  }));
  writeStore(store);
  res.json({ ok: true });
});

app.get("/api/admin/knockout", requireAdmin, (_req, res) => {
  const store = readStore();
  const proxyTournament: Tournament = {
    id: "global",
    name: "global",
    createdAt: new Date(0).toISOString(),
    participants: [],
    groupMatches: buildInitialGroupMatches(),
    knockoutMatches: {
      R16: store.globalKnockoutMatches.R16,
      OCT: store.globalKnockoutMatches.OCT,
      QF: store.globalKnockoutMatches.QF,
      SF: store.globalKnockoutMatches.SF,
      THIRD: store.globalKnockoutMatches.THIRD,
      FINAL: store.globalKnockoutMatches.FINAL
    },
    actual: {
      group: store.globalActual.group,
      knockout: {
        R16: store.globalActual.knockout.R16,
        OCT: store.globalActual.knockout.OCT,
        QF: store.globalActual.knockout.QF,
        SF: store.globalActual.knockout.SF,
        THIRD: store.globalActual.knockout.THIRD,
        FINAL: store.globalActual.knockout.FINAL
      },
      bonusFinal: emptyBonus()
    }
  };

  const actualTeams = computeRoundTeams(proxyTournament.knockoutMatches.R16, proxyTournament.actual.knockout);
  const bonusFinal = deriveBonusFinal(proxyTournament);
  res.json({
    knockoutMatches: store.globalKnockoutMatches,
    actual: store.globalActual,
    actualTeams,
    bonusFinal,
    teams: listCompetingTeams()
  });
});

app.patch("/api/admin/knockout/r16", requireAdmin, (req, res) => {
  const store = readStore();
  const rows = Array.isArray(req.body?.matches) ? req.body.matches : [];
  const byId = new Map<string, { home: string; away: string; kickoffAt: string | null }>();

  rows.forEach((row: unknown) => {
    const typedRow = row as { id?: string; home?: string; away?: string; kickoffAt?: string };
    const id = typeof typedRow.id === "string" ? typedRow.id : "";
    const home = typeof typedRow.home === "string" ? typedRow.home.trim() : "";
    const away = typeof typedRow.away === "string" ? typedRow.away.trim() : "";
    const kickoffAtRaw = typeof typedRow.kickoffAt === "string" ? typedRow.kickoffAt.trim() : "";
    const parsedKickoff = kickoffAtRaw ? new Date(kickoffAtRaw) : null;
    const kickoffAt = parsedKickoff && !Number.isNaN(parsedKickoff.getTime()) ? parsedKickoff.toISOString() : null;
    if (id && home && away) {
      byId.set(id, { home, away, kickoffAt });
    }
  });

  store.globalKnockoutMatches.R16 = store.globalKnockoutMatches.R16.map((m) => {
    const custom = byId.get(m.id);
    if (!custom) return m;
    return { ...m, home: custom.home, away: custom.away, kickoffAt: custom.kickoffAt };
  });

  store.tournaments = store.tournaments.map((t) => ({
    ...t,
    knockoutMatches: {
      ...t.knockoutMatches,
      R16: store.globalKnockoutMatches.R16.map((m) => ({ ...m }))
    }
  }));

  writeStore(store);
  res.json({ ok: true });
});

app.patch("/api/admin/knockout/kickoff", requireAdmin, (req, res) => {
  const store = readStore();
  const round = req.body?.round as RoundKey;
  const validRound = ROUND_ORDER.includes(round);
  if (!validRound) {
    res.status(400).json({ error: "Ronda inválida" });
    return;
  }

  const input = isObject(req.body?.kickoffAt) ? req.body.kickoffAt : {};
  const byId = new Map<string, string | null>();
  for (const [matchId, raw] of Object.entries(input)) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) {
      byId.set(matchId, null);
      continue;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      byId.set(matchId, parsed.toISOString());
    }
  }

  store.globalKnockoutMatches[round] = store.globalKnockoutMatches[round].map((m) => ({
    ...m,
    kickoffAt: byId.has(m.id) ? byId.get(m.id) ?? null : m.kickoffAt
  }));

  store.tournaments = store.tournaments.map((t) => ({
    ...t,
    knockoutMatches: {
      ...t.knockoutMatches,
      [round]: store.globalKnockoutMatches[round].map((m) => ({ ...m }))
    }
  }));

  writeStore(store);
  res.json({ ok: true });
});

app.patch("/api/admin/knockout/results", requireAdmin, (req, res) => {
  const store = readStore();
  const round = req.body?.round as RoundKey;
  const validRound = ROUND_ORDER.includes(round);
  if (!validRound) {
    res.status(400).json({ error: "Ronda inválida" });
    return;
  }

  const resultsInput = req.body?.results ?? {};
  const next: Record<string, KnockoutResult> = {};
  for (const [matchId, value] of Object.entries(resultsInput)) {
    if (value === "L" || value === "V") {
      next[matchId] = value;
    }
  }

  store.globalActual.knockout[round] = next;
  store.tournaments = store.tournaments.map((t) => ({
    ...t,
    actual: {
      ...t.actual,
      knockout: {
        ...t.actual.knockout,
        [round]: { ...next }
      }
    }
  }));

  writeStore(store);
  res.json({ ok: true });
});

app.get("/api/push/public-key", (_req, res) => {
  const store = configureWebPush(readStore());
  res.json({ publicKey: store.pushState.vapidPublicKey });
});

app.get("/api/tournaments", requireAdmin, (_req, res) => {
  const store = readStore();
  const tournaments = store.tournaments.map((t) => ({
    id: t.id,
    name: t.name,
    createdAt: t.createdAt,
    participants: t.participants.length
  }));
  res.json({ tournaments });
});

app.post("/api/tournaments", requireAdmin, (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const participants = normalizeParticipantNames(req.body?.participants);

  if (!name) {
    res.status(400).json({ error: "El nombre del torneo es obligatorio" });
    return;
  }

  const store = readStore();
  const tournamentId = nanoid(10);
  const tournament: Tournament = {
    id: tournamentId,
    name,
    createdAt: new Date().toISOString(),
    participants: participants.map((participantName) => ({
      id: nanoid(8),
      name: participantName,
      token: nanoid(24),
      predictions: {
        group: {},
        knockout: emptyKnockoutPredictions(),
        bonus: emptyBonus(),
        groupLockedAt: null,
        finalLockedAt: null
      }
    })),
    groupMatches: buildInitialGroupMatches(),
    knockoutMatches: buildInitialKnockoutMatches(),
    actual: {
      group: {},
      knockout: emptyKnockoutPredictions(),
      bonusFinal: emptyBonus()
    }
  };

  store.tournaments.unshift(tournament);
  writeStore(store);

  res.status(201).json({
    tournamentId,
    adminUrl: `/admin/${tournamentId}`,
    participantLinks: tournament.participants.map((p) => ({
      name: p.name,
      ...participantLinks(p.token)
    }))
  });
});

app.patch("/api/tournaments/:id", requireAdmin, (req, res) => {
  const store = readStore();
  const tournament = store.tournaments.find((t) => t.id === req.params.id);
  if (!tournament) {
    res.status(404).json({ error: "Torneo no encontrado" });
    return;
  }

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "Nombre inválido" });
    return;
  }

  tournament.name = name;
  writeStore(store);
  res.json({ ok: true });
});

app.delete("/api/tournaments/:id", requireAdmin, (req, res) => {
  const store = readStore();
  const index = store.tournaments.findIndex((t) => t.id === req.params.id);
  if (index === -1) {
    res.status(404).json({ error: "Torneo no encontrado" });
    return;
  }

  const removed = store.tournaments[index];
  store.tournaments.splice(index, 1);

  for (const participant of removed.participants) {
    delete store.pushState.subscriptionsByToken[participant.token];
    delete store.pushState.sentByToken[participant.token];
  }

  writeStore(store);
  res.json({ ok: true });
});

app.post("/api/tournaments/:id/participants", requireAdmin, (req, res) => {
  const store = readStore();
  const tournament = store.tournaments.find((t) => t.id === req.params.id);
  if (!tournament) {
    res.status(404).json({ error: "Torneo no encontrado" });
    return;
  }

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "Nombre de participante inválido" });
    return;
  }

  const participant = {
    id: nanoid(8),
    name,
    token: nanoid(24),
    predictions: {
      group: {},
      knockout: emptyKnockoutPredictions(),
      bonus: emptyBonus(),
      groupLockedAt: null,
      finalLockedAt: null
    }
  };

  tournament.participants.push(participant);
  writeStore(store);
  res.status(201).json({
    participant: {
      id: participant.id,
      name: participant.name,
      token: participant.token,
      ...participantLinks(participant.token)
    }
  });
});

app.patch("/api/tournaments/:id/participants/:participantId", requireAdmin, (req, res) => {
  const store = readStore();
  const tournament = store.tournaments.find((t) => t.id === req.params.id);
  if (!tournament) {
    res.status(404).json({ error: "Torneo no encontrado" });
    return;
  }

  const participant = tournament.participants.find((p) => p.id === req.params.participantId);
  if (!participant) {
    res.status(404).json({ error: "Participante no encontrado" });
    return;
  }

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "Nombre de participante inválido" });
    return;
  }

  participant.name = name;
  writeStore(store);
  res.json({ ok: true });
});

app.delete("/api/tournaments/:id/participants/:participantId", requireAdmin, (req, res) => {
  const store = readStore();
  const tournament = store.tournaments.find((t) => t.id === req.params.id);
  if (!tournament) {
    res.status(404).json({ error: "Torneo no encontrado" });
    return;
  }

  const idx = tournament.participants.findIndex((p) => p.id === req.params.participantId);
  if (idx === -1) {
    res.status(404).json({ error: "Participante no encontrado" });
    return;
  }

  const removed = tournament.participants[idx];
  tournament.participants.splice(idx, 1);
  delete store.pushState.subscriptionsByToken[removed.token];
  delete store.pushState.sentByToken[removed.token];

  writeStore(store);
  res.json({ ok: true });
});

app.post("/api/tournaments/:id/participants/:participantId/unlock", requireAdmin, (req, res) => {
  const store = readStore();
  const tournament = store.tournaments.find((t) => t.id === req.params.id);
  if (!tournament) {
    res.status(404).json({ error: "Torneo no encontrado" });
    return;
  }

  const participant = tournament.participants.find((p) => p.id === req.params.participantId);
  if (!participant) {
    res.status(404).json({ error: "Participante no encontrado" });
    return;
  }

  const stage = typeof req.body?.stage === "string" ? req.body.stage : "group";
  if (stage !== "group" && stage !== "final") {
    res.status(400).json({ error: "Etapa inválida" });
    return;
  }

  if (stage === "final") {
    participant.predictions.finalLockedAt = null;
  } else {
    participant.predictions.groupLockedAt = null;
    participant.predictions.finalLockedAt = null;
  }

  writeStore(store);
  res.json({ ok: true });
});

app.get("/api/tournaments/:id", requireAdmin, (req, res) => {
  const found = getTournamentOr404(res, req.params.id);
  if (!found) return;
  const store = readStore();
  const tournament = withGlobalTournamentData(store, found);

  const leaderboard = buildLeaderboard(tournament);
  const actualTeams = computeRoundTeams(tournament.knockoutMatches.R16, tournament.actual.knockout);

  res.json({
    tournament: {
      id: tournament.id,
      name: tournament.name,
      createdAt: tournament.createdAt,
      participants: tournament.participants.map((p) => ({
        id: p.id,
        name: p.name,
        token: p.token,
        groupLockedAt: p.predictions.groupLockedAt,
        finalLockedAt: p.predictions.finalLockedAt,
        ...participantLinks(p.token)
      })),
      groupMatches: tournament.groupMatches,
      knockoutMatches: tournament.knockoutMatches,
      actual: tournament.actual,
      actualTeams
    },
    leaderboard
  });
});

app.patch("/api/tournaments/:id/r16-teams", requireAdmin, (req, res) => {
  const store = readStore();
  const rows = Array.isArray(req.body?.matches) ? req.body.matches : [];
  const byId = new Map<string, { home: string; away: string }>();

  rows.forEach((row: unknown) => {
    const typedRow = row as { id?: string; home?: string; away?: string };
    const id = typeof typedRow.id === "string" ? typedRow.id : "";
    const home = typeof typedRow.home === "string" ? typedRow.home.trim() : "";
    const away = typeof typedRow.away === "string" ? typedRow.away.trim() : "";
    if (id && home && away) {
      byId.set(id, { home, away });
    }
  });

  store.globalKnockoutMatches.R16 = store.globalKnockoutMatches.R16.map((m) => {
    const custom = byId.get(m.id);
    if (!custom) return m;
    return { ...m, home: custom.home, away: custom.away };
  });

  store.tournaments = store.tournaments.map((t) => ({
    ...t,
    knockoutMatches: {
      ...t.knockoutMatches,
      R16: store.globalKnockoutMatches.R16.map((m) => ({ ...m }))
    }
  }));

  writeStore(store);
  res.json({ ok: true });
});

app.patch("/api/tournaments/:id/actual/group", requireAdmin, (req, res) => {
  const store = readStore();
  const input = req.body?.results ?? {};
  const next: Record<string, GroupResult> = {};

  for (const [matchId, value] of Object.entries(input)) {
    if (value === "L" || value === "E" || value === "V") {
      next[matchId] = value;
    }
  }

  store.globalActual.group = next;
  store.tournaments = store.tournaments.map((t) => ({
    ...t,
    actual: {
      ...t.actual,
      group: { ...next }
    }
  }));

  writeStore(store);
  res.json({ ok: true });
});

app.patch("/api/tournaments/:id/actual/knockout", requireAdmin, (req, res) => {
  const store = readStore();
  const round = req.body?.round as RoundKey;
  const validRound = ROUND_ORDER.includes(round);
  if (!validRound) {
    res.status(400).json({ error: "Ronda inválida" });
    return;
  }

  const resultsInput = req.body?.results ?? {};
  const next: Record<string, KnockoutResult> = {};
  for (const [matchId, value] of Object.entries(resultsInput)) {
    if (value === "L" || value === "V") {
      next[matchId] = value;
    }
  }

  store.globalActual.knockout[round] = next;
  store.tournaments = store.tournaments.map((t) => ({
    ...t,
    actual: {
      ...t.actual,
      knockout: {
        ...t.actual.knockout,
        [round]: { ...next }
      }
    }
  }));

  writeStore(store);
  res.json({ ok: true });
});

app.patch("/api/tournaments/:id/actual/bonus", requireAdmin, (req, res) => {
  res.status(400).json({ error: "El bonus final real se calcula automáticamente con los resultados de fase final" });
});

app.get("/api/tournaments/:id/leaderboard", (req, res) => {
  const found = getTournamentOr404(res, req.params.id);
  if (!found) return;
  const store = readStore();
  const tournament = withGlobalTournamentData(store, found);
  res.json({ leaderboard: buildLeaderboard(tournament) });
});

app.get("/api/public/tournaments/:id", (req, res) => {
  const found = getTournamentOr404(res, req.params.id);
  if (!found) return;

  const store = readStore();
  const tournament = withGlobalTournamentData(store, found);
  res.json({
    tournament: {
      id: tournament.id,
      name: tournament.name,
      createdAt: tournament.createdAt,
      participantCount: tournament.participants.length
    },
    leaderboard: buildLeaderboard(tournament)
  });
});

app.get("/api/p/:token", (req, res) => {
  const found = findTournamentByParticipantToken(req.params.token);
  if (!found) {
    res.status(404).json({ error: "Link inválido" });
    return;
  }

  const store = readStore();
  const tournament = withGlobalTournamentData(store, found.tournament);
  const participantIndex = found.participantIndex;
  const participant = tournament.participants[participantIndex];
  const myRoundTeams = computeRoundTeams(tournament.knockoutMatches.R16, participant.predictions.knockout);

  res.json({
    tournament: {
      id: tournament.id,
      name: tournament.name,
      groupMatches: tournament.groupMatches,
      knockoutMatches: tournament.knockoutMatches,
      actual: tournament.actual,
      participantCount: tournament.participants.length
    },
    participant: {
      id: participant.id,
      name: participant.name,
      predictions: participant.predictions,
      roundTeams: myRoundTeams,
      ...participantLinks(participant.token)
    },
    leaderboard: buildLeaderboard(tournament)
  });
});

app.post("/api/p/:token/push-subscription", (req, res) => {
  const store = readStore();
  const exists = findTournamentByParticipantToken(req.params.token);
  if (!exists) {
    res.status(404).json({ error: "Link inválido" });
    return;
  }

  const subscription = parseSubscription(req.body?.subscription);
  if (!subscription) {
    res.status(400).json({ error: "Subscription inválida" });
    return;
  }

  const current = store.pushState.subscriptionsByToken[req.params.token] ?? [];
  const deduped = current.filter((s) => s.endpoint !== subscription.endpoint);
  deduped.push(subscription);
  store.pushState.subscriptionsByToken[req.params.token] = deduped;

  writeStore(store);
  res.json({ ok: true });
});

app.delete("/api/p/:token/push-subscription", (req, res) => {
  const store = readStore();
  const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : "";
  if (!endpoint) {
    res.status(400).json({ error: "Endpoint requerido" });
    return;
  }

  const current = store.pushState.subscriptionsByToken[req.params.token] ?? [];
  store.pushState.subscriptionsByToken[req.params.token] = current.filter((s) => s.endpoint !== endpoint);
  writeStore(store);
  res.json({ ok: true });
});

app.post("/api/p/:token/submit-group", (req, res) => {
  const store = readStore();

  let tournament: Tournament | undefined;
  let participantIndex = -1;

  for (const t of store.tournaments) {
    const idx = t.participants.findIndex((p) => p.token === req.params.token);
    if (idx >= 0) {
      tournament = t;
      participantIndex = idx;
      break;
    }
  }

  if (!tournament || participantIndex < 0) {
    res.status(404).json({ error: "Link inválido" });
    return;
  }

  const participant = tournament.participants[participantIndex];

  if (participant.predictions.groupLockedAt) {
    res.status(409).json({ error: "La fase de grupos ya fue enviada y está bloqueada" });
    return;
  }

  const groupInput = req.body?.group ?? {};
  const bonusInput = req.body?.bonus ?? {};

  const group: Record<string, GroupResult> = {};
  for (const [matchId, value] of Object.entries(groupInput)) {
    if (value === "L" || value === "E" || value === "V") {
      group[matchId] = value;
    }
  }

  participant.predictions.group = group;
  participant.predictions.bonus = {
    champion: typeof bonusInput.champion === "string" ? bonusInput.champion.trim() : "",
    runnerUp: typeof bonusInput.runnerUp === "string" ? bonusInput.runnerUp.trim() : "",
    third: typeof bonusInput.third === "string" ? bonusInput.third.trim() : "",
    fourth: typeof bonusInput.fourth === "string" ? bonusInput.fourth.trim() : ""
  };
  participant.predictions.groupLockedAt = new Date().toISOString();

  writeStore(store);
  res.json({ ok: true, lockedAt: participant.predictions.groupLockedAt });
});

app.post("/api/p/:token/submit-final", (req, res) => {
  const store = readStore();

  let tournament: Tournament | undefined;
  let participantIndex = -1;

  for (const t of store.tournaments) {
    const idx = t.participants.findIndex((p) => p.token === req.params.token);
    if (idx >= 0) {
      tournament = t;
      participantIndex = idx;
      break;
    }
  }

  if (!tournament || participantIndex < 0) {
    res.status(404).json({ error: "Link inválido" });
    return;
  }

  const participant = tournament.participants[participantIndex];

  if (!participant.predictions.groupLockedAt) {
    res.status(409).json({ error: "Primero debés completar la fase de grupos" });
    return;
  }

  if (!isR16Defined(store.globalKnockoutMatches.R16)) {
    res.status(409).json({ error: "La fase final todavía no está habilitada: primero el admin debe definir los cruces de 16vos" });
    return;
  }

  if (participant.predictions.finalLockedAt) {
    res.status(409).json({ error: "La fase final ya fue enviada y está bloqueada" });
    return;
  }

  const knockoutInput = req.body?.knockout ?? {};
  const knockout = emptyKnockoutPredictions();
  for (const round of ROUND_ORDER) {
    const roundInput = knockoutInput[round] ?? {};
    for (const [matchId, value] of Object.entries(roundInput)) {
      if (value === "L" || value === "V") {
        knockout[round][matchId] = value;
      }
    }
  }

  participant.predictions.knockout = knockout;
  participant.predictions.finalLockedAt = new Date().toISOString();

  writeStore(store);
  res.json({ ok: true, lockedAt: participant.predictions.finalLockedAt });
});

app.post("/api/p/:token/submit", (req, res) => {
  res.status(400).json({
    error: "Endpoint reemplazado. Usá /api/p/:token/submit-group o /api/p/:token/submit-final"
  });
});

let pushTickRunning = false;

async function pushDueKickoffNotifications() {
  if (pushTickRunning) return;
  pushTickRunning = true;

  try {
    let store = configureWebPush(readStore());
    const now = Date.now();
    let changed = false;

    for (const tournament of store.tournaments) {
      const withKickoff = withGlobalTournamentData(store, tournament);

      for (const participant of withKickoff.participants) {
        const token = participant.token;
        const subscriptions = store.pushState.subscriptionsByToken[token] ?? [];
        if (!subscriptions.length) continue;

        const sent = new Set(store.pushState.sentByToken[token] ?? []);
        let sentChanged = false;

        for (const match of withKickoff.groupMatches) {
          if (!match.kickoffAt) continue;
          const key = `${tournament.id}:${match.id}`;
          if (sent.has(key)) continue;

          const kickoffMs = new Date(match.kickoffAt).getTime();
          if (Number.isNaN(kickoffMs)) continue;

          const diff = kickoffMs - now;
          if (diff > 5 * 60 * 1000 || diff <= 0) continue;

          const payload = JSON.stringify({
            title: "PRODE Mundial 2026",
            body: `${match.home} vs ${match.away} arranca en menos de 5 minutos (${tournament.name})`,
            url: `/p/${token}/group`
          });

          const aliveSubs: typeof subscriptions = [];
          for (const sub of subscriptions) {
            try {
              await webpush.sendNotification(sub, payload);
              aliveSubs.push(sub);
            } catch (error: unknown) {
              const statusCode = isObject(error) && typeof error.statusCode === "number" ? error.statusCode : 0;
              if (statusCode !== 404 && statusCode !== 410) {
                aliveSubs.push(sub);
              }
            }
          }

          store.pushState.subscriptionsByToken[token] = aliveSubs;
          sent.add(key);
          sentChanged = true;
          changed = true;
        }

        if (sentChanged) {
          store.pushState.sentByToken[token] = [...sent];
        }
      }
    }

    if (changed) {
      writeStore(store);
    }
  } finally {
    pushTickRunning = false;
  }
}

app.listen(PORT, () => {
  console.log(`PRODE app running on http://localhost:${PORT}`);
});

void pushDueKickoffNotifications();
setInterval(() => {
  void pushDueKickoffNotifications();
}, PUSH_CHECK_INTERVAL_MS);
