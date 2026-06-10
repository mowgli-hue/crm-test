"use client";
import React, { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

// The Case Agent dashboard. Shows the prioritized worklist the agent computed
// for every active case (stage, next action, missing docs, IRCC forms), and
// lets a manager run the safe auto-actions (assemble files, fill form drafts).

type Assessment = {
  caseId: string; client: string; formType: string; assignedTo: string;
  stage: string; stageLabel: string; nextAction: string; autoDoable: boolean;
  autoActionKey?: string; priority: number; reasons: string[];
  missingDocs: string[]; permitDaysLeft?: number;
  formsRequired: string[]; formsPresent: string[]; formsMissing: string[];
};
type Summary = {
  total: number; byStage: Record<string, number>;
  readyToPrepare: number; awaitingDocs: number; needsOwner: number;
  changesNeeded: number; formsOutstanding: number;
};

const STAGE_STYLE: Record<string, string> = {
  needs_owner: "bg-rose-50 text-rose-700 border-rose-200",
  changes_needed: "bg-amber-50 text-amber-700 border-amber-200",
  awaiting_docs: "bg-sky-50 text-sky-700 border-sky-200",
  ready_to_prepare: "bg-emerald-50 text-emerald-700 border-emerald-200",
  prepared: "bg-violet-50 text-violet-700 border-violet-200",
  in_review: "bg-indigo-50 text-indigo-700 border-indigo-200",
  submitted: "bg-slate-100 text-slate-500 border-slate-200",
  unknown: "bg-slate-50 text-slate-500 border-slate-200",
};

export default function AgentDashboard() {
  const [data, setData] = useState<{ summary: Summary; cases: Assessment[]; actionable: Assessment[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [busyCase, setBusyCase] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [msg, setMsg] = useState<string>("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/admin/case-agent");
      const json: any = await res.json().catch(() => null);
      if (json?.ok) setData(json);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const runForCase = async (caseId: string, action: string) => {
    setBusyCase(caseId); setMsg("");
    const path = action === "auto_prepare" ? `/cases/${caseId}/auto-prepare` : `/cases/${caseId}/fill-forms`;
    try {
      const res = await apiFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const json: any = await res.json().catch(() => ({}));
      setMsg(json?.ok
        ? `✅ ${caseId}: ${action === "auto_prepare" ? (json.message || "assembled") : `filled ${(json.filled || []).map((f: any) => f.form).join(", ") || "0 forms"}`}`
        : `⚠️ ${caseId}: ${json?.error || json?.reason || "could not complete"}`);
      await load();
    } catch (e) {
      setMsg(`⚠️ ${caseId}: ${(e as Error).message}`);
    } finally { setBusyCase(null); }
  };

  const runBatch = async () => {
    if (!confirm("Let the agent assemble ready files and fill form drafts (up to 25)? It never messages clients or submits to IRCC.")) return;
    setRunning(true); setMsg("");
    try {
      const res = await apiFetch("/admin/case-agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ act: true, max: 25 }) });
      const json: any = await res.json().catch(() => ({}));
      if (json?.ok) setMsg(`✅ Assembled ${json.assembled?.succeeded ?? 0}/${json.assembled?.attempted ?? 0} files · filled forms on ${json.formsFilled?.succeeded ?? 0}/${json.formsFilled?.attempted ?? 0} cases.`);
      else setMsg(`⚠️ ${json?.error || "batch failed"}`);
      await load();
    } finally { setRunning(false); }
  };

  const cases = (data?.cases || []).filter((c) => filter === "all" ? c.stage !== "submitted" : c.stage === filter);
  const sum = data?.summary;

  return (
    <div className="p-5 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <span className="text-2xl">🤖</span>
        <h1 className="text-xl font-bold text-slate-900">Case Agent</h1>
        <button onClick={load} className="ml-auto rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">↻ Refresh</button>
      </div>
      <p className="text-sm text-slate-500 mb-4">Every active case, its stage and next action. The agent does the safe steps — assemble files and fill form drafts — and never messages clients or submits to IRCC.</p>

      {/* Summary chips */}
      {sum && (
        <div className="flex flex-wrap gap-2 mb-4">
          {[
            ["all", `${sum.total} active`, "bg-slate-900 text-white"],
            ["needs_owner", `${sum.needsOwner} need owner`, STAGE_STYLE.needs_owner],
            ["changes_needed", `${sum.changesNeeded} changes needed`, STAGE_STYLE.changes_needed],
            ["awaiting_docs", `${sum.awaitingDocs} awaiting docs`, STAGE_STYLE.awaiting_docs],
            ["ready_to_prepare", `${sum.readyToPrepare} ready to prepare`, STAGE_STYLE.ready_to_prepare],
            ["prepared", `${sum.formsOutstanding} forms outstanding`, STAGE_STYLE.prepared],
          ].map(([key, label, cls]) => (
            <button key={key} onClick={() => setFilter(key as string)}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold ${filter === key ? "ring-2 ring-offset-1 ring-slate-400 " : ""}${cls}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <button onClick={runBatch} disabled={running}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50">
          {running ? "Working…" : "⚡ Run agent on all ready files"}
        </button>
        {msg && <span className="text-xs text-slate-600">{msg}</span>}
      </div>

      {loading && <p className="text-sm text-slate-400 py-8 text-center">Assessing every case…</p>}

      {!loading && (
        <div className="space-y-2">
          {cases.map((c) => (
            <div key={c.caseId} className="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-col gap-2">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-slate-500">{c.caseId}</span>
                    <span className="font-semibold text-slate-900 text-sm">{c.client || "—"}</span>
                    <span className="text-xs text-slate-400">{c.formType}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STAGE_STYLE[c.stage] || STAGE_STYLE.unknown}`}>{c.stageLabel || c.stage}</span>
                    {typeof c.permitDaysLeft === "number" && c.permitDaysLeft <= 30 && (
                      <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white">⏰ permit {c.permitDaysLeft}d</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-700 mt-1">{c.nextAction}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-slate-400">
                    <span>👤 {c.assignedTo}</span>
                    {c.formsMissing.length > 0 && <span>📄 forms to fill: {c.formsMissing.join(", ")}</span>}
                    {c.missingDocs.length > 0 && <span>📂 missing: {c.missingDocs.slice(0, 4).join(", ")}{c.missingDocs.length > 4 ? "…" : ""}</span>}
                  </div>
                </div>
                {c.autoDoable && (c.autoActionKey === "auto_prepare" || c.autoActionKey === "fill_forms") && (
                  <button onClick={() => runForCase(c.caseId, c.autoActionKey!)} disabled={busyCase === c.caseId}
                    className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                    {busyCase === c.caseId ? "…" : c.autoActionKey === "auto_prepare" ? "Assemble" : "Fill forms"}
                  </button>
                )}
              </div>
            </div>
          ))}
          {cases.length === 0 && <p className="text-sm text-slate-400 py-8 text-center">Nothing in this view. 🎉</p>}
        </div>
      )}
    </div>
  );
}
