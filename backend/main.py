"""
Content Redact App — Backend API v2.0
=====================================
Lightweight architecture: processes uploads, extracts proofs
(hash, fingerprint, transcript), then DELETES the original files.
Only evidence is stored — no file hosting costs.

Run:  uvicorn main:app --reload --port 8000

Env vars:
  GOOGLE_API_KEY   — Gemini for transcription
  APIFY_API_TOKEN  — Apify for TikTok sweeps
  LIVE_SCANNING    — "true" to enable scheduled scans (costs API credits)
"""

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from datetime import datetime, timezone
from contextlib import asynccontextmanager
import shutil
import uuid
import json
import subprocess
import hashlib
import os
import sqlite3
import time
import platform
from pathlib import Path
from typing import Optional

from mutagen.mp3 import MP3
from mutagen.id3 import TCOP, TXXX
from mutagen.wave import WAVE
from google import genai
from apify_client import ApifyClient
from apscheduler.schedulers.background import BackgroundScheduler

# ============================================================
# CONFIG
# ============================================================
DB_FILE = "content_redact.db"
UPLOAD_DIR = Path("./uploads")
CERTS_DIR = Path("./certificates")

for d in [UPLOAD_DIR, CERTS_DIR]:
    d.mkdir(exist_ok=True)

FPCALC_BIN = "fpcalc.exe" if platform.system() == "Windows" else "fpcalc"

GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")
APIFY_TOKEN = os.environ.get("APIFY_API_TOKEN")
LIVE_SCANNING = os.environ.get("LIVE_SCANNING", "false").lower() == "true"

# ============================================================
# EXTERNAL CLIENTS
# ============================================================
ai_client = None
if GOOGLE_API_KEY:
    try:
        ai_client = genai.Client(api_key=GOOGLE_API_KEY)
        print("[Init] Gemini AI client ready")
    except Exception as e:
        print(f"[Init] Gemini client failed: {e}")

apify_client = None
if APIFY_TOKEN:
    apify_client = ApifyClient(APIFY_TOKEN)
    print("[Init] Apify client ready")

# ============================================================
# DATABASE
# ============================================================
def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS works (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS matches (
                id TEXT PRIMARY KEY,
                work_id TEXT NOT NULL,
                platform TEXT,
                url TEXT NOT NULL,
                description TEXT,
                confidence TEXT DEFAULT 'medium',
                action_status TEXT DEFAULT 'pending',
                found_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE
            )
        """)
        conn.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_match_url
            ON matches(work_id, url)
        """)

init_db()


def db_get_work(work_id: str) -> Optional[dict]:
    with get_db() as conn:
        row = conn.execute("SELECT data FROM works WHERE id = ?", (work_id,)).fetchone()
        return json.loads(row[0]) if row else None


def db_save_work(work_id: str, work_data: dict):
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO works (id, data, created_at) VALUES (?, ?, ?)",
            (work_id, json.dumps(work_data), work_data.get("created_at", datetime.now(timezone.utc).isoformat()))
        )


def db_get_all_works() -> list:
    with get_db() as conn:
        rows = conn.execute("SELECT data FROM works ORDER BY created_at DESC").fetchall()
        return [json.loads(row[0]) for row in rows]


def db_delete_work(work_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM matches WHERE work_id = ?", (work_id,))
        conn.execute("DELETE FROM works WHERE id = ?", (work_id,))


def db_save_match(match: dict):
    with get_db() as conn:
        conn.execute(
            """INSERT OR IGNORE INTO matches
               (id, work_id, platform, url, description, confidence, action_status, found_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                match.get("id", str(uuid.uuid4())),
                match["work_id"],
                match.get("platform", "unknown"),
                match["url"],
                match.get("description", ""),
                match.get("confidence", "medium"),
                match.get("action_status", "pending"),
                match.get("found_at", datetime.now(timezone.utc).isoformat()),
            )
        )


def db_get_matches(work_id: str) -> list:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, work_id, platform, url, description, confidence, action_status, found_at "
            "FROM matches WHERE work_id = ? ORDER BY found_at DESC",
            (work_id,)
        ).fetchall()
        return [dict(row) for row in rows]


def db_match_count(work_id: str) -> int:
    with get_db() as conn:
        row = conn.execute("SELECT COUNT(*) FROM matches WHERE work_id = ?", (work_id,)).fetchone()
        return row[0] if row else 0


# ============================================================
# AI TRANSCRIPTION
# ============================================================
def transcribe_media(filepath: str) -> Optional[str]:
    if not ai_client:
        print("[AI] No Gemini client — skipping transcription")
        return None
    try:
        print(f"[AI] Uploading {Path(filepath).name}...")
        media_file = ai_client.files.upload(file=filepath)

        retries = 0
        while "PROCESSING" in str(media_file.state) and retries < 30:
            time.sleep(5)
            media_file = ai_client.files.get(name=media_file.name)
            retries += 1

        if "FAILED" in str(media_file.state):
            print("[AI] Google processing failed")
            return None

        response = ai_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                media_file,
                "Transcribe the audio in this file verbatim. Return only the transcript, nothing else."
            ]
        )
        transcript = response.text.strip()
        print(f"[AI] Transcript: {len(transcript)} chars")
        return transcript

    except Exception as e:
        print(f"[AI] Error: {e}")
        return None


# ============================================================
# TIKTOK SCANNING
# ============================================================
def extract_anchor_phrases(transcript: str, count: int = 3) -> list[str]:
    words = transcript.split()
    total = len(words)
    if total < 8:
        return [transcript]

    phrases = []
    phrases.append(" ".join(words[:min(15, total)]))
    if total > 30:
        mid = total // 2
        phrases.append(" ".join(words[mid - 7 : mid + 8]))
    if total > 45:
        phrases.append(" ".join(words[-15:]))

    return phrases[:count]


def sweep_tiktok(anchor_phrase: str) -> list[dict]:
    if not apify_client:
        print("[TikTok] No Apify client — skipping")
        return []
    try:
        print(f"[TikTok] Sweeping: '{anchor_phrase[:50]}...'")
        run = apify_client.actor("clockworks/tiktok-scraper").call(
            run_input={"searchQueries": [anchor_phrase], "resultsPerPage": 10}
        )
        suspects = []
        for item in apify_client.dataset(run["defaultDatasetId"]).iterate_items():
            url = item.get("webVideoUrl")
            if url:
                suspects.append({
                    "url": url,
                    "description": (item.get("text") or "")[:300],
                    "author": item.get("authorMeta", {}).get("name", "unknown"),
                })
        print(f"[TikTok] {len(suspects)} suspects found")
        return suspects
    except Exception as e:
        print(f"[TikTok] Error: {e}")
        return []


def scan_for_matches(work_id: str, transcript: str) -> int:
    if not transcript or len(transcript.strip()) < 20:
        return 0

    new_count = 0
    for phrase in extract_anchor_phrases(transcript):
        for suspect in sweep_tiktok(phrase):
            db_save_match({
                "id": str(uuid.uuid4()),
                "work_id": work_id,
                "platform": "TikTok",
                "url": suspect["url"],
                "description": suspect.get("description", ""),
                "confidence": "medium",
                "action_status": "pending",
                "found_at": datetime.now(timezone.utc).isoformat(),
            })
            new_count += 1

    return new_count


# ============================================================
# PROTECTION UTILITIES
# ============================================================
def sha256_of_file(filepath: str) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def get_audio_fingerprint(filepath: str) -> Optional[dict]:
    try:
        result = subprocess.run(
            [FPCALC_BIN, "-json", filepath],
            capture_output=True, text=True, timeout=120
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            return {"fingerprint": data.get("fingerprint"), "duration": data.get("duration")}
    except (FileNotFoundError, subprocess.TimeoutExpired, json.JSONDecodeError) as e:
        print(f"[Fingerprint] {e}")
    return None


def get_video_fingerprint(filepath: str) -> Optional[dict]:
    try:
        thumb_path = filepath + ".thumb.jpg"
        subprocess.run(
            ["ffmpeg", "-y", "-i", filepath, "-ss", "5", "-frames:v", "1", thumb_path],
            capture_output=True, timeout=60
        )
        if os.path.exists(thumb_path):
            h = sha256_of_file(thumb_path)
            os.remove(thumb_path)
            return {"thumbnail_hash": h}
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        print(f"[Video FP] {e}")
    return None


def embed_audio_metadata(filepath: str, work_id: str, owner: str) -> bool:
    try:
        ext = Path(filepath).suffix.lower()
        handler = MP3(filepath) if ext == ".mp3" else WAVE(filepath) if ext == ".wav" else None
        if not handler:
            return False
        if handler.tags is None:
            handler.add_tags()
        handler.tags.add(TCOP(encoding=3, text=[f"\u00a9 {owner}"]))
        handler.tags.add(TXXX(encoding=3, desc="ContentRedact-WorkID", text=[work_id]))
        handler.tags.add(TXXX(encoding=3, desc="ContentRedact-Timestamp",
                               text=[datetime.now(timezone.utc).isoformat()]))
        handler.save()
        return True
    except Exception as e:
        print(f"[Metadata] {e}")
        return False


def embed_video_metadata(input_path: str, output_path: str, work_id: str, owner: str) -> bool:
    try:
        result = subprocess.run([
            "ffmpeg", "-y", "-i", input_path,
            "-metadata", f"copyright=\u00a9 {owner}",
            "-metadata", f"comment=ContentRedact-WorkID:{work_id}",
            "-metadata", f"description=Protected by Content Redact on {datetime.now(timezone.utc).isoformat()}",
            "-codec", "copy", output_path
        ], capture_output=True, text=True, timeout=300)
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        print(f"[Video Meta] {e}")
        return False


def generate_certificate(work: dict) -> str:
    cert = {
        "certificate_version": "1.0",
        "work_id": work["id"],
        "title": work["title"],
        "owner": work.get("owner", "Unknown"),
        "sha256": work.get("original_hash"),
        "fingerprint": work.get("fingerprint"),
        "transcript_excerpt": (work.get("transcript") or "")[:200],
        "protections": work.get("protections_applied", []),
        "protected_at": work.get("protected_at"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    path = str(CERTS_DIR / f"{work['id']}_certificate.json")
    with open(path, "w") as f:
        json.dump(cert, f, indent=2)
    return path


def cleanup_files(work_id: str):
    for f in UPLOAD_DIR.glob(f"{work_id}*"):
        try:
            os.remove(f)
        except OSError:
            pass


# ============================================================
# MAIN PIPELINE
# ============================================================
def process_and_protect(work_id: str, file_path: str, media_type: str, owner: str):
    print(f"\n{'='*50}")
    print(f"[Pipeline] Processing {work_id} ({media_type})")
    print(f"{'='*50}")

    work = db_get_work(work_id)
    if not work:
        return

    protections = []

    try:
        # 1. Hash original
        work["original_hash"] = sha256_of_file(file_path)
        print(f"[Pipeline] SHA-256: {work['original_hash'][:20]}...")

        # 2. Fingerprint
        fp = get_audio_fingerprint(file_path) if media_type == "audio" else get_video_fingerprint(file_path)
        if fp:
            work["fingerprint"] = fp
            protections.append(f"{media_type}_fingerprint")

        # 3. Metadata into temp copy for one-time download
        temp_path = str(UPLOAD_DIR / f"{work_id}.protected{Path(file_path).suffix}")
        shutil.copy2(file_path, temp_path)

        if media_type == "audio":
            if embed_audio_metadata(temp_path, work_id, owner):
                protections.append("metadata_embedded")
        else:
            meta_out = temp_path + ".meta.mp4"
            if embed_video_metadata(temp_path, meta_out, work_id, owner):
                os.replace(meta_out, temp_path)
                protections.append("metadata_embedded")

        work["temp_protected_path"] = temp_path

        # 4. Transcribe
        transcript = transcribe_media(file_path)
        if transcript:
            work["transcript"] = transcript
            protections.append("ai_transcript")

        # 5. Scan for theft
        if transcript:
            match_count = scan_for_matches(work_id, transcript)
            print(f"[Pipeline] {match_count} matches found")

        # 6. Certificate
        work["protections_applied"] = protections
        work["protected_at"] = datetime.now(timezone.utc).isoformat()
        work["certificate_path"] = generate_certificate(work)

        # 7. Complete
        work["status"] = "protected"
        work["matches_found"] = db_match_count(work_id)
        print(f"[Pipeline] Complete: {', '.join(protections)}")

        # 8. Delete original upload immediately
        try:
            os.remove(file_path)
        except OSError:
            pass

    except Exception as e:
        work["status"] = "error"
        work["error"] = str(e)
        print(f"[Pipeline] ERROR: {e}")

    db_save_work(work_id, work)


# ============================================================
# SCHEDULED SCANNER
# ============================================================
def run_scheduled_scans():
    print("\n[Scheduler] Periodic scan starting...")
    works = db_get_all_works()
    scanned = 0

    for work in works:
        if work.get("status") != "protected" or not work.get("transcript"):
            continue
        scanned += 1
        if LIVE_SCANNING:
            new = scan_for_matches(work["id"], work["transcript"])
            if new > 0:
                work["matches_found"] = db_match_count(work["id"])
                db_save_work(work["id"], work)
        else:
            print(f"[Scheduler] (dry) {work['id'][:8]}")

    print(f"[Scheduler] Done — {scanned} works (live={LIVE_SCANNING})\n")


# ============================================================
# LIFECYCLE
# ============================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = BackgroundScheduler()
    scheduler.add_job(run_scheduled_scans, "interval", minutes=30)
    scheduler.start()
    yield
    scheduler.shutdown()


# ============================================================
# APP
# ============================================================
app = FastAPI(title="Content Redact API", version="2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.get("/")
def health():
    return {"app": "Content Redact API", "version": "2.0", "ai": ai_client is not None, "scanning": apify_client is not None}


@app.get("/api/v1/works")
async def list_works():
    works = db_get_all_works()
    for w in works:
        w["matches_found"] = db_match_count(w["id"])
        w.pop("temp_protected_path", None)
        w.pop("certificate_path", None)
        if w.get("transcript"):
            w["transcript_preview"] = w["transcript"][:120] + "..."
            w.pop("transcript", None)
    return works


@app.get("/api/v1/works/{work_id}")
async def get_work_detail(work_id: str):
    work = db_get_work(work_id)
    if not work:
        raise HTTPException(404, "Work not found")
    work["matches"] = db_get_matches(work_id)
    work["matches_found"] = len(work["matches"])
    work.pop("temp_protected_path", None)
    work.pop("certificate_path", None)
    return work


@app.post("/api/v1/works/protect")
async def protect_new_work(background_tasks: BackgroundTasks, file: UploadFile = File(...), owner: str = "Default Owner"):
    allowed = {"video/mp4": "video", "audio/mpeg": "audio", "audio/wav": "audio", "audio/x-wav": "audio", "audio/mp3": "audio"}
    media_type = allowed.get(file.content_type)
    if not media_type:
        raise HTTPException(400, f"Unsupported: {file.content_type}")

    work_id = str(uuid.uuid4())
    file_path = str(UPLOAD_DIR / f"{work_id}{Path(file.filename).suffix}")
    with open(file_path, "wb") as buf:
        shutil.copyfileobj(file.file, buf)

    db_save_work(work_id, {
        "id": work_id, "title": file.filename, "media_type": media_type,
        "owner": owner, "status": "processing", "protections_applied": [],
        "matches_found": 0, "created_at": datetime.now(timezone.utc).isoformat(),
    })
    background_tasks.add_task(process_and_protect, work_id, file_path, media_type, owner)
    return {"message": "Upload received.", "work_id": work_id, "status": "processing"}


@app.get("/api/v1/works/{work_id}/download")
async def download_protected(work_id: str, background_tasks: BackgroundTasks):
    work = db_get_work(work_id)
    if not work:
        raise HTTPException(404, "Work not found")
    path = work.get("temp_protected_path")
    if not path or not os.path.exists(path):
        raise HTTPException(410, "File expired. Only fingerprints are retained.")

    def cleanup():
        try: os.remove(path)
        except OSError: pass
        work.pop("temp_protected_path", None)
        db_save_work(work_id, work)

    background_tasks.add_task(cleanup)
    return FileResponse(path, filename=f"PROTECTED_{work['title']}", media_type="application/octet-stream")


@app.get("/api/v1/works/{work_id}/certificate")
async def download_certificate(work_id: str):
    work = db_get_work(work_id)
    if not work:
        raise HTTPException(404, "Work not found")
    cert = work.get("certificate_path")
    if not cert or not os.path.exists(cert):
        raise HTTPException(404, "Certificate not ready")
    return FileResponse(cert, media_type="application/json", filename=f"certificate_{work_id}.json")


@app.get("/api/v1/works/{work_id}/matches")
async def get_matches(work_id: str):
    if not db_get_work(work_id):
        raise HTTPException(404, "Work not found")
    return db_get_matches(work_id)


@app.post("/api/v1/works/{work_id}/scan")
async def trigger_scan(work_id: str, background_tasks: BackgroundTasks):
    work = db_get_work(work_id)
    if not work:
        raise HTTPException(404, "Work not found")
    if not work.get("transcript"):
        raise HTTPException(400, "No transcript available")

    def do_scan():
        scan_for_matches(work_id, work["transcript"])
        w = db_get_work(work_id)
        if w:
            w["matches_found"] = db_match_count(work_id)
            db_save_work(work_id, w)

    background_tasks.add_task(do_scan)
    return {"message": "Scan started", "work_id": work_id}


@app.post("/api/v1/works/{work_id}/generate-dmca")
async def generate_dmca(work_id: str, infringing_url: str = Query(...)):
    work = db_get_work(work_id)
    if not work:
        raise HTTPException(404, "Work not found")
    return {
        "type": "DMCA_TAKEDOWN_NOTICE",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "notice_text": f"""DMCA TAKEDOWN NOTICE — 17 U.S.C. \u00a7 512(c)

To Whom It May Concern:

I am writing to notify you of infringement of my copyrighted work.

COPYRIGHTED WORK:
  Title: {work['title']}
  Content Redact ID: {work_id}
  SHA-256 Hash: {work.get('original_hash', 'N/A')}
  Protection Date: {work.get('protected_at', 'N/A')}

INFRINGING MATERIAL:
  URL: {infringing_url}

I have a good faith belief that the use described above is not
authorized by the copyright owner, its agent, or the law.

I have considered whether this use qualifies as fair use under
applicable law and believe it does not.

I swear under penalty of perjury that the information in this
notice is accurate and that I am the copyright owner or authorized
to act on behalf of the owner.

Contact:
  Name: {work.get('owner', '[YOUR NAME]')}
  Email: [YOUR EMAIL]
  Address: [YOUR ADDRESS]

Electronic Signature: ____________________________
Date: {datetime.now(timezone.utc).strftime('%B %d, %Y')}
""",
        "fair_use_warning": "Before submitting, you MUST consider whether this use qualifies as fair use. Filing a knowingly false DMCA claim exposes you to liability under Section 512(f).",
        "submission_links": {
            "youtube": "https://www.youtube.com/copyright_complaint_page",
            "tiktok": "https://www.tiktok.com/legal/report/Copyright",
            "instagram": "https://help.instagram.com/contact/372592039493026",
            "facebook": "https://www.facebook.com/help/contact/634636770043106",
            "twitter": "https://help.twitter.com/forms/dmca",
        },
    }


@app.delete("/api/v1/works/{work_id}")
async def delete_work(work_id: str):
    work = db_get_work(work_id)
    if not work:
        raise HTTPException(404, "Work not found")
    cleanup_files(work_id)
    for key in ["temp_protected_path", "certificate_path"]:
        p = work.get(key)
        if p and os.path.exists(p):
            try: os.remove(p)
            except OSError: pass
    db_delete_work(work_id)
    return {"message": "Deleted"}