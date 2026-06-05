import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

type Item = { id: string; caseId: string; client: string; text: string; reviewer: string; status: string; createdAt: string };

// Persistent "review items for you" panel — the reliable channel: whenever a
// preparer or reviewer logs in, they see exactly what review changes need their
// action, without depending on catching a transient notification.
export default function ReviewItemsPanel({ onOpenCase }: { onOpenCase?: (caseId: string) => void }) {
  const [toFix, setToFix] = useState<Item[]>([]);
  const [toVerify, setToVerify] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    try {
      const res = await apiFetch("/review-inbox");
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setToFix(d.toFix || []); setToVerify(d.toVerify || []); }
    } catch { /* ignore */ }
    setLoaded(true);
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 60000); // refresh each minute
    return () => clearInterval(t);
  }, []);

  if (!loaded || (toFix.length === 0 && toVerify.length === 0)) return null;

  const Row = ({ it, kind }: { it: Item; kind: "fix" | "verify" }) => (
    <li
      onClick={() => onOpenCase?.(it.caseId)}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${onOpenCase ? "cursor-pointer hover:bg-white" : ""} ${kind === "fix" ? "border-rose-200 bg-rose-50/60" : "border-amber-200 bg-amber-50/60"}`}
    >
      <span className="text-sm">{kind === "fix" ? "🔴" : "⏳"}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-800 truncate">{it.client} <span className="text-slate-400 font-normal">· {it.caseId}</span></p>
        <p className="text-xs text-slate-600 truncate">{it.text}</p>
        <p className="text-[10px] text-slate-400">by {it.reviewer} · {new Date(it.createdAt).toLocaleDateString()}</p>
      </div>
    </li>
  );

  return (
    <div className="rounded-2xl border-2 border-rose-200 bg-rose-50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-bold text-rose-900">🔍 Review items for you</h3>
        <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white">{toFix.length + toVerify.length}</span>
      </div>

      {toFix.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-rose-800 mb-1">Changes to fix on your cases ({toFix.length})</p>
          <ul className="space-y-1.5">{toFix.map((it) => <Row key={it.id} it={it} kind="fix" />)}</ul>
        </div>
      )}

      {toVerify.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-amber-800 mb-1">Marked done — verify &amp; close ({toVerify.length})</p>
          <ul className="space-y-1.5">{toVerify.map((it) => <Row key={it.id} it={it} kind="verify" />)}</ul>
        </div>
      )}

      <p className="text-[10px] text-rose-700/70">Click an item to open the case. This updates automatically.</p>
    </div>
  );
}
