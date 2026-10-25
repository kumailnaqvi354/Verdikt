import { PageHeader } from "@/components/ui";
import { ReviewApp } from "@/components/ReviewApp";
import { INSURERS } from "@/lib/verdikt/data";
import { LEVELS } from "@/lib/verdikt/review";

export default function Home() {
  const insurers = INSURERS.map(({ id, name }) => ({ id, name }));
  const levels = Object.entries(LEVELS).map(([id, l]) => ({ id, label: l.label, workers: l.workers.length, totalUsdc: Math.round(l.pricePerWorker * l.workers.length * 10000) / 10000 }));
  return (
    <>
      <PageHeader eyebrow="Verdikt · Insurer reputation" title={<>Stars can be faked.<br />Paid claims can&apos;t.</>}>
        Verdikt rates insurers only from verified claim outcomes. Pick an insurer and how deep to go: Agent A plans the work, pays
        worker agents in devnet USDC to gather the evidence in parallel, and returns a Trust Review linked to every payment.
      </PageHeader>
      <ReviewApp insurers={insurers} levels={levels} />
      <p className="small muted">
        Demo data: the insurers are fictional and their claim records are seeded for this demo. Payments are real transactions on
        Solana devnet with test USDC (no real money).
      </p>
    </>
  );
}
