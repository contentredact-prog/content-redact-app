const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface Work {
  id: string;
  title: string;
  media_type: "audio" | "video";
  owner: string;
  status: "processing" | "protected" | "error";
  protections_applied: string[];
  matches_found: number;
  original_hash?: string;
  fingerprint?: Record<string, any>;
  transcript?: string;
  transcript_preview?: string;
  protected_at?: string;
  created_at: string;
  error?: string;
  matches?: Match[];
}

export interface Match {
  id: string;
  work_id: string;
  platform: string;
  url: string;
  description: string;
  confidence: string;
  action_status: string;
  found_at: string;
}

export const api = {
  async listWorks(): Promise<Work[]> {
    const res = await fetch(`${API_BASE}/api/v1/works`);
    if (!res.ok) throw new Error("Failed to fetch works");
    return res.json();
  },

  async getWork(id: string): Promise<Work> {
    const res = await fetch(`${API_BASE}/api/v1/works/${id}`);
    if (!res.ok) throw new Error("Work not found");
    return res.json();
  },

  async uploadFile(file: File, owner: string): Promise<{ work_id: string; status: string }> {
    const form = new FormData();
    form.append("file", file);
    form.append("owner", owner);
    const res = await fetch(`${API_BASE}/api/v1/works/protect`, { method: "POST", body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Upload failed" }));
      throw new Error(err.detail || "Upload failed");
    }
    return res.json();
  },

  async getMatches(workId: string): Promise<Match[]> {
    const res = await fetch(`${API_BASE}/api/v1/works/${workId}/matches`);
    if (!res.ok) throw new Error("Failed to fetch matches");
    return res.json();
  },

  async triggerScan(workId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/v1/works/${workId}/scan`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Scan failed" }));
      throw new Error(err.detail);
    }
  },

  async generateDMCA(workId: string, infringingUrl: string): Promise<any> {
    const res = await fetch(
      `${API_BASE}/api/v1/works/${workId}/generate-dmca?infringing_url=${encodeURIComponent(infringingUrl)}`,
      { method: "POST" }
    );
    if (!res.ok) throw new Error("DMCA generation failed");
    return res.json();
  },

  async deleteWork(workId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/v1/works/${workId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Delete failed");
  },

  downloadUrl(workId: string): string {
    return `${API_BASE}/api/v1/works/${workId}/download`;
  },

  certificateUrl(workId: string): string {
    return `${API_BASE}/api/v1/works/${workId}/certificate`;
  },
};