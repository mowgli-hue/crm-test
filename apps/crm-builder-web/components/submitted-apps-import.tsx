import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

// Admin tool: upload the "Submitted applications" CSV so result-sharing can match
// a client's phone by IRCC application number even for older clients who aren't
// cases in the CRM. Idempotent — re-uploading an updated sheet just refreshes.
export default function SubmittedAppsImport() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string>("");

  const upload = async () => {
    setError(""); setResult("");
    if (!file) { setError("Choose the CSV file first."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiFetch("/admin/import-submitted-apps", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setResult(`✅ Imported ${d.imported} applications (${d.withPhone} with a phone). Skipped ${d.skipped} junk rows. Total in lookup: ${d.totalInTable}.`);
        setFile(null);
      } else {
        setError(d.error || "Import failed");
      }
    } catch (e) { setError(String(e)); }
    setBusy(false);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 bg-slate-900">
        <h2 className="text-base font-bold text-white">📥 Import submitted applications</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Upload your "Submitted applications" sheet (CSV). Lets you share a result/letter
          by application number and have the phone found automatically — even for older
          clients not in the CRM.
        </p>
      </div>
      <div className="p-5 space-y-3">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
        />
        <button
          onClick={upload}
          disabled={busy || !file}
          className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? "Importing…" : "Import CSV"}
        </button>
        {result && <p className="text-xs font-semibold text-emerald-700">{result}</p>}
        {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Expected columns (in order): Name, Application Type, Contact Number, Application
          Number. Re-uploading is safe — rows update by application number.
        </p>
      </div>
    </div>
  );
}
