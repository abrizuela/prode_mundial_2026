import fs from "node:fs";
import path from "node:path";
import { buildInitialGroupMatches, buildInitialKnockoutMatches } from "./fixtures.ts";
import { ROUND_ORDER } from "./types.ts";
import type { GroupResult, KnockoutResult, RoundKey, Store, Tournament } from "./types.ts";

const STORE_PATH = path.join(process.cwd(), "data", "store.json");

function ensureStoreFile() {
  if (!fs.existsSync(STORE_PATH)) {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify({ tournaments: [] }, null, 2));
  }
}

function buildDefaultGlobalKickoffMap() {
  const map: Record<string, string | null> = {};
  for (const match of buildInitialGroupMatches()) {
    map[match.id] = match.kickoffAt ?? null;
  }
  return map;
}

function emptyKnockoutResults(): Record<RoundKey, Record<string, KnockoutResult>> {
  return {
    R16: {},
    OCT: {},
    QF: {},
    SF: {},
    THIRD: {},
    FINAL: {}
  };
}

function emptyGlobalActual() {
  return {
    group: {} as Record<string, GroupResult>,
    knockout: emptyKnockoutResults()
  };
}

function normalizeStore(raw: unknown): Store {
  const obj = (raw ?? {}) as Partial<Store> & {
    tournaments?: Tournament[];
    globalGroupKickoffAt?: Record<string, string | null>;
    globalKnockoutMatches?: Store["globalKnockoutMatches"];
    globalActual?: Store["globalActual"];
    pushState?: Store["pushState"];
  };

  const tournaments = Array.isArray(obj.tournaments) ? obj.tournaments : [];
  const fallbackKickoff = buildDefaultGlobalKickoffMap();
  const globalGroupKickoffAt: Record<string, string | null> = {
    ...fallbackKickoff,
    ...(obj.globalGroupKickoffAt ?? {})
  };

  // Migrate legacy per-tournament kickoff values into global map if present.
  for (const t of tournaments) {
    for (const match of t.groupMatches ?? []) {
      if (match?.id && typeof match.kickoffAt === "string" && match.kickoffAt.trim()) {
        globalGroupKickoffAt[match.id] = match.kickoffAt;
      }
    }
  }

  const fallbackKnockout = buildInitialKnockoutMatches();
  const firstTournamentKnockout = tournaments[0]?.knockoutMatches;
  const globalKnockoutMatches: Store["globalKnockoutMatches"] = {
    R16: (obj.globalKnockoutMatches?.R16 ?? firstTournamentKnockout?.R16 ?? fallbackKnockout.R16).map((m) => ({
      ...m,
      kickoffAt: typeof m.kickoffAt === "string" ? m.kickoffAt : null
    })),
    OCT: (obj.globalKnockoutMatches?.OCT ?? firstTournamentKnockout?.OCT ?? fallbackKnockout.OCT).map((m) => ({
      ...m,
      kickoffAt: typeof m.kickoffAt === "string" ? m.kickoffAt : null
    })),
    QF: (obj.globalKnockoutMatches?.QF ?? firstTournamentKnockout?.QF ?? fallbackKnockout.QF).map((m) => ({
      ...m,
      kickoffAt: typeof m.kickoffAt === "string" ? m.kickoffAt : null
    })),
    SF: (obj.globalKnockoutMatches?.SF ?? firstTournamentKnockout?.SF ?? fallbackKnockout.SF).map((m) => ({
      ...m,
      kickoffAt: typeof m.kickoffAt === "string" ? m.kickoffAt : null
    })),
    THIRD: (obj.globalKnockoutMatches?.THIRD ?? firstTournamentKnockout?.THIRD ?? fallbackKnockout.THIRD).map((m) => ({
      ...m,
      kickoffAt: typeof m.kickoffAt === "string" ? m.kickoffAt : null
    })),
    FINAL: (obj.globalKnockoutMatches?.FINAL ?? firstTournamentKnockout?.FINAL ?? fallbackKnockout.FINAL).map((m) => ({
      ...m,
      kickoffAt: typeof m.kickoffAt === "string" ? m.kickoffAt : null
    }))
  };

  for (const tournament of tournaments) {
    tournament.participants = (tournament.participants ?? []).map((participant) => {
      const legacyLockedAt = (participant.predictions as { lockedAt?: string | null }).lockedAt ?? null;
      const groupLockedAt = participant.predictions.groupLockedAt ?? legacyLockedAt;
      const finalLockedAt = participant.predictions.finalLockedAt ?? legacyLockedAt;
      return {
        ...participant,
        predictions: {
          ...participant.predictions,
          groupLockedAt,
          finalLockedAt
        }
      };
    });
  }

  const globalActual = emptyGlobalActual();
  Object.assign(globalActual.group, obj.globalActual?.group ?? {});
  for (const round of ROUND_ORDER) {
    Object.assign(globalActual.knockout[round], obj.globalActual?.knockout?.[round] ?? {});
  }

  // Migrate legacy per-tournament real results into global results if not present.
  for (const t of tournaments) {
    Object.assign(globalActual.group, t.actual?.group ?? {});
    for (const round of ROUND_ORDER) {
      Object.assign(globalActual.knockout[round], t.actual?.knockout?.[round] ?? {});
    }
  }

  const pushState: Store["pushState"] = {
    vapidPublicKey: obj.pushState?.vapidPublicKey ?? "",
    vapidPrivateKey: obj.pushState?.vapidPrivateKey ?? "",
    subscriptionsByToken: obj.pushState?.subscriptionsByToken ?? {},
    sentByToken: obj.pushState?.sentByToken ?? {}
  };

  return {
    tournaments,
    globalGroupKickoffAt,
    globalKnockoutMatches,
    globalActual,
    pushState
  };
}

export function readStore(): Store {
  ensureStoreFile();
  const raw = fs.readFileSync(STORE_PATH, "utf-8");
  return normalizeStore(JSON.parse(raw));
}

export function writeStore(store: Store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

export function updateTournament(tournamentId: string, updater: (t: Tournament) => Tournament): Tournament | null {
  const store = readStore();
  const idx = store.tournaments.findIndex((t) => t.id === tournamentId);
  if (idx === -1) {
    return null;
  }

  const updated = updater(store.tournaments[idx]);
  store.tournaments[idx] = updated;
  writeStore(store);
  return updated;
}

export function findTournamentByParticipantToken(token: string): { tournament: Tournament; participantIndex: number } | null {
  const store = readStore();
  for (const tournament of store.tournaments) {
    const participantIndex = tournament.participants.findIndex((p) => p.token === token);
    if (participantIndex >= 0) {
      return { tournament, participantIndex };
    }
  }
  return null;
}
