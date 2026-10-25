"use client";

import { useState } from "react";
import { Led, Module, PageHeader } from "@/components/ui";

export default function ChatPage() {
  const [prompt, setPrompt] = useState("Explain what an API is in two sentences.");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function send() {
    setLoading(true);
    setError("");
    setAnswer("");
    try {
      // The browser only talks to our own server route; the Gemini key stays on the server.
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setAnswer(data.text ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const status = loading ? "Thinking" : error ? "Error" : answer ? "Answered" : "Ready";
  const tone = loading ? "signal" : error ? "fault" : answer ? "ok" : undefined;

  return (
    <>
      <PageHeader eyebrow="Module · Gemini AI" title="Ask Gemini.">
        Your question goes to this app&apos;s own <code>/api/chat</code> route, which calls Gemini with the key in{" "}
        <code>.env.local</code>. The key never reaches the browser.
      </PageHeader>

      <div className="cols">
        <Module label="A · Prompt">
          <label className="label" htmlFor="prompt">
            What do you want to ask?
          </label>
          <textarea id="prompt" rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <div className="row">
            <button className="btn btn--primary" onClick={send} disabled={loading || !prompt.trim()}>
              {loading ? "Thinking…" : "Ask Gemini ▸"}
            </button>
          </div>
        </Module>

        <Module label="B · Answer" right={<><Led tone={tone} blink={loading} /> {status}</>}>
          <div aria-live="polite" className="stack">
            {error && (
              <p className="notice notice--fault" style={{ margin: 0 }}>
                {error}
                {/API_KEY is not set/.test(error) && (
                  <>
                    {" "}
                    Get a free key at{" "}
                    <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
                      aistudio.google.com ↗
                    </a>
                    .
                  </>
                )}
              </p>
            )}
            {answer ? (
              <p className="answer">{answer}</p>
            ) : (
              !error && <div className="empty">{loading ? "Waiting for Gemini…" : "The answer appears here."}</div>
            )}
          </div>
        </Module>
      </div>
    </>
  );
}
