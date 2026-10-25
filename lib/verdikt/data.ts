import { createHash } from "node:crypto";

// Seeded DEMO data. The insurers are fictional and every number here is made up for the demo:
// real names with invented statistics would mislead. Records are generated from a fixed seed,
// so every run shows the same figures.

export type ClaimType = "home" | "motor" | "travel" | "pet";
export type Outcome = "paid" | "partially_paid" | "denied";

export interface ClaimRecord {
  id: string;
  insurerId: string;
  type: ClaimType;
  outcome: Outcome;
  daysToSettle: number;
  denialReason: string | null;
  year: number;
  /** SHA-256 of the record's fields: what an on-chain attestation would hold. */
  hash: string;
  /** "seeded" records ship with the demo; "attested" ones were submitted and written to devnet. */
  source: "seeded" | "attested";
  attestation?: string;
}

export interface Insurer {
  id: string;
  name: string;
  /** Upheld complaints per 1,000 policies (fictional snapshot). */
  complaintsPer1k: number;
  profile: { paid: number; partial: number; avgDays: number; records: number };
}

export const INSURERS: Insurer[] = [
  { id: "northbridge", name: "Northbridge Insurance", complaintsPer1k: 0.4, profile: { paid: 0.82, partial: 0.1, avgDays: 21, records: 48 } },
  { id: "harbour", name: "Harbour Mutual", complaintsPer1k: 0.7, profile: { paid: 0.74, partial: 0.12, avgDays: 29, records: 36 } },
  { id: "kestrel", name: "Kestrel Direct", complaintsPer1k: 1.9, profile: { paid: 0.55, partial: 0.15, avgDays: 47, records: 41 } },
  { id: "albion", name: "Albion Shield", complaintsPer1k: 1.1, profile: { paid: 0.66, partial: 0.14, avgDays: 35, records: 30 } },
  { id: "meridian", name: "Meridian Cover", complaintsPer1k: 0.3, profile: { paid: 0.87, partial: 0.07, avgDays: 16, records: 25 } },
  { id: "tidewell", name: "Tidewell General", complaintsPer1k: 2.6, profile: { paid: 0.48, partial: 0.17, avgDays: 58, records: 33 } },
  // Few claims on record, to show the low-sample warning.
  { id: "fenwick", name: "Fenwick Assurance", complaintsPer1k: 0.9, profile: { paid: 0.7, partial: 0.1, avgDays: 30, records: 12 } },
];

const TYPES: ClaimType[] = ["home", "motor", "travel", "pet"];
const DENIALS = ["Policy exclusion", "Late notification", "Insufficient evidence", "Pre-existing condition", "Wear and tear"];
const YEARS = [2023, 2024, 2025, 2026];

/** Small deterministic PRNG (mulberry32) so the demo data never changes between runs. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function recordHash(r: Omit<ClaimRecord, "hash" | "source" | "attestation">): string {
  const canonical = JSON.stringify([r.id, r.insurerId, r.type, r.outcome, r.daysToSettle, r.denialReason, r.year]);
  return createHash("sha256").update(canonical).digest("hex");
}

function seedRecords(insurer: Insurer, index: number): ClaimRecord[] {
  const rand = rng(1000 + index);
  return Array.from({ length: insurer.profile.records }, (_, i) => {
    const roll = rand();
    const outcome: Outcome = roll < insurer.profile.paid ? "paid" : roll < insurer.profile.paid + insurer.profile.partial ? "partially_paid" : "denied";
    const days = Math.max(3, Math.round(insurer.profile.avgDays * (0.5 + rand())));
    const base = {
      id: `${insurer.id}-${String(i + 1).padStart(3, "0")}`,
      insurerId: insurer.id,
      type: TYPES[Math.floor(rand() * TYPES.length)],
      outcome,
      daysToSettle: days,
      denialReason: outcome === "paid" ? null : DENIALS[Math.floor(rand() * DENIALS.length)],
      year: YEARS[Math.floor(rand() * YEARS.length)],
    };
    return { ...base, hash: recordHash(base), source: "seeded" as const };
  });
}

const seeded = INSURERS.flatMap((ins, i) => seedRecords(ins, i));
/** Records submitted through the claim form during this server's lifetime. */
const submitted: ClaimRecord[] = [];

export function recordsFor(insurerId: string): ClaimRecord[] {
  return [...seeded, ...submitted].filter((r) => r.insurerId === insurerId);
}

export function addAttestedRecord(record: ClaimRecord) {
  submitted.push(record);
}

export function findInsurer(idOrName: string): Insurer | undefined {
  const q = idOrName.trim().toLowerCase();
  return INSURERS.find((i) => i.id === q || i.name.toLowerCase() === q);
}

// Fictional demo claimants for the Claimant Passport: the same verified records, seen from the
// customer's side. Each links a few seeded records by id.
export interface Claimant {
  id: string;
  name: string;
  passportNo: string;
  memberSince: number;
  recordIds: string[];
}

export const CLAIMANTS: Claimant[] = [
  { id: "amara", name: "Amara Okafor", passportNo: "VDK-204817", memberSince: 2023, recordIds: ["northbridge-004", "meridian-011", "harbour-019"] },
  { id: "tom", name: "Tom Whitfield", passportNo: "VDK-311952", memberSince: 2024, recordIds: ["kestrel-007", "kestrel-022"] },
  { id: "priya", name: "Priya Raman", passportNo: "VDK-128460", memberSince: 2023, recordIds: ["albion-003", "tidewell-015", "meridian-002", "northbridge-030"] },
  { id: "jonas", name: "Jonas Becker", passportNo: "VDK-457039", memberSince: 2025, recordIds: ["harbour-008"] },
];

export function claimantRecords(c: Claimant): ClaimRecord[] {
  return c.recordIds.map((id) => seeded.find((r) => r.id === id)).filter((r): r is ClaimRecord => !!r);
}

// Worker agents. Agent A pays each one in devnet USDC before it runs. These addresses are the
// workers' receiving wallets (test money only).
export const WORKERS = [
  { id: "claims", name: "Claims Auditor", task: "Verified claim count, payout rate and days to settle", address: "8zsZ7KVWpUvoSA4d8EAs8ppRiNcvXyTzNAoQdGXGAFH8" },
  { id: "types", name: "Claim-Type Analyst", task: "Payout rate by claim type", address: "9noyqg8ankfUQf2792LfZijqYmun9senz51tUihTLKfH" },
  { id: "complaints", name: "Complaints Researcher", task: "Upheld complaints snapshot", address: "HXSs1Ko7mfEHqGjYB6AGJy6dxo5TuDbo8yJVV9t2vcWW" },
  { id: "denials", name: "Denial Investigator", task: "Most common denial reasons", address: "Hmgxy4E5jQaFbPFocje1LuE5PMkE816CKYBYbUjvVDFr" },
  { id: "trends", name: "Trend Analyst", task: "Payout rate year by year", address: "CwRx5DJTasajDqZpMjHNhgkvBFNF5GEzk2wY3QpJhgD" },
] as const;

export type WorkerId = (typeof WORKERS)[number]["id"];
