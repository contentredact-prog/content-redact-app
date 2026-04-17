"""
Content Redact — Backend API v4.0
==================================
ASYNC ARCHITECTURE:
  Fast path (< 3 seconds):  Upload → Hash → Fingerprint → Save to Supabase Storage → Return "protected"
  Background path (0-48 hrs): Download from Storage → Transcribe → Scan → Update DB
  Cleanup (auto):            pg_cron deletes files from Storage after 48 hours, fingerprints stay forever

Run:  uvicorn main:app --reload --port 8000

Env vars:
  SUPABASE_URL          — https://dkppcuotnphzjcmncnjg.supabase.co
  SUPABASE_SERVICE_KEY  — service_role key
  GOOGLE_API_KEY        — Gemini for transcription
  APIFY_API_TOKEN       — Apify for TikTok sweeps
  LIVE_SCANNING         — "true" to enable scheduled scans
"""

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Query, Form
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timezone
from contextlib import asynccontextmanager
import shutil
import uuid
import json
import subprocess
import hashlib
import os
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
from supabase import create_client, Client

# ============================================================
# CONFIG
# ============================================================
BACKEND_DIR = Path(__file__).parent
FPCALC_BIN = str(BACKEND_DIR / "fpcalc.exe") if platform.system() == "Windows" else "fpcalc"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://dkppcuotnphzjcmncnjg.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")
APIFY_TOKEN = os.environ.get("APIFY_API_TOKEN")
LIVE_SCANNING = os.environ.get("LIVE_SCANNING", "false").lower() == "true"

STORAGE_BUCKET = "media-uploads"

# ============================================================
# CLIENTS
# ============================================================
sb: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
print("[Init] Supabase client ready")

ai_client = None
if GOOGLE_API_KEY:
    try:
        ai_client = genai.Client(api_key=GOOGLE_API_KEY)
        print("[Init] Gemini AI ready")
    except Exception as e:
        print(f"[Init] Gemini failed: {e}")

apify_client = None
if APIFY_TOKEN:
    apify_client = ApifyClient(APIFY_TOKEN)
    print("[Init] Apify ready")

# ============================================================
# DATABASE HELPERS
# ============================================================
def db_create_work(work: dict):
    sb.table("protected_works").insert({
        "id": work["id"],
        "user_id": work.get("user_id"),
        "title": work["title"],
        "media_type": work.get("media_type"),
        "owner_name": work.get("owner", "Unknown"),
        "original_hash": work.get("original_hash"),
        "processing_status": "protected",
        "processing_stage": "fingerprinted",
        "storage_path": work.get("storage_path"),
        "original_storage_path": "",
    }).execute()


def db_update_work(work_id: str, updates: dict):
    sb.table("protected_works").update(updates).eq("id", work_id).execute()


def db_get_work(work_id: str) -> Optional[dict]:
    res = sb.table("protected_works").select("*").eq("id", work_id).maybe_single().execute()
    return res.data


def db_get_works_needing_processing() -> list:
    """Get works that are fingerprinted but not yet transcribed/scanned."""
    res = sb.table("protected_works").select("*").eq("processing_stage", "fingerprinted").not_.is_("storage_path", "null").execute()
    return res.data or []


def db_get_all_monitoring() -> list:
    """Get works in monitoring stage for scheduled re-scans."""
    res = sb.table("protected_works").select("*").eq("processing_stage", "monitoring").execute()
    return res.data or []


def db_save_fingerprint(work_id: str, fp_type: str, fp_data: str):
    sb.table("fingerprints").insert({
        "work_id": work_id,
        "fingerprint_type": fp_type,
        "fingerprint_data": fp_data,
    }).execute()


def db_save_match(work_id: str, platform: str, url: str, description: str = "", confidence: int = 50):
    existing = sb.table("discovered_matches").select("id").eq("work_id", work_id).eq("match_url", url).execute()
    if existing.data:
        return
    sb.table("discovered_matches").insert({
        "work_id": work_id,
        "platform": platform,
        "match_url": url,
        "confidence_score": confidence,
        "match_evidence": {"description": description},
        "review_status": "pending",
    }).execute()


def db_get_user_by_email(email: str) -> Optional[dict]:
    res = sb.table("users").select("*").eq("email", email).maybe_single().execute()
    return res.data


# ============================================================
# SUPABASE STORAGE HELPERS
# ============================================================
def upload_to_storage(local_path: str, storage_path: str) -> bool:
    """Upload a file to Supabase Storage bucket."""
    try:
        with open(local_path, "rb") as f:
            sb.storage.from_(STORAGE_BUCKET).upload(storage_path, f)
        print(f"[Storage] Uploaded: {storage_path}")
        return True
    except Exception as e:
        print(f"[Storage] Upload failed: {e}")
        return False


def download_from_storage(storage_path: str, local_path: str) -> bool:
    """Download a file from Supabase Storage to local temp."""
    try:
        data = sb.storage.from_(STORAGE_BUCKET).download(storage_path)
        with open(local_path, "wb") as f:
            f.write(data)
        print(f"[Storage] Downloaded: {storage_path}")
        return True
    except Exception as e:
        print(f"[Storage] Download failed: {e}")
        return False


def delete_from_storage(storage_path: str):
    """Delete a file from Supabase Storage."""
    try:
        sb.storage.from_(STORAGE_BUCKET).remove([storage_path])
        print(f"[Storage] Deleted: {storage_path}")
    except Exception as e:
        print(f"[Storage] Delete failed: {e}")


# ============================================================
# FAST PATH: FINGERPRINTING (< 3 seconds)
# ============================================================
def sha256_of_file(filepath: str) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def get_audio_fingerprint(filepath: str) -> Optional[str]:
    try:
        result = subprocess.run(
            [FPCALC_BIN, "-json", filepath],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            return json.loads(result.stdout).get("fingerprint")
    except Exception as e:
        print(f"[FP] {e}")
    return None


def get_video_fingerprint(filepath: str) -> Optional[str]:
    try:
        thumb = filepath + ".thumb.jpg"
        subprocess.run(
            ["ffmpeg", "-y", "-i", filepath, "-ss", "5", "-frames:v", "1", thumb],
            capture_output=True, timeout=30
        )
        if os.path.exists(thumb):
            h = sha256_of_file(thumb)
            os.remove(thumb)
            return h
    except Exception as e:
        print(f"[Video FP] {e}")
    return None


# ============================================================
# BACKGROUND PATH: TRANSCRIPTION + SCANNING
# ============================================================
def transcribe_media(filepath: str) -> Optional[str]:
    if not ai_client:
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
            return None
        response = ai_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[media_file, "Transcribe the audio verbatim. Return only the transcript."]
        )
        return response.text.strip()
    except Exception as e:
        print(f"[AI] Error: {e}")
        return None


def extract_anchor_phrases(transcript: str) -> list[str]:
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
    return phrases


def sweep_tiktok(anchor_phrase: str) -> list[dict]:
    if not apify_client:
        return []
    try:
        run = apify_client.actor("clockworks/tiktok-scraper").call(
            run_input={"searchQueries": [anchor_phrase], "resultsPerPage": 10}
        )
        suspects = []
        for item in apify_client.dataset(run["defaultDatasetId"]).iterate_items():
            url = item.get("webVideoUrl")
            if url:
                suspects.append({"url": url, "description": (item.get("text") or "")[:300]})
        return suspects
    except Exception as e:
        print(f"[TikTok] Error: {e}")
        return []


def scan_for_matches(work_id: str, transcript: str) -> int:
    if not transcript or len(transcript.strip()) < 20:
        return 0
    count = 0
    for phrase in extract_anchor_phrases(transcript):
        for suspect in sweep_tiktok(phrase):
            db_save_match(work_id, "TikTok", suspect["url"], suspect.get("description", ""))
            count += 1
    return count


def background_transcribe_and_scan(work_id: str, storage_path: str):
    """
    Background worker: downloads file from Supabase Storage,
    transcribes it, scans for matches, then cleans up.
    Runs silently — user already has their "protected" status.
    """
    temp_path = f"/tmp/{work_id}{Path(storage_path).suffix}"

    try:
        # 1. Download from storage
        if not download_from_storage(storage_path, temp_path):
            db_update_work(work_id, {"processing_stage": "failed"})
            return

        # 2. Transcribe
        db_update_work(work_id, {"processing_stage": "transcribing"})
        print(f"[Background] Transcribing {work_id}...")
        transcript = transcribe_media(temp_path)

        if transcript:
            db_update_work(work_id, {"transcript": transcript})
            print(f"[Background] Transcript: {len(transcript)} chars")

            # 3. Scan
            db_update_work(work_id, {"processing_stage": "scanning"})
            print(f"[Background] Scanning {work_id}...")
            match_count = scan_for_matches(work_id, transcript)
            print(f"[Background] {match_count} matches found")

        # 4. Done — move to monitoring stage
        db_update_work(work_id, {
            "processing_stage": "monitoring",
            "protected_at": datetime.now(timezone.utc).isoformat(),
        })
        print(f"[Background] {work_id} → monitoring")

    except Exception as e:
        db_update_work(work_id, {"processing_stage": "failed"})
        print(f"[Background] ERROR: {e}")

    finally:
        # Always clean up the local temp file
        if os.path.exists(temp_path):
            os.remove(temp_path)
            print(f"[Background] Temp file cleaned: {temp_path}")


# ============================================================
# SCHEDULED RE-SCANS
# ============================================================
def run_scheduled_scans():
    """Re-scan all works in monitoring stage for new matches."""
    print("\n[Scheduler] Starting periodic scan...")
    works = db_get_all_monitoring()
    scanned = 0
    for work in works:
        transcript = work.get("transcript")
        if not transcript:
            continue
        scanned += 1
        if LIVE_SCANNING:
            new = scan_for_matches(work["id"], transcript)
            if new > 0:
                print(f"[Scheduler] +{new} matches for {work['id'][:8]}")
        else:
            print(f"[Scheduler] (dry) {work['id'][:8]}")
    print(f"[Scheduler] Done — {scanned} works (live={LIVE_SCANNING})\n")


def process_pending_works():
    """Pick up any works that were fingerprinted but haven't been transcribed yet."""
    works = db_get_works_needing_processing()
    if not works:
        return
    print(f"\n[Worker] Found {len(works)} works needing background processing...")
    for work in works:
        storage_path = work.get("storage_path")
        if storage_path:
            background_transcribe_and_scan(work["id"], storage_path)


# ============================================================
# STORAGE CLEANUP
# ============================================================
def cleanup_expired_files():
    """Delete files from Supabase Storage that are older than 48 hours."""
    print("\n[Cleanup] Checking for expired files...")
    res = sb.table("protected_works").select("id, storage_path, created_at").not_.is_("storage_path", "null").execute()

    cleaned = 0
    for work in (res.data or []):
        created = datetime.fromisoformat(work["created_at"].replace("Z", "+00:00"))
        age_hours = (datetime.now(timezone.utc) - created).total_seconds() / 3600

        if age_hours > 48:
            delete_from_storage(work["storage_path"])
            db_update_work(work["id"], {"storage_path": None})
            cleaned += 1

    print(f"[Cleanup] Deleted {cleaned} expired files\n")


# ============================================================
# LIFECYCLE
# ============================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = BackgroundScheduler()
    # Process pending works every 5 minutes
    scheduler.add_job(process_pending_works, "interval", minutes=5, id="process_pending")
    # Re-scan monitored works every 30 minutes
    scheduler.add_job(run_scheduled_scans, "interval", minutes=30, id="scheduled_scan")
    # Clean up expired storage files every hour
    scheduler.add_job(cleanup_expired_files, "interval", hours=1, id="storage_cleanup")
    scheduler.start()
    print("[Init] Schedulers started: pending(5m), scan(30m), cleanup(1h)")
    yield
    scheduler.shutdown()


# ============================================================
# APP
# ============================================================
app = FastAPI(title="Content Redact API", version="4.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.get("/")
def health():
    return {
        "app": "Content Redact API",
        "version": "4.0",
        "architecture": "async (fast fingerprint + background scan)",
        "ai": ai_client is not None,
        "scanning": apify_client is not None,
    }


@app.post("/api/v1/works/protect")
async def protect_new_work(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    owner: str = Form("Default Owner"),
):
    """
    FAST PATH — completes in ~3 seconds:
      1. Save to temp
      2. Hash + Fingerprint (instant math)
      3. Upload to Supabase Storage (48-hour holding tank)
      4. Save work record as "protected"
      5. Hand off transcription/scanning to background worker
      6. Delete local temp file
      7. Return immediately
    """
    allowed = {"video/mp4": "video", "audio/mpeg": "audio", "audio/wav": "audio", "audio/x-wav": "audio", "audio/mp3": "audio"}
    media_type = allowed.get(file.content_type)
    if not media_type:
        raise HTTPException(400, f"Unsupported: {file.content_type}")

    work_id = str(uuid.uuid4())
    file_ext = Path(file.filename).suffix
    temp_path = f"/tmp/{work_id}{file_ext}"

    # 1. Save to temp
    with open(temp_path, "wb") as buf:
        shutil.copyfileobj(file.file, buf)

    try:
        # 2. FAST MATH — Hash + Fingerprint (< 2 seconds)
        file_hash = sha256_of_file(temp_path)

        if media_type == "audio":
            fp = get_audio_fingerprint(temp_path)
            fp_type = "chromaprint"
        else:
            fp = get_video_fingerprint(temp_path)
            fp_type = "phash"

        # 3. Upload to Supabase Storage (holding tank)
        # Organize by user email folder for RLS
        user = db_get_user_by_email(owner)
        user_id = user["id"] if user else "anonymous"
        storage_path = f"{user_id}/{work_id}{file_ext}"

        upload_to_storage(temp_path, storage_path)

        # 4. Save work record — status is ALREADY "protected"
        db_create_work({
            "id": work_id,
            "user_id": user["id"] if user else None,
            "title": file.filename,
            "media_type": media_type,
            "owner": owner,
            "original_hash": file_hash,
            "storage_path": storage_path,
        })

        # Save fingerprint
        if fp:
            db_save_fingerprint(work_id, fp_type, fp)

        # 5. Hand off to background worker
        background_tasks.add_task(background_transcribe_and_scan, work_id, storage_path)

        # 6. Delete local temp file immediately
        os.remove(temp_path)

        # 7. Return instantly — user sees "protected" in ~3 seconds
        return {
            "work_id": work_id,
            "status": "protected",
            "message": "Your content is fingerprinted and protected. Background scan in progress.",
        }

    except Exception as e:
        # Clean up on failure
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise HTTPException(500, f"Protection failed: {str(e)}")


@app.post("/api/v1/works/{work_id}/scan")
async def trigger_scan(work_id: str, background_tasks: BackgroundTasks):
    work = db_get_work(work_id)
    if not work:
        raise HTTPException(404, "Work not found")
    if not work.get("transcript"):
        raise HTTPException(400, "Transcript not ready yet — background processing still in progress")

    def do_scan():
        scan_for_matches(work_id, work["transcript"])

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
        "notice_text": f"""DMCA TAKEDOWN NOTICE \u2014 17 U.S.C. \u00a7 512(c)

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
  Name: {work.get('owner_name', '[YOUR NAME]')}
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


@app.get("/api/v1/works/{work_id}/certificate")
async def get_certificate(work_id: str):
    work = db_get_work(work_id)
    if not work:
        raise HTTPException(404, "Work not found")
    fps = sb.table("fingerprints").select("*").eq("work_id", work_id).execute()
    return {
        "certificate_version": "1.0",
        "work_id": work_id,
        "title": work["title"],
        "owner": work.get("owner_name"),
        "sha256": work.get("original_hash"),
        "fingerprints": [{"type": f["fingerprint_type"], "data": f["fingerprint_data"][:40] + "..."} for f in (fps.data or [])],
        "transcript_excerpt": (work.get("transcript") or "")[:200],
        "processing_stage": work.get("processing_stage"),
        "protected_at": work.get("protected_at"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }