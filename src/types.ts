export type GroupResult = "L" | "E" | "V";
export type KnockoutResult = "L" | "V";

export type RoundKey = "R16" | "OCT" | "QF" | "SF" | "THIRD" | "FINAL";

export type GroupMatch = {
  id: string;
  group: string;
  home: string;
  away: string;
  kickoffAt: string | null;
};

export type KnockoutMatch = {
  id: string;
  round: RoundKey;
  index: number;
  home: string;
  away: string;
  kickoffAt: string | null;
};

export type BonusPrediction = {
  champion: string;
  runnerUp: string;
  third: string;
  fourth: string;
};

export type Predictions = {
  group: Record<string, GroupResult>;
  knockout: Record<RoundKey, Record<string, KnockoutResult>>;
  bonus: BonusPrediction;
  groupLockedAt: string | null;
  finalLockedAt: string | null;
};

export type Participant = {
  id: string;
  name: string;
  token: string;
  predictions: Predictions;
};

export type ActualResults = {
  group: Record<string, GroupResult>;
  knockout: Record<RoundKey, Record<string, KnockoutResult>>;
  bonusFinal: BonusPrediction;
};

export type Tournament = {
  id: string;
  name: string;
  createdAt: string;
  participants: Participant[];
  groupMatches: GroupMatch[];
  knockoutMatches: Record<RoundKey, KnockoutMatch[]>;
  actual: ActualResults;
};

export type Store = {
  tournaments: Tournament[];
  globalGroupKickoffAt: Record<string, string | null>;
  globalKnockoutMatches: Record<RoundKey, KnockoutMatch[]>;
  globalActual: {
    group: Record<string, GroupResult>;
    knockout: Record<RoundKey, Record<string, KnockoutResult>>;
  };
  pushState: {
    vapidPublicKey: string;
    vapidPrivateKey: string;
    subscriptionsByToken: Record<string, Array<{ endpoint: string; keys: { p256dh: string; auth: string } }>>;
    sentByToken: Record<string, string[]>;
  };
};

export const ROUND_ORDER: RoundKey[] = ["R16", "OCT", "QF", "SF", "THIRD", "FINAL"];

export const ROUND_POINTS: Record<RoundKey, number> = {
  R16: 1,
  OCT: 2,
  QF: 4,
  SF: 8,
  THIRD: 16,
  FINAL: 24
};
