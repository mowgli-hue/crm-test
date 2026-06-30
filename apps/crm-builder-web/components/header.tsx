import { Building2, Sparkles } from "lucide-react";

type HeaderProps = {
  appName?: string;
  logoText?: string;
  logoUrl?: string;
  subtitle?: string;
  primary?: string;
  secondary?: string;
  success?: string;
  text?: string;
};

export function Header({
  appName = "Newton Agent",
  logoText = "Newton Immigration",
  logoUrl = "",
  subtitle = "Build custom pipelines for immigration, legal, healthcare, consulting, or any operations-heavy business.",
  primary = "#1E3A8A",
  secondary = "#6366F1",
  success = "#10B981",
  text = "#F8FAFC"
}: HeaderProps) {
  return (
    <header
      className="rounded-2xl border px-6 py-6 text-white shadow-soft"
      style={{
        borderColor: `${secondary}66`,
        color: text,
        background: `linear-gradient(120deg, ${primary}, ${secondary}, ${success})`
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {logoUrl ? (
            <img src={logoUrl} alt={`${appName} logo`} className="h-14 w-14 rounded-lg border border-white/30 bg-white object-cover p-1" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-white/30 bg-white/15 text-lg font-semibold">
              {(appName || "C").trim().charAt(0).toUpperCase()}
            </div>
          )}
          <div>
          <p className="text-xs uppercase tracking-[0.18em]">{logoText}</p>
          <h1 className="mt-2 text-3xl font-semibold">{appName}</h1>
          <p className="mt-2 max-w-3xl text-sm">{subtitle}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
            <Building2 size={14} /> Multi-company
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
            <Sparkles size={14} /> AI-assisted
          </span>
        </div>
      </div>
    </header>
  );
}
