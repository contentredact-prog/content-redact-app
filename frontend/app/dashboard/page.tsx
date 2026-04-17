"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  listWorks, getMatches, triggerScan, generateDMCA,
  deleteWork, updateMatchStatus, certificateUrl,
  type Work, type Match,
} from "@/lib/api";
import Link from "next/link";

// ── Stage indicator ──
function StageIndicator({ stage }: { stage: string }) {
  const stages: Record<string, { label: string; color: string; icon: string }> = {
    fingerprinted: { label: "Fingerprinted", color: "text-green-400", icon: "🛡" },
    transcribing: { label: "Transcribing...", color: "text-amber-400", icon: "📝" },
    scanning: { label: "Scanning web...", color: "text-blue-400", icon: "🔍" },
    monitoring: { label: "Monitoring", color: "text-green-400", icon: "📡" },
    failed: { label: "Error", color: "text-red-400", icon: "✗" },
  };
  const s = stages[stage] || stages.fingerprinted;
  const isActive = stage === "transcribing" || stage === "scanning";

  return (
    <div className="flex items-center gap-2">
      <span className={`text-[11px] ${s.color}`}>{s.icon}</span>
      <span className={`text-[11px] font-medium ${s.color}`}>{s.label}</span>
      {isActive && (
        <span className="inline-block w-3 h-3 border-2 border-white/10 border-t-amber-400 rounded-full animate-spin" />
      )}
    </div>
  );
}

// ── Status Badge ──
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    protected: "bg-green-950/60 text-green-400 border-green-900/50",
    processing: "bg-amber-950/60 text-amber-400 border-amber-900/50",
    pending: "bg-white/5 text-white/40 border-white/10",
    failed: "bg-red-950/60 text-red-400 border-red-900/50",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${map[status] || map.pending}`}>
      {status}
    </span>
  );
}

// ── Match Row ──
function MatchRow({ match, onDMCA, onStatusChange }: {
  match: Match;
  onDMCA: (url: string) => void;
  onStatusChange: (id: string, status: string) => void;
}) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-white/[0.04] last:border-0 gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-red-400/70 bg-red-950/40 px-1.5 py-0.5 rounded">
            {match.platform}
          </span>
          {match.confidence_score !== null && (
            <span className="text-[10px] text-white/20">{match.confidence_score}%</span>
          )}
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
            match.review_status === "confirmed_infringement" ? "bg-red-950/40 text-red-300" :
            match.review_status === "false_positive" ? "bg-white/5 text-white/25 line-through" :
            match.review_status === "authorized_use" ? "bg-green-950/40 text-green-300" :
            "bg-white/5 text-white/30"
          }`}>
            {match.review_status.replace(/_/g, " ")}
          </span>
        </div>
        <a href={match.match_url} target="_blank" rel="noopener noreferrer"
          className="text-[12px] text-white/50 hover:text-white/80 transition-colors truncate block break-all">
          {match.match_url}
        </a>
      </div>
      <div className="flex gap-1.5 shrink-0">
        {match.review_status === "pending" && (
          <>
            <button onClick={() => onStatusChange(match.id, "confirmed_infringement")}
              className="px-2 py-1 rounded text-[10px] bg-red-950/30 border border-red-900/30 text-red-300/70 hover:text-red-200 transition-all"
              title="Confirm infringement">✗</button>
            <button onClick={() => onStatusChange(match.id, "false_positive")}
              className="px-2 py-1 rounded text-[10px] bg-white/[0.03] border border-white/[0.06] text-white/30 hover:text-white/60 transition-all"
              title="False positive">✓</button>
          </>
        )}
        {match.review_status === "confirmed_infringement" && (
          <button onClick={() => onDMCA(match.match_url)}
            className="px-3 py-1.5 rounded text-[11px] font-semibold bg-red-950/40 border border-red-900/40 text-red-300 hover:bg-red-900/40 transition-all">
            DMCA
          </button>
        )}
      </div>
    </div>
  );
}

// ── Work Card ──
function WorkCard({ work, onRefresh }: { work: Work; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [dmcaNotice, setDmcaNotice] = useState<any>(null);

  const loadMatches = async () => {
    setLoadingMatches(true);
    try { setMatches(await getMatches(work.id)); } catch {}
    setLoadingMatches(false);
  };

  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) loadMatches();
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      await triggerScan(work.id);
      setTimeout(async () => {
        await loadMatches();
        onRefresh();
        setScanning(false);
      }, 12000);
    } catch { setScanning(false); }
  };

  const handleDMCA = async (url: string) => {
    try { setDmcaNotice(await generateDMCA(work.id, url)); } catch {}
  };

  const handleStatusChange = async (matchId: string, status: string) => {
    try { await updateMatchStatus(matchId, status); await loadMatches(); } catch {}
  };

  const handleDelete = async () => {
    if (!confirm("Delete this work and all associated data?")) return;
    try { await deleteWork(work.id); onRefresh(); } catch {}
  };

  const matchCount = work.matches_found || 0;
  const stage = (work as any).processing_stage || "fingerprinted";

  return (
    <>
      <div onClick={handleExpand}
        className="border border-white/[0.06] rounded-xl p-4 sm:p-5 bg-white/[0.01] hover:bg-white/[0.02] transition-all cursor-pointer">
        {/* Header */}
        <div className="flex justify-between items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-[13px] font-medium text-white/80 truncate">{work.title}</span>
              <StatusBadge status={work.processing_status} />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[11px] text-white/20">
                {work.media_type === "audio" ? "♫" : "▶"} {work.id.slice(0, 8)}
              </span>
              <StageIndicator stage={stage} />
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {matchCount > 0 && (
              <span className="text-[12px] font-bold text-red-400">
                {matchCount} match{matchCount !== 1 ? "es" : ""}
              </span>
            )}
            <span className={`text-white/20 text-[12px] transition-transform ${expanded ? "rotate-180" : ""}`}>▼</span>
          </div>
        </div>

        {/* Expanded */}
        {expanded && (
          <div className="mt-5 pt-5 border-t border-white/[0.04]" onClick={(e) => e.stopPropagation()}>
            {/* Stage pipeline visual */}
            <div className="mb-4 flex items-center gap-1 text-[10px]">
              {["fingerprinted", "transcribing", "scanning", "monitoring"].map((s, i) => (
                <div key={s} className="flex items-center gap-1">
                  <span className={`px-2 py-0.5 rounded ${
                    s === stage ? "bg-white/10 text-white/70 font-semibold" :
                    ["fingerprinted", "transcribing", "scanning", "monitoring"].indexOf(s) < ["fingerprinted", "transcribing", "scanning", "monitoring"].indexOf(stage) ? "text-green-400/50" :
                    "text-white/15"
                  }`}>{s}</span>
                  {i < 3 && <span className="text-white/10">→</span>}
                </div>
              ))}
            </div>

            {/* Transcript */}
            {work.transcript && (
              <div className="mb-4">
                <div className="text-[10px] text-white/20 uppercase tracking-widest mb-2">Transcript</div>
                <p className="text-[11px] text-white/30 leading-relaxed bg-white/[0.02] rounded p-3 border border-white/[0.04]">
                  {work.transcript.slice(0, 200)}{work.transcript.length > 200 ? "..." : ""}
                </p>
              </div>
            )}
            {stage === "transcribing" && (
              <div className="mb-4 text-[11px] text-amber-400/50">Transcript is being generated in the background...</div>
            )}

            {/* Hash */}
            {work.original_hash && (
              <div className="mb-4">
                <div className="text-[10px] text-white/20 uppercase tracking-widest mb-1.5">SHA-256</div>
                <code className="text-[10px] text-white/25 font-mono break-all">{work.original_hash}</code>
              </div>
            )}

            {/* Matches */}
            {matches.length > 0 && (
              <div className="mb-4">
                <div className="text-[10px] text-white/20 uppercase tracking-widest mb-2">Matches ({matches.length})</div>
                {loadingMatches ? (
                  <div className="text-[11px] text-white/20 py-2">Loading...</div>
                ) : (
                  matches.map((m) => (
                    <MatchRow key={m.id} match={m} onDMCA={handleDMCA} onStatusChange={handleStatusChange} />
                  ))
                )}
              </div>
            )}
            {matches.length === 0 && !loadingMatches && stage === "monitoring" && (
              <div className="mb-4 text-[11px] text-white/15">No matches found. Actively monitoring.</div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 mt-2">
              <a href={certificateUrl(work.id)} target="_blank" rel="noopener noreferrer">
                <button className="px-3 py-2 rounded-lg text-[11px] font-medium bg-white/[0.03] border border-white/[0.08] text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition-all">
                  📄 Certificate
                </button>
              </a>
              {stage === "monitoring" && (
                <button onClick={handleScan} disabled={scanning}
                  className="px-3 py-2 rounded-lg text-[11px] font-medium bg-white/[0.03] border border-white/[0.08] text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition-all disabled:opacity-30">
                  {scanning ? "Scanning..." : "🔍 Re-scan"}
                </button>
              )}
              <button onClick={handleDelete}
                className="px-3 py-2 rounded-lg text-[11px] font-medium text-red-400/40 hover:text-red-400 hover:bg-red-950/30 transition-all ml-auto">
                Delete
              </button>
            </div>
          </div>
        )}
      </div>

      {/* DMCA Modal */}
      {dmcaNotice && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setDmcaNotice(null)}>
          <div className="bg-[#0a0a0f] border border-white/[0.08] rounded-xl w-full max-w-xl max-h-[80vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-[14px] font-bold text-white/90">DMCA Takedown Notice</h3>
              <button onClick={() => setDmcaNotice(null)} className="text-white/20 hover:text-white/50 text-lg">×</button>
            </div>
            <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-900/30 mb-4">
              <p className="text-[11px] text-amber-300/80 leading-relaxed">{dmcaNotice.fair_use_warning}</p>
            </div>
            <pre className="text-[11px] text-white/50 whitespace-pre-wrap font-mono bg-white/[0.02] rounded-lg p-4 border border-white/[0.04] mb-4 leading-relaxed">
              {dmcaNotice.notice_text}
            </pre>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => navigator.clipboard.writeText(dmcaNotice.notice_text)}
                className="px-4 py-2 rounded-lg text-[12px] font-semibold bg-white/10 text-white/80 hover:bg-white/15 transition-all">
                Copy Notice
              </button>
              {dmcaNotice.submission_links && Object.entries(dmcaNotice.submission_links).map(([p, url]) => (
                <a key={p} href={url as string} target="_blank" rel="noopener noreferrer">
                  <button className="px-3 py-2 rounded-lg text-[11px] font-medium bg-white/[0.03] border border-white/[0.06] text-white/30 hover:text-white/60 transition-all capitalize">
                    Submit → {p}
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
    try { setWorks(await listWorks()); } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!authorized) return;
    fetchWorks();
    const interval = setInterval(fetchWorks, 8000);
    return () => clearInterval(interval);
  }, [authorized, fetchWorks]);

  const totalMatches = works.reduce((s, w) => s + (w.matches_found || 0), 0);
  const protectedCount = works.filter((w) => w.processing_status === "protected").length;

  if (!authorized) {
    return <div className="min-h-screen flex items-center justify-center bg-black text-white/30 text-sm">Verifying session...</div>;
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div className="flex justify-between items-end mb-8">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight mb-1">Dashboard</h1>
            <p className="text-[12px] text-white/25">Protected works &amp; detected matches</p>
          </div>
          <Link href="/upload">
            <button className="px-4 py-2 rounded-lg text-[12px] font-semibold bg-red-600 text-white hover:bg-red-500 transition-all">
              + Upload
            </button>
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-8">
          {[
            { label: "Works", value: works.length, color: "text-white/60" },
            { label: "Protected", value: protectedCount, color: "text-green-400" },
            { label: "Matches", value: totalMatches, color: totalMatches > 0 ? "text-red-400" : "text-white/20" },
          ].map((s) => (
            <div key={s.label} className="p-3 sm:p-4 rounded-xl bg-white/[0.02] border border-white/[0.05]">
              <div className="text-[10px] text-white/20 uppercase tracking-widest mb-1">{s.label}</div>
              <div className={`text-xl sm:text-2xl font-bold ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Works */}
        {loading ? (
          <div className="text-center py-20 text-white/20 text-sm">Loading...</div>
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
            {works.map((w) => <WorkCard key={w.id} work={w} onRefresh={fetchWorks} />)}
          </div>
        )}
      </div>
    </main>
  );
}