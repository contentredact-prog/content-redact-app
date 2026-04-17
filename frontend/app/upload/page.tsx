"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import Link from "next/link";

type UploadState = "idle" | "uploading" | "processing" | "done" | "error";

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [authorized, setAuthorized] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [workId, setWorkId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Auth gate
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.push("/login");
      else setAuthorized(true);
    });
  }, [router]);

  const ACCEPTED = ["video/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp3"];
  const MAX_SIZE = 500 * 1024 * 1024; // 500MB

  const validateFile = (f: File): string | null => {
    if (!ACCEPTED.includes(f.type)) return "Unsupported format. Use MP4, MP3, or WAV.";
    if (f.size > MAX_SIZE) return "File too large. Max 500MB.";
    return null;
  };

  const handleFileSelect = (f: File) => {
    const err = validateFile(f);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setFile(f);
    setState("idle");
    setWorkId(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setState("uploading");
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const owner = session?.user?.email || "Unknown";

      setState("uploading");
      const result = await api.uploadFile(file, owner);
      setWorkId(result.work_id);
      setState("processing");

      // Poll until protected
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const work = await api.getWork(result.work_id);
          if (work.status === "protected") {
            clearInterval(poll);
            setState("done");
          } else if (work.status === "error") {
            clearInterval(poll);
            setState("error");
            setError(work.error || "Processing failed");
          }
        } catch {
          // API might be slow, keep polling
        }
        if (attempts > 120) { // 10 min timeout
          clearInterval(poll);
          setState("error");
          setError("Processing timed out. Check dashboard for status.");
        }
      }, 5000);
    } catch (e: any) {
      setState("error");
      setError(e.message || "Upload failed");
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!authorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white/30 text-sm">
        Verifying session...
      </div>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-black text-white">
      <div className="w-full max-w-lg">
        <h1 className="text-3xl font-bold mb-2 tracking-tight">Protect Your Content</h1>
        <p className="text-sm text-white/30 mb-8">
          Upload audio or video. We'll fingerprint it, transcribe it, and scan for theft.
        </p>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`
            relative border-2 border-dashed rounded-xl p-12 text-center cursor-pointer
            transition-all duration-200
            ${dragOver
              ? "border-red-500/60 bg-red-950/20"
              : file
                ? "border-white/10 bg-white/[0.02]"
                : "border-white/[0.08] bg-white/[0.01] hover:border-white/15 hover:bg-white/[0.03]"
            }
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp4,.mp3,.wav"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileSelect(f);
            }}
          />

          {file ? (
            <div>
              <div className="text-[13px] font-medium text-white/80 mb-1 truncate">{file.name}</div>
              <div className="text-[11px] text-white/30">
                {file.type.includes("video") ? "Video" : "Audio"} &middot; {formatSize(file.size)}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setFile(null); setState("idle"); }}
                className="mt-3 text-[11px] text-white/20 hover:text-red-400 transition-colors"
              >
                Remove
              </button>
            </div>
          ) : (
            <div>
              <div className="text-2xl mb-3 text-white/20">↑</div>
              <div className="text-[13px] text-white/40 mb-1">Drop a file here or click to browse</div>
              <div className="text-[11px] text-white/20">MP4, MP3, WAV &middot; Max 500MB</div>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-950/40 border border-red-900/40 text-[13px] text-red-300">
            {error}
          </div>
        )}

        {/* Upload button */}
        {file && state === "idle" && (
          <button
            onClick={handleUpload}
            className="mt-6 w-full bg-red-600 text-white py-3.5 rounded-lg font-semibold text-[14px] hover:bg-red-500 transition-all shadow-[0_0_20px_rgba(220,38,38,0.2)]"
          >
            Upload &amp; Protect
          </button>
        )}

        {/* Progress states */}
        {(state === "uploading" || state === "processing") && (
          <div className="mt-6 p-5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-white/20 border-t-red-500 rounded-full animate-spin" />
              <div>
                <div className="text-[13px] font-medium text-white/80">
                  {state === "uploading" ? "Uploading..." : "Processing..."}
                </div>
                <div className="text-[11px] text-white/30 mt-0.5">
                  {state === "uploading"
                    ? "Sending file to server"
                    : "Hashing → Fingerprinting → Transcribing → Scanning"
                  }
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Success */}
        {state === "done" && workId && (
          <div className="mt-6 p-5 rounded-xl bg-green-950/30 border border-green-900/30">
            <div className="text-[13px] font-semibold text-green-400 mb-1">
              ✓ Protection Complete
            </div>
            <div className="text-[11px] text-green-300/50 mb-4">
              Your content has been fingerprinted, transcribed, and scanned.
            </div>
            <div className="flex gap-3">
              <Link href="/dashboard" className="flex-1">
                <button className="w-full py-2.5 rounded-lg bg-white/5 border border-white/10 text-[13px] font-medium text-white/70 hover:bg-white/10 hover:text-white transition-all">
                  View Dashboard
                </button>
              </Link>
              <a href={api.downloadUrl(workId)} className="flex-1">
                <button className="w-full py-2.5 rounded-lg bg-white/5 border border-white/10 text-[13px] font-medium text-white/70 hover:bg-white/10 hover:text-white transition-all">
                  ↓ Download Protected
                </button>
              </a>
            </div>
            <div className="mt-3 text-[10px] text-white/20 text-center">
              Download is one-time only. Files are not stored — only fingerprints.
            </div>
          </div>
        )}

        {/* Dashboard link */}
        <div className="mt-10 text-center">
          <Link href="/dashboard" className="text-[12px] text-white/20 hover:text-white/40 transition-colors">
            Go to Dashboard →
          </Link>
        </div>
      </div>
    </main>
  );
}