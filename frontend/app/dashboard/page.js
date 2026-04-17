"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { api, Work, Match } from "@/lib/api";
import Link from "next/link";

// ── Status badge ──
function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    protected: "bg-green-950/60 text-green-400 border-green-900/50",
    processing: "bg-amber-950/60 text-amber-400 border-amber-900/50",
    error: "bg-red-950/60 text-red-400 border-red-900/50",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${styles[status] || styles.processing}`}>
      {status}
    </span>
  );
}

// ── Protection tag ──
function ProtectionTag({ name }: { name: string }) {
  const icons: Record<string, string> = {
    audio_fingerprint: "🔊",
    video_fingerprint: "🎬",
    metadata_embedded: "🏷",
    ai_transcript: "📝",
  };
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-white/[0.03] border border-white/[0.06] text-white/40">
      {icons[name] || "✓"} {name.replace(/_/g, " ")}
    </span>
  );
}

// ── Match row ──
function MatchRow({ match, onDMCA }: { match: Match; onDMCA: (url: string) => void }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/[0.04] last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-red-400/70 bg-red-950/40 px-1.5 py-0.5 rounded">
            {match.platform}
          </span>
          <span className="text-[10px] text-white/20">{match.confidence} confidence</span>
        </div>
        <a
          href={match.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12px] text-white/50 hover:text-white/80 transition-colors truncate block"
        >
          {match.url}
        </a>
        {match.description && (
          <p className="text-[11px] text-white/20 mt-1 truncate">{match.description}</p>
        )}
      </div>
      <button
        onClick={() => onDMCA(match.url)}
        className="ml-4 shrink-0 px-3 py-1.5 rounded text-[11px] font-semibold bg-red-950/40 border border-red-900/40 text-red-300 hover:bg-red-900/40 hover:text-red-200 transition-all"
      >
        DMCA
      </button>
    </div>
  );
}

// ── Work card ──
function WorkCard({ work, onRefresh }: { work: Work; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [dmcaNotice, setDmcaNotice] = useState<any>(null);

  const loadMatches = async () => {
    setLoadingMatches(true);
    try {
      const m = await api.getMatches(work.id);
      setMatches(m);
    } catch { }
    setLoadingMatches(false);
  };

  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && matches.length === 0 && work.matches_found > 0) {
      loadMatches();
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      await api.triggerScan(work.id);
      // Poll briefly for new results
      setTimeout(async () => {
        await loadMatches();
        onRefresh();
        setScanning(false);
      }, 10000);
    } catch {
      setScanning(false);
    }
  };

  const handleDMCA = async (url: string) => {
    try {
      const notice = await api.generateDMCA(work.id, url);
      setDmcaNotice(notice);
    } catch { }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this work? This removes all records permanently.")) return;
    try {
      await api.deleteWork(work.id);
      onRefresh();
    } catch { }
  };

  return (
    <>
      <div
        onClick={handleExpand}
        className="border border-white/[0.06] rounded-xl p-5 bg-white/[0.01] hover:bg-white/[0.02] transition-all cursor-pointer"
      >
        {/* Header */}
        <div className="flex justify-between items-start">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 mb-1.5">
              <span className="text-[13px] font-medium text-white/80 truncate">{work.title}</span>
              <StatusBadge status={work.status} />
            </div>
            <div className="text-[11px] text-white/20">
              {work.media_type === "audio" ? "♫ Audio" : "▶ Video"}
              {" · "}ID: {work.id.slice(0, 8)}
              {work.created_at && <> · {new Date(work.created_at).toLocaleDateString()}</>}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {work.matches_found > 0 && (
              <span className="text-[12px] font-bold text-red-400">
                {work.matches_found} match{work.matches_found !== 1 ? "es" : ""}
              </span>
            )}
            <span className={`text-white/20 text-[12px] transition-transform ${expanded ? "rotate-180" : ""}`}>
              ▼
            </span>
          </div>
        </div>

        {/* Expanded */}
        {expanded && (
          <div className="mt-5 pt-5 border-t border-white/[0.04]" onClick={(e) => e.stopPropagation()}>
            {/* Protections */}
            {work.protections_applied?.length > 0 && (
              <div className="mb-4">
                <div className="text-[10px] text-white/20 uppercase tracking-widest mb-2">Protections</div>
                <div className="flex flex-wrap gap-1.5">
                  {work.protections_applied.map((p) => <ProtectionTag key={p} name={p} />)}
                </div>
              </div>
            )}

            {/* Transcript preview */}
            {(work.transcript_preview || work.transcript) && (
              <div className="mb-4">
                <div className="text-[10px] text-white/20 uppercase tracking-widest mb-2">Transcript</div>
                <p className="text-[11px] text-white/30 leading-relaxed bg-white/[0.02] rounded p-3 border border-white/[0.04]">
                  {work.transcript_preview || (work.transcript || "").slice(0, 120) + "..."}
                </p>
              </div>
            )}

            {/* Hash */}
            {work.original_hash && (
              <div className="mb-4">
                <div className="text-[10px] text-white/20 uppercase tracking-widest mb-1.5">SHA-256</div>
                <code className="text-[10px] text-white/25 font-mono break-all">{work.original_hash}</code>
              </div>
            )}

            {/* Matches */}
            {work.matches_found > 0 && (
              <div className="mb-4">
                <div className="text-[10px] text-white/20 uppercase tracking-widest mb-2">
                  Matches ({work.matches_found})
                </div>
                {loadingMatches ? (
                  <div className="text-[11px] text-white/20 py-2">Loading matches...</div>
                ) : (
                  matches.map((m) => <MatchRow key={m.id} match={m} onDMCA={handleDMCA} />)
                )}
              </div>
            )}

            {/* Actions */}
            {work.status === "protected" && (
              <div className="flex flex-wrap gap-2 mt-2">
                <a href={api.certificateUrl(work.id)} target="_blank" rel="noopener noreferrer">
                  <button className="px-3 py-2 rounded-lg text-[11px] font-medium bg-white/[0.03] border border-white/[0.08] text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition-all">
                    📄 Certificate
                  </button>
                </a>
                <a href={api.downloadUrl(work.id)}>
                  <button className="px-3 py-2 rounded-lg text-[11px] font-medium bg-white/[0.03] border border-white/[0.08] text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition-all">
                    ↓ Download
                  </button>
                </a>
                <button
                  onClick={handleScan}
                  disabled={scanning}
                  className="px-3 py-2 rounded-lg text-[11px] font-medium bg-white/[0.03] border border-white/[0.08] text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition-all disabled:opacity-30"
                >
                  {scanning ? "Scanning..." : "🔍 Re-scan"}
                </button>
                <button
                  onClick={handleDelete}
                  className="px-3 py-2 rounded-lg text-[11px] font-medium text-red-400/40 hover:text-red-400 hover:bg-red-950/30 transition-all ml-auto"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* DMCA Modal */}
      {dmcaNotice && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setDmcaNotice(null)}
        >
          <div
            className="bg-[#0a0a0f] border border-white/[0.08] rounded-xl w-full max-w-xl max-h-[80vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-[14px] font-bold text-white/90">DMCA Takedown Notice</h3>
              <button onClick={() => setDmcaNotice(null)} className="text-white/20 hover:text-white/50 text-lg">×</button>
            </div>

            {/* Warning */}
            <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-900/30 mb-4">
              <p className="text-[11px] text-amber-300/80 leading-relaxed">
                {dmcaNotice.fair_use_warning}
              </p>
            </div>

            {/* Notice text */}
            <pre className="text-[11px] text-white/50 whitespace-pre-wrap font-mono bg-white/[0.02] rounded-lg p-4 border border-white/[0.04] mb-4 leading-relaxed">
              {dmcaNotice.notice_text}
            </pre>

            {/* Copy + submission links */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(dmcaNotice.notice_text);
                }}
                className="px-4 py-2 rounded-lg text-[12px] font-semibold bg-white/10 text-white/80 hover:bg-white/15 transition-all"
              >
                Copy Notice
              </button>
              {dmcaNotice.submission_links && Object.entries(dmcaNotice.submission_links).map(([platform, url]) => (
                <a key={platform} href={url as string} target="_blank" rel="noopener noreferrer">
                  <button className="px-3 py-2 rounded-lg text-[11px] font-medium bg-white/[0.03] border border-white/[0.06] text-white/30 hover:text-white/60 transition-all capitalize">
                    Submit → {platform}
                  </button>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Main Dashboard ──
export default function DashboardPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [works, setWorks] = useState<Work[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.push("/login");
      else setAuthorized(true);
    });
  }, [router]);

  const fetchWorks = useCallback(async () => {
    try {
      const data = await api.listWorks();
      setWorks(data);
    } catch { }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!authorized) return;
    fetchWorks();
    const interval = setInterval(fetchWorks, 8000);
    return () => clearInterval(interval);
  }, [authorized, fetchWorks]);

  const totalMatches = works.reduce((sum, w) => sum + (w.matches_found || 0), 0);
  const protectedCount = works.filter((w) => w.status === "protected").length;

  if (!authorized) {
    return <div className="min-h-screen flex items-center justify-center bg-black text-white/30 text-sm">Verifying session...</div>;
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex justify-between items-end mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight mb-1">Dashboard</h1>
            <p className="text-[12px] text-white/25">Your protected works and detected matches</p>
          </div>
          <Link href="/upload">
            <button className="px-4 py-2 rounded-lg text-[12px] font-semibold bg-red-600 text-white hover:bg-red-500 transition-all">
              + Upload
            </button>
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          {[
            { label: "Total Works", value: works.length, color: "text-white/60" },
            { label: "Protected", value: protectedCount, color: "text-green-400" },
            { label: "Matches Found", value: totalMatches, color: totalMatches > 0 ? "text-red-400" : "text-white/20" },
          ].map((s) => (
            <div key={s.label} className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05]">
              <div className="text-[10px] text-white/20 uppercase tracking-widest mb-1.5">{s.label}</div>
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Works list */}
        {loading ? (
          <div className="text-center py-20 text-white/20 text-sm">Loading works...</div>
        ) : works.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-white/10 text-4xl mb-4">↑</div>
            <div className="text-white/25 text-sm mb-2">No works yet</div>
            <Link href="/upload" className="text-[12px] text-red-400/60 hover:text-red-400 transition-colors">
              Upload your first file →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {works.map((w) => (
              <WorkCard key={w.id} work={w} onRefresh={fetchWorks} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}