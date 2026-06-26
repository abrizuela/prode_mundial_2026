import path from "node:path";
import express from "express";
import { nanoid } from "nanoid";
import webpush from "web-push";
import { buildCountryCanonicalByNormalized, canonicalizeCountryName } from "./country-normalization.ts";
import { buildInitialGroupMatches, buildInitialKnockoutMatches, listCompetingTeams } from "./fixtures.ts";
import { buildLeaderboard, computeRoundTeams, deriveBonusFinal } from "./scoring.ts";
import { findTournamentByParticipantToken, readStore, writeStore } from "./store.ts";
import { DEFAULT_LOCK_MINUTES_BEFORE_KICKOFF, isGroupResult, isKnockoutResult, ROUND_ORDER } from "./types.ts";
import type { BonusPrediction, GroupResult, KnockoutResult, RoundKey, Store, Tournament } from "./types.ts";

const app = express();
const PORT = Number(process.env.PORT ?? 3000);
const ADMIN_KEY = process.env.ADMIN_KEY ?? "ert.2026";
const PUSH_CHECK_INTERVAL_MS = 30_000;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(process.cwd(), "public")));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

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
    .map((v) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : ""))
    .filter((v) => v.length > 0);
}

function normalizeParticipantName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}

function normalizeTournamentName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function tournamentPublicSlug(name: string) {
  const plain = normalizeTournamentName(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");

  const slug = plain
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "torneo";
}

function hasTournamentSlugConflict(store: Store, tournamentName: string, excludedTournamentId = "") {
  const nextSlug = tournamentPublicSlug(tournamentName);
  return store.tournaments.some((t) => {
    if (excludedTournamentId && t.id === excludedTournamentId) return false;
    return tournamentPublicSlug(t.name) === nextSlug;
  });
}

function hasParticipantNameConflict(tournament: Tournament, name: string, excludedParticipantId = "") {
  const normalizedName = normalizeParticipantName(name);
  return tournament.participants.some((participant) => {
    if (excludedParticipantId && participant.id === excludedParticipantId) return false;
    return normalizeParticipantName(participant.name) === normalizedName;
  });
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

function getTournamentByPublicSlugOr404(res: express.Response, slugOrId: string): Tournament | null {
  const store = readStore();
  const slug = String(slugOrId || "").trim().toLocaleLowerCase("es");
  const bySlug = store.tournaments.find((t) => tournamentPublicSlug(t.name) === slug);
  if (bySlug) return bySlug;

  const byId = store.tournaments.find((t) => t.id === slugOrId);
  if (byId) return byId;

  res.status(404).json({ error: "Torneo no encontrado" });
  return null;
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

function hasEditWindowClosed(kickoffAtList: Array<string | null | undefined>) {
  const kickoffTimes = kickoffAtList
    .map((kickoffAt) => (kickoffAt ? new Date(kickoffAt).getTime() : Number.NaN))
    .filter((value) => Number.isFinite(value));

  if (!kickoffTimes.length) return false;
  const firstKickoff = Math.min(...kickoffTimes);
  return Date.now() >= (firstKickoff - 60 * 60 * 1000);
}

function hasKickoffStarted(kickoffAt: string | null | undefined) {
  if (!kickoffAt) return false;
  const kickoffTs = new Date(kickoffAt).getTime();
  if (!Number.isFinite(kickoffTs)) return false;
  return Date.now() >= kickoffTs;
}

function normalizeLockMinutes(raw: unknown) {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_LOCK_MINUTES_BEFORE_KICKOFF;
  return Math.max(0, Math.round(raw));
}

function getTournamentLockMinutes(tournament: Tournament) {
  return normalizeLockMinutes(tournament.lockMinutesBeforeKickoff);
}

function hasKickoffLockStarted(kickoffAt: string | null | undefined, lockMinutesBeforeKickoff: number) {
  if (!kickoffAt) return false;
  const kickoffTs = new Date(kickoffAt).getTime();
  if (!Number.isFinite(kickoffTs)) return false;
  return Date.now() >= (kickoffTs - lockMinutesBeforeKickoff * 60 * 1000);
}

function buildPublicWhatsAppSummaries(tournament: Tournament) {
  const lockMinutesBeforeKickoff = getTournamentLockMinutes(tournament);
  const actualTeams = computeRoundTeams(tournament.knockoutMatches.R16, tournament.actual.knockout);
  const roundLabels: Record<RoundKey, string> = {
    R16: "16vos de final",
    OCT: "8vos de final",
    QF: "Cuartos de final",
    SF: "Semifinales",
    THIRD: "Tercer puesto",
    FINAL: "Final"
  };

  const groupMatches = tournament.groupMatches.map((m) => ({
    key: `group|${m.id}`,
    stageLabel: `Grupo ${m.group}`,
    type: "group" as const,
    matchId: m.id,
    home: m.home,
    away: m.away,
    kickoffAt: m.kickoffAt
  }));

  const knockoutMatches = ROUND_ORDER.flatMap((round) =>
    tournament.knockoutMatches[round].map((m) => ({
      key: `knockout|${round}|${m.id}`,
      stageLabel: roundLabels[round] || round,
      type: "knockout" as const,
      round,
      matchId: m.id,
      home: actualTeams[round]?.[Number(m.id.split("-")[1]) - 1]?.home ?? m.home,
      away: actualTeams[round]?.[Number(m.id.split("-")[1]) - 1]?.away ?? m.away,
      kickoffAt: m.kickoffAt
    }))
  );

  const all = [...groupMatches, ...knockoutMatches]
    .filter((m) => hasKickoffLockStarted(m.kickoffAt, lockMinutesBeforeKickoff))
    .sort((a, b) => {
      const ta = a.kickoffAt ? new Date(a.kickoffAt).getTime() : Number.POSITIVE_INFINITY;
      const tb = b.kickoffAt ? new Date(b.kickoffAt).getTime() : Number.POSITIVE_INFINITY;
      return ta - tb;
    });

  return all.map((match) => {
    const local: string[] = [];
    const draw: string[] = [];
    const away: string[] = [];
    const knockoutIndex = match.type === "knockout" ? Number(match.matchId.split("-")[1]) - 1 : -1;
    const skull: string[] = [];

    for (const participant of tournament.participants) {
      if (match.type === "group") {
        const value = participant.predictions.group[match.matchId];
        if (value === "L") local.push(participant.name);
        if (value === "E") draw.push(participant.name);
        if (value === "V") away.push(participant.name);
        continue;
      }

      const value = participant.predictions.knockout[match.round][match.matchId];
      const participantTeams = computeRoundTeams(tournament.knockoutMatches.R16, participant.predictions.knockout);
      const actualMatch = actualTeams[match.round][knockoutIndex];
      const predictedMatch = participantTeams[match.round][knockoutIndex];
      const applySkull = match.round !== "R16";
      const participantHomeImpossible = applySkull && predictedMatch?.home !== actualMatch?.home;
      const participantAwayImpossible = applySkull && predictedMatch?.away !== actualMatch?.away;

      if (value === "L") {
        if (participantHomeImpossible) skull.push(participant.name);
        else local.push(participant.name);
      }
      if (value === "V") {
        if (participantAwayImpossible) skull.push(participant.name);
        else away.push(participant.name);
      }
    }

    return {
      key: match.key,
      stageLabel: match.stageLabel,
      type: match.type,
      matchId: match.matchId,
      round: match.type === "knockout" ? match.round : undefined,
      home: match.home,
      away: match.away,
      kickoffAt: match.kickoffAt,
      localNames: local,
      drawNames: draw,
      awayNames: away,
      skullNames: skull
    };
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

  const nextResults: Record<string, GroupResult> = { ...store.globalActual.group };
  for (const [matchId, value] of Object.entries(resultInput)) {
    if (isGroupResult(value)) {
      nextResults[matchId] = value;
      continue;
    }

    // Allow clearing an already-saved result by sending empty string.
    if (typeof value === "string" && value.trim() === "") {
      delete nextResults[matchId];
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
    finalStageEnabled: store.finalStageEnabled,
    knockoutMatches: store.globalKnockoutMatches,
    actual: store.globalActual,
    actualTeams,
    bonusFinal,
    teams: listCompetingTeams()
  });
});

app.patch("/api/admin/knockout/final-stage-enabled", requireAdmin, (req, res) => {
  void (async () => {
    let store = readStore();
    const enabled = Boolean(req.body?.enabled);
    const wasEnabled = Boolean(store.finalStageEnabled);
    store.finalStageEnabled = enabled;

    let notifiedCount = 0;

    if (enabled && !wasEnabled) {
      store = configureWebPush(store);

      for (const tournament of store.tournaments) {
        for (const participant of tournament.participants) {
          if (!participant.predictions.groupLockedAt || participant.predictions.finalLockedAt) {
            continue;
          }

          const token = participant.token;
          const subscriptions = store.pushState.subscriptionsByToken[token] ?? [];
          if (!subscriptions.length) continue;

          const payload = JSON.stringify({
            title: "PRODE Mundial 2026",
            body: `${tournament.name}: ya podés completar la fase final`,
            url: `/p/${token}/final`
          });

          const aliveSubs: typeof subscriptions = [];
          let delivered = false;

          for (const sub of subscriptions) {
            try {
              await webpush.sendNotification(sub, payload);
              aliveSubs.push(sub);
              delivered = true;
            } catch (error: unknown) {
              const statusCode = isObject(error) && typeof error.statusCode === "number" ? error.statusCode : 0;
              if (statusCode !== 404 && statusCode !== 410) {
                aliveSubs.push(sub);
              }
            }
          }

          store.pushState.subscriptionsByToken[token] = aliveSubs;
          if (delivered) {
            notifiedCount += 1;
          }
        }
      }
    }

    writeStore(store);
    res.json({ ok: true, finalStageEnabled: store.finalStageEnabled, notifiedCount });
  })().catch(() => {
    res.status(500).json({ error: "No se pudo actualizar el estado de fase final" });
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
    if (!id) return;
    byId.set(id, { home, away, kickoffAt });
  });

  store.globalKnockoutMatches.R16 = store.globalKnockoutMatches.R16.map((m) => {
    const custom = byId.get(m.id);
    if (!custom) return m;

    return {
      ...m,
      home: custom.home || m.home,
      away: custom.away || m.away,
      kickoffAt: custom.kickoffAt
    };
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
    if (isKnockoutResult(value)) {
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

app.post("/api/admin/notifications/custom", requireAdmin, (req, res) => {
  void (async () => {
    let store = configureWebPush(readStore());

    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    const rawUrl = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    const hasTournamentFilter = Array.isArray(req.body?.tournamentIds);
    const hasParticipantFilter = Array.isArray(req.body?.participantIds);
    const tournamentIds = hasTournamentFilter
      ? req.body.tournamentIds
          .filter((v: unknown) => typeof v === "string")
          .map((v: string) => v.trim())
          .filter((v: string) => v.length > 0)
      : [];
    const participantIds = hasParticipantFilter
      ? req.body.participantIds
          .filter((v: unknown) => typeof v === "string")
          .map((v: string) => v.trim())
          .filter((v: string) => v.length > 0)
      : [];
    const selectedTournamentIds = new Set(tournamentIds);
    const selectedParticipantIds = new Set(participantIds);

    if (!title || !body) {
      res.status(400).json({ error: "Título y mensaje son obligatorios" });
      return;
    }

    const selectedTournaments = store.tournaments.filter((t) => {
      if (!hasTournamentFilter) return true;
      return selectedTournamentIds.has(t.id);
    });

    let sentNotifications = 0;
    let deliveredParticipants = 0;

    for (const tournament of selectedTournaments) {
      for (const participant of tournament.participants) {
        if (hasParticipantFilter && !selectedParticipantIds.has(participant.id)) continue;

        const token = participant.token;
        const subscriptions = store.pushState.subscriptionsByToken[token] ?? [];
        if (!subscriptions.length) continue;

        const url = (() => {
          if (!rawUrl) return `/p/${token}`;
          const templated = rawUrl.replace(/\{token\}/g, token);
          if (templated.startsWith("http://") || templated.startsWith("https://") || templated.startsWith("/")) {
            return templated;
          }
          return `/${templated}`;
        })();

        const payload = JSON.stringify({ title, body, url });
        const aliveSubs: typeof subscriptions = [];
        let deliveredToParticipant = false;

        for (const sub of subscriptions) {
          try {
            await webpush.sendNotification(sub, payload);
            aliveSubs.push(sub);
            sentNotifications += 1;
            deliveredToParticipant = true;
          } catch (error: unknown) {
            const statusCode = isObject(error) && typeof error.statusCode === "number" ? error.statusCode : 0;
            if (statusCode !== 404 && statusCode !== 410) {
              aliveSubs.push(sub);
            }
          }
        }

        store.pushState.subscriptionsByToken[token] = aliveSubs;
        if (deliveredToParticipant) {
          deliveredParticipants += 1;
        }
      }
    }

    writeStore(store);
    res.json({
      ok: true,
      selectedTournamentCount: selectedTournaments.length,
      deliveredParticipants,
      sentNotifications
    });
  })().catch(() => {
    res.status(500).json({ error: "No se pudo enviar la notificación" });
  });
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
    publicSlug: tournamentPublicSlug(t.name),
    createdAt: t.createdAt,
    participants: t.participants.length
  }));
  res.json({ tournaments });
});

app.post("/api/tournaments", requireAdmin, (req, res) => {
  const name = typeof req.body?.name === "string" ? normalizeTournamentName(req.body.name) : "";
  const participants = normalizeParticipantNames(req.body?.participants);

  if (!name) {
    res.status(400).json({ error: "El nombre del torneo es obligatorio" });
    return;
  }

  const seenParticipantNames = new Set<string>();
  for (const participantName of participants) {
    const normalized = normalizeParticipantName(participantName);
    if (seenParticipantNames.has(normalized)) {
      res.status(409).json({ error: "Hay nombres de participantes duplicados" });
      return;
    }
    seenParticipantNames.add(normalized);
  }

  const store = readStore();
  if (hasTournamentSlugConflict(store, name)) {
    res.status(409).json({ error: "Ya existe un torneo con ese nombre" });
    return;
  }
  const tournamentId = nanoid(10);
  const tournament: Tournament = {
    id: tournamentId,
    name,
    createdAt: new Date().toISOString(),
    lockMinutesBeforeKickoff: DEFAULT_LOCK_MINUTES_BEFORE_KICKOFF,
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

  const name = typeof req.body?.name === "string" ? normalizeTournamentName(req.body.name) : "";
  if (!name) {
    res.status(400).json({ error: "Nombre inválido" });
    return;
  }

  if (hasTournamentSlugConflict(store, name, tournament.id)) {
    res.status(409).json({ error: "Ya existe un torneo con ese nombre" });
    return;
  }

  tournament.name = name;
  writeStore(store);
  res.json({ ok: true });
});

app.patch("/api/tournaments/:id/lock-window", requireAdmin, (req, res) => {
  const store = readStore();
  const tournament = store.tournaments.find((t) => t.id === req.params.id);
  if (!tournament) {
    res.status(404).json({ error: "Torneo no encontrado" });
    return;
  }

  const minutesRaw = req.body?.minutes;
  const minutes = normalizeLockMinutes(minutesRaw);
  if (typeof minutesRaw !== "number" || !Number.isFinite(minutesRaw)) {
    res.status(400).json({ error: "Valor inválido de minutos" });
    return;
  }

  tournament.lockMinutesBeforeKickoff = minutes;
  writeStore(store);
  res.json({ ok: true, minutes });
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

  const name = typeof req.body?.name === "string" ? req.body.name.trim().replace(/\s+/g, " ") : "";
  if (!name) {
    res.status(400).json({ error: "Nombre de participante inválido" });
    return;
  }

  if (hasParticipantNameConflict(tournament, name)) {
    res.status(409).json({ error: "Ya existe un participante con ese nombre" });
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

  const name = typeof req.body?.name === "string" ? req.body.name.trim().replace(/\s+/g, " ") : "";
  if (!name) {
    res.status(400).json({ error: "Nombre de participante inválido" });
    return;
  }

  if (hasParticipantNameConflict(tournament, name, participant.id)) {
    res.status(409).json({ error: "Ya existe un participante con ese nombre" });
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

  participant.predictions.groupLockedAt = null;
  participant.predictions.finalLockedAt = null;

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
      lockMinutesBeforeKickoff: getTournamentLockMinutes(tournament),
      participants: tournament.participants.map((p) => ({
        id: p.id,
        name: p.name,
        token: p.token,
        predictions: {
          group: p.predictions.group,
          knockout: p.predictions.knockout,
          bonus: p.predictions.bonus
        },
        groupLockedAt: p.predictions.groupLockedAt,
        finalLockedAt: p.predictions.finalLockedAt,
        notificationsEnabled: (store.pushState.subscriptionsByToken[p.token] ?? []).length > 0,
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
    if (isGroupResult(value)) {
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
    if (isKnockoutResult(value)) {
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

app.get("/api/public/tournaments/:slug", (req, res) => {
  const found = getTournamentByPublicSlugOr404(res, req.params.slug);
  if (!found) return;

  const store = readStore();
  const tournament = withGlobalTournamentData(store, found);
  res.json({
    tournament: {
      id: tournament.id,
      name: tournament.name,
      publicSlug: tournamentPublicSlug(tournament.name),
      createdAt: tournament.createdAt,
      participantCount: tournament.participants.length,
      lockMinutesBeforeKickoff: getTournamentLockMinutes(tournament)
    },
    leaderboard: buildLeaderboard(tournament),
    whatsappSummaries: buildPublicWhatsAppSummaries(tournament)
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
  const allTeams = [...new Set(tournament.groupMatches.flatMap((m) => [m.home, m.away]))];
  const countryCanonicalByNormalized = buildCountryCanonicalByNormalized(allTeams);

  res.json({
    tournament: {
      id: tournament.id,
      name: tournament.name,
      lockMinutesBeforeKickoff: getTournamentLockMinutes(tournament),
      finalStageEnabled: store.finalStageEnabled,
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
    leaderboard: buildLeaderboard(tournament),
    countryCanonicalByNormalized
  });
});

app.patch("/api/p/:token/profile", (req, res) => {
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

  const name = typeof req.body?.name === "string" ? req.body.name.trim().replace(/\s+/g, " ") : "";
  if (!name) {
    res.status(400).json({ error: "Nombre inválido" });
    return;
  }

  const participant = tournament.participants[participantIndex];
  if (hasParticipantNameConflict(tournament, name, participant.id)) {
    res.status(409).json({ error: "Ya existe un participante con ese nombre" });
    return;
  }

  tournament.participants[participantIndex].name = name;
  writeStore(store);
  res.json({ ok: true });
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
  const projectedTournament = withGlobalTournamentData(store, tournament);
  const lockMinutesBeforeKickoff = getTournamentLockMinutes(tournament);
  const allTeams = [...new Set(projectedTournament.groupMatches.flatMap((m) => [m.home, m.away]))];
  const countryCanonicalByNormalized = buildCountryCanonicalByNormalized(allTeams);

  const groupInput = req.body?.group ?? {};
  const bonusInput = req.body?.bonus ?? {};

  const nextGroup: Record<string, GroupResult> = { ...participant.predictions.group };
  for (const match of projectedTournament.groupMatches) {
    if (hasKickoffLockStarted(match.kickoffAt, lockMinutesBeforeKickoff)) continue;
    const value = groupInput[match.id];
    if (isGroupResult(value)) {
      nextGroup[match.id] = value;
    } else {
      delete nextGroup[match.id];
    }
  }

  participant.predictions.group = nextGroup;

  const firstGroupKickoffStarted = projectedTournament.groupMatches.some((m) =>
    hasKickoffLockStarted(m.kickoffAt, lockMinutesBeforeKickoff)
  );
  if (!firstGroupKickoffStarted) {
    participant.predictions.bonus = {
      champion: typeof bonusInput.champion === "string" ? canonicalizeCountryName(bonusInput.champion, countryCanonicalByNormalized) : "",
      runnerUp: typeof bonusInput.runnerUp === "string" ? canonicalizeCountryName(bonusInput.runnerUp, countryCanonicalByNormalized) : "",
      third: typeof bonusInput.third === "string" ? canonicalizeCountryName(bonusInput.third, countryCanonicalByNormalized) : "",
      fourth: typeof bonusInput.fourth === "string" ? canonicalizeCountryName(bonusInput.fourth, countryCanonicalByNormalized) : ""
    };
  }

  writeStore(store);
  res.json({ ok: true, savedAt: new Date().toISOString() });
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
  const projectedTournament = withGlobalTournamentData(store, tournament);
  const lockMinutesBeforeKickoff = getTournamentLockMinutes(tournament);

  if (!store.finalStageEnabled) {
    res.status(409).json({ error: "La fase final todavía no está habilitada por el admin" });
    return;
  }

  const knockoutInput = req.body?.knockout ?? {};
  const knockout = {
    R16: { ...participant.predictions.knockout.R16 },
    OCT: { ...participant.predictions.knockout.OCT },
    QF: { ...participant.predictions.knockout.QF },
    SF: { ...participant.predictions.knockout.SF },
    THIRD: { ...participant.predictions.knockout.THIRD },
    FINAL: { ...participant.predictions.knockout.FINAL }
  };

  for (const round of ROUND_ORDER) {
    const roundInput = knockoutInput[round] ?? {};
    for (const match of projectedTournament.knockoutMatches[round]) {
      if (hasKickoffLockStarted(match.kickoffAt, lockMinutesBeforeKickoff)) continue;
      const matchId = match.id;
      const value = roundInput[matchId];
      if (isKnockoutResult(value)) {
        knockout[round][matchId] = value;
      } else {
        delete knockout[round][matchId];
      }
    }
  }

  participant.predictions.knockout = knockout;

  writeStore(store);
  res.json({ ok: true, savedAt: new Date().toISOString() });
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
