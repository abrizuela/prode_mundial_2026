import fs from "node:fs";
import path from "node:path";
import { buildInitialGroupMatches, buildInitialKnockoutMatches } from "./fixtures.ts";
import { ROUND_ORDER } from "./types.ts";
import type { GroupResult, KnockoutMatch, KnockoutResult, RoundKey, Store, Tournament } from "./types.ts";

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

function normalizeKnockoutRound(
  sourceRound: KnockoutMatch[] | undefined,
  fallbackRound: KnockoutMatch[]
) {
  const source = sourceRound ?? fallbackRound;
  const hasAnyKickoff = source.some((m) => typeof m.kickoffAt === "string" && m.kickoffAt.trim().length > 0);
  const fallbackById = new Map(fallbackRound.map((m) => [m.id, m]));
  const isLegacyPlaceholder = (team: string) => /^POR DEFINIR\b/i.test(team);

  return source.map((m) => {
    const fallback = fallbackById.get(m.id);
    const normalizedKickoff = typeof m.kickoffAt === "string" ? m.kickoffAt : null;
    const normalizedHome = typeof m.home === "string" ? m.home.trim() : "";
    const normalizedAway = typeof m.away === "string" ? m.away.trim() : "";

    if (hasAnyKickoff) {
      return {
        ...m,
        home: !normalizedHome || isLegacyPlaceholder(normalizedHome) ? (fallback?.home ?? normalizedHome) : normalizedHome,
        away: !normalizedAway || isLegacyPlaceholder(normalizedAway) ? (fallback?.away ?? normalizedAway) : normalizedAway,
        kickoffAt: normalizedKickoff
      };
    }

    return {
      ...m,
      home: !normalizedHome || isLegacyPlaceholder(normalizedHome) ? (fallback?.home ?? normalizedHome) : normalizedHome,
      away: !normalizedAway || isLegacyPlaceholder(normalizedAway) ? (fallback?.away ?? normalizedAway) : normalizedAway,
      kickoffAt: fallback?.kickoffAt ?? null
    };
  });
}

function normalizeStore(raw: unknown): Store {
  const obj = (raw ?? {}) as Partial<Store> & {
    tournaments?: Tournament[];
    globalGroupKickoffAt?: Record<string, string | null>;
    finalStageEnabled?: boolean;
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
    R16: normalizeKnockoutRound(
      obj.globalKnockoutMatches?.R16 ?? firstTournamentKnockout?.R16,
      fallbackKnockout.R16
    ),
    OCT: normalizeKnockoutRound(
      obj.globalKnockoutMatches?.OCT ?? firstTournamentKnockout?.OCT,
      fallbackKnockout.OCT
    ),
    QF: normalizeKnockoutRound(
      obj.globalKnockoutMatches?.QF ?? firstTournamentKnockout?.QF,
      fallbackKnockout.QF
    ),
    SF: normalizeKnockoutRound(
      obj.globalKnockoutMatches?.SF ?? firstTournamentKnockout?.SF,
      fallbackKnockout.SF
    ),
    THIRD: normalizeKnockoutRound(
      obj.globalKnockoutMatches?.THIRD ?? firstTournamentKnockout?.THIRD,
      fallbackKnockout.THIRD
    ),
    FINAL: normalizeKnockoutRound(
      obj.globalKnockoutMatches?.FINAL ?? firstTournamentKnockout?.FINAL,
      fallbackKnockout.FINAL
    )
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
    finalStageEnabled: obj.finalStageEnabled ?? false,
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
