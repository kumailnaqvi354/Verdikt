import { PageHeader } from "@/components/ui";
import { PassportApp, type PassportView } from "@/components/PassportApp";
import { CLAIMANTS, claimantRecords, INSURERS } from "@/lib/verdikt/data";

// The Claimant Passport: the same verified claim records that rate insurers, read from the customer's
// side, as a portable record a claimant could show a new insurer.

export default function PassportPage() {
  const views: PassportView[] = CLAIMANTS.map((c) => {
    const records = claimantRecords(c);
    const denied = records.filter((r) => r.outcome === "denied").length;
    return {
      id: c.id,
      name: c.name,
      passportNo: c.passportNo,
      memberSince: c.memberSince,
      claims: records.map((r) => ({
        id: r.id,
        insurer: INSURERS.find((i) => i.id === r.insurerId)?.name ?? r.insurerId,
        type: r.type,
        outcome: r.outcome,
        year: r.year,
        hash: r.hash,
      })),
      summary: {
        verifiedClaims: records.length,
        paidOrPartly: records.length - denied,
        denied,
        insurers: new Set(records.map((r) => r.insurerId)).size,
        yearsOnRecord: 2026 - c.memberSince + 1,
      },
    };
  });

  return (
    <>
      <PageHeader eyebrow="Verdikt · Claimant Passport" title={<>Your claims,<br />your reputation.</>}>
        The proofs that rate insurers also belong to you. A Claimant Passport shows your verified claim history, so you can prove
        you&apos;re a good customer to a new insurer without handing over your letters or personal details.
      </PageHeader>
      <PassportApp passports={views} />
      <p className="small muted">Demo: these claimants and their passports are fictional, built from the seeded demo records.</p>
    </>
  );
}
