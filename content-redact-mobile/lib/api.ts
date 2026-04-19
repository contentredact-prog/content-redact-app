import { supabase } from "./supabase";

// UPDATE THIS to your Render backend URL
const API_BASE = "https://your-render-backend.onrender.com";

// ── Types ──
export interface Work {
  id: string;
  user_id: string;
  title: string;
  media_type: "audio" | "video";
  owner_name: string;
  processing_status: string;
  processing_stage?: string;
  original_hash?: string;
  transcript?: string;
  protected_at?: string;
  created_at: string;
  matches_found?: number;
}

export interface Match {
  id: string;
  work_id: string;
  platform: string;
  match_url: string;
  confidence_score: number | null;
  match_evidence: any;
  review_status: string;
  created_at: string;
}

export interface UploadResult {
  work_id: string;
  status: string;
  message: string;
  download_url: string | null;
}

// ── Auth helper ──
async function getAuthHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = {};
  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }
  return headers;
}

// ── Supabase reads ──

export async function listWorks(): Promise<Work[]> {
  const { data, error } = await supabase
    .from("protected_works")
    .select("*, discovered_matches(count)")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (data || []).map((w: any) => ({
    ...w,
    matches_found: w.discovered_matches?.[0]?.count || 0,
  }));
}

export async function getWork(workId: string): Promise<Work> {
  const { data, error } = await supabase
    .from("protected_works")
    .select("*")
    .eq("id", workId)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function getMatches(workId: string): Promise<Match[]> {
  const { data, error } = await supabase
    .from("discovered_matches")
    .select("*")
    .eq("work_id", workId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function updateMatchStatus(
  matchId: string,
  status: string
): Promise<void> {
  const { error } = await supabase
    .from("discovered_matches")
    .update({ review_status: status })
    .eq("id", matchId);

  if (error) throw new Error(error.message);
}

export async function deleteWork(workId: string): Promise<void> {
  const { error } = await supabase
    .from("protected_works")
    .delete()
    .eq("id", workId);

  if (error) throw new Error(error.message);
}

// ── Backend API calls ──

export async function uploadFile(
  fileUri: string,
  fileName: string,
  mimeType: string,
  owner: string
): Promise<UploadResult> {
  const headers = await getAuthHeaders();

  const form = new FormData();
  form.append("file", {
    uri: fileUri,
    name: fileName,
    type: mimeType,
  } as any);
  form.append("owner", owner);

  const res = await fetch(`${API_BASE}/api/v1/works/protect`, {
    method: "POST",
    headers,
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
}

export async function getDownloadLink(
  workId: string
): Promise<{ download_url: string; expires_in_seconds: number }> {
  const headers = await getAuthHeaders();
  const res = await fetch(
    `${API_BASE}/api/v1/works/${workId}/download-link`,
    { headers }
  );

  if (res.status === 410)
    throw new Error("File expired. Only fingerprints retained.");
  if (!res.ok) throw new Error("Failed to get download link");
  return res.json();
}

export async function triggerScan(workId: string): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/api/v1/works/${workId}/scan`, {
    method: "POST",
    headers,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Scan failed" }));
    throw new Error(err.detail);
  }
}

export async function generateDMCA(
  workId: string,
  infringingUrl: string
): Promise<any> {
  const headers = await getAuthHeaders();
  const res = await fetch(
    `${API_BASE}/api/v1/works/${workId}/generate-dmca?infringing_url=${encodeURIComponent(infringingUrl)}`,
    { method: "POST", headers }
  );

  if (!res.ok) throw new Error("DMCA generation failed");
  return res.json();
}

export function certificateUrl(workId: string): string {
  return `${API_BASE}/api/v1/works/${workId}/certificate`;
}