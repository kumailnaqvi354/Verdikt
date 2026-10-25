import { Led, Module, PageHeader } from "@/components/ui";
import { implementedTaskTypes } from "@/lib/race/adapter";
import { TASK_TYPES } from "@/lib/race/protocol";

export const dynamic = "force-dynamic";

const LAYER: Record<string, string> = {
  respond: "First Intelligence",
  extract: "Structured Outputs",
  use_tools: "Tool Calling, Reliability",
  answer_from_source: "External Knowledge",
  converse: "Memory and Context",
  run_workflow: "Autonomous Workflow",
};

// What the race verifier will find when it calls this app. Shows no secrets.
export default function RacePage() {
  const tokenSet = Boolean(process.env.AGENT_STUDIO_VERIFIER_TOKEN);
  const done = new Set(implementedTaskTypes());
  return (
    <>
      <PageHeader eyebrow="AI RACE ADAPTER" title="Race readiness">
        The race verifier calls <code>/agent-studio/v1/health</code> and <code>/agent-studio/v1/tasks</code> on your public URL. Your logic lives in{" "}
        <code>lib/race/handlers.ts</code>.
      </PageHeader>
      <Module label="SETUP">
        <ul>
          <li>
            <Led tone={tokenSet ? "ok" : "fault"} /> Verifier token {tokenSet ? "is set" : "is missing: copy it from your team page into AGENT_STUDIO_VERIFIER_TOKEN"}
          </li>
          <li>
            <Led tone="signal" /> Deploy to a public https:// URL and paste it on your team page (the verifier doesn&apos;t follow redirects)
          </li>
        </ul>
      </Module>
      <Module label="TASK TYPES" right={`${done.size} OF ${TASK_TYPES.length} BUILT`}>
        <ul>
          {TASK_TYPES.map((t) => (
            <li key={t}>
              <Led tone={done.has(t) ? "ok" : undefined} /> <code>{t}</code> · {LAYER[t]} · {done.has(t) ? "handler written" : "not built yet"}
            </li>
          ))}
        </ul>
      </Module>
    </>
  );
}
