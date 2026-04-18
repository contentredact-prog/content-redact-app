"""
Content Redact — Backend API v4.1
==================================
ASYNC ARCHITECTURE:
  Fast path (< 5 sec):      Upload → Hash → Fingerprint → Stamp Metadata → Upload to Supabase Storage → Return signed download URL
  Background path (0-48h):  Download from Storage → Transcribe → Scan → Update DB
  Cleanup (auto):           pg_cron + scheduler delete files after 48 hours, fingerprints stay forever

Run:  uvicorn main:app --reload --port 8000

Env vars:
  SUPABASE_URL          — https://dkppcuotnphzjcmncnjg.supabase.co
  SUPABASE_SERVICE_KEY  — service_role key (NOT anon)
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
SIGNED_URL_EXPIRY = 3600  # 1 hour download window

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
    res = (
        sb.table("protected_works")
        .select("*")
        .eq("processing_stage", "fingerprinted")
        .not_.is_("storage_path", "null")
        .execute()
    )
    return res.data or []


def db_get_all_monitoring() -> list:
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
        return  # Duplicate — skip
    sb.table("discovered_matches").insert({
        "work_id": work_id,
        "platform": platform,
        "match_url": url,
        "confidence_score": confidence,
        "match_evidence": {"description": description},
        "review_status": "pending",
    }).execute()


def db_get_user_by_email(email: str) -> Optional[dict]:
    """Look up user by email. Returns None if not found (new user whose trigger hasn't fired yet)."""
    try:
        res = sb.table("users").select("*").eq("email", email).maybe_single().execute()
        return res.data
    except Exception:
        return None


# ============================================================
# SUPABASE STORAGE HELPERS
# ============================================================
def upload_to_storage(local_path: str, storage_path: str) -> bool:
    try:
        with open(local_path, "rb") as f:
            sb.storage.from_(STORAGE_BUCKET).upload(storage_path, f)
        print(f"[Storage] Uploaded: {storage_path}")
        return True
    except Exception as e:
        print(f"[Storage] Upload failed: {e}")
        return False


def get_signed_download_url(storage_path: str, expiry_seconds: int = SIGNED_URL_EXPIRY) -> Optional[str]:
    """Generate a time-limited signed URL for downloading the stamped file."""
    try:
        res = sb.storage.from_(STORAGE_BUCKET).create_signed_url(storage_path, expiry_seconds)
        # The Python SDK returns different shapes depending on version
        if isinstance(res, dict):
            return res.get("signedURL") or res.get("signed_url") or res.get("signedUrl")
        elif hasattr(res, "signed_url"):
            return res.signed_url
        print(f"[Storage] Signed URL response format unexpected: {type(res)}")
        return None
    except Exception as e:
        print(f"[Storage] Signed URL failed: {e}")
        return None


def download_from_storage(storage_path: str, local_path: str) -> bool:
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
    try:
        sb.storage.from_(STORAGE_BUCKET).remove([storage_path])
        print(f"[Storage] Deleted: {storage_path}")
    except Exception as e:
        print(f"[Storage] Delete failed: {e}")


# ============================================================
# FAST PATH: HASH + FINGERPRINT + METADATA STAMP
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


def embed_audio_metadata(filepath: str, work_id: str, owner: str) -> bool:
    """Stamp audio file in-place with copyright metadata."""
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
        print(f"[Stamp] Audio metadata embedded")
        return True
    except Exception as e:
        print(f"[Stamp] Audio metadata failed: {e}")
        return False


def embed_video_metadata(input_path: str, output_path: str, work_id: str, owner: str) -> bool:
    """Stamp video with copyright metadata via ffmpeg. Output to a separate file."""
    try:
        result = subprocess.run([
            "ffmpeg", "-y", "-i", input_path,
            "-metadata", f"copyright=\u00a9 {owner}",
            "-metadata", f"comment=ContentRedact-WorkID:{work_id}",
            "-codec", "copy", output_path
        ], capture_output=True, timeout=300)
        if result.returncode == 0:
            print(f"[Stamp] Video metadata embedded")
            return True
        print(f"[Stamp] ffmpeg returned {result.returncode}: {result.stderr[:200]}")
        return False
    except Exception as e:
        print(f"[Stamp] Video metadata failed: {e}")
        return False


def stamp_file(temp_path: str, work_id: str, owner: str, media_type: str) -> str:
    """
    Stamp metadata into the file. Returns the path to the stamped file.
    For audio: stamps in-place (same path returned).
    For video: creates a new stamped file, replaces original if successful.
    If stamping fails, the original unstamped file is returned — we still protect it.
    """
    if media_type == "audio":
        embed_audio_metadata(temp_path, work_id, owner)
        return temp_path
    else:
        stamped_path = f"/tmp/stamped_{work_id}{Path(temp_path).suffix}"
        if embed_video_metadata(temp_path, stamped_path, work_id, owner):
            os.replace(stamped_path, temp_path)
        else:
            # Clean up failed stamped file if it exists
            if os.path.exists(stamped_path):
                os.remove(stamped_path)
            print(f"[Stamp] Proceeding with unstamped file")
        return temp_path


# ============================================================
# BACKGROUND PATH: TRANSCRIPTION + SCANNING
# ============================================================
def transcribe_media(filepath: str) -> Optional[str]:
    if not ai_client:
        print("[AI] No Gemini client configured — skipping transcription")
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
            contents=[media_file, "Transcribe the audio verbatim. Return only the transcript."]
        )
        transcript = response.text.strip()
        print(f"[AI] Transcript complete: {len(transcript)} chars")
        return transcript
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
        print(f"[TikTok] Sweeping: '{anchor_phrase[:50]}...'")
        run = apify_client.actor("clockworks/tiktok-scraper").call(
            run_input={"searchQueries": [anchor_phrase], "resultsPerPage": 10}
        )
        suspects = []
        for item in apify_client.dataset(run["defaultDatasetId"]).iterate_items():
            url = item.get("webVideoUrl")
            if url:
                suspects.append({"url": url, "description": (item.get("text") or "")[:300]})
        print(f"[TikTok] {len(suspects)} suspects found")
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
    Background worker — runs silently after the user already has their "protected" status.
    Downloads file from Supabase Storage, transcribes, scans, updates DB.
    """
    temp_path = f"/tmp/bg_{work_id}{Path(storage_path).suffix}"
    try:
        # Download from storage
        if not download_from_storage(storage_path, temp_path):
            db_update_work(work_id, {"processing_stage": "failed"})
            return

        # Transcribe
        db_update_work(work_id, {"processing_stage": "transcribing"})
        print(f"[Background] Transcribing {work_id[:8]}...")
        transcript = transcribe_media(temp_path)

        if transcript:
            db_update_work(work_id, {"transcript": transcript})

            # Scan
            db_update_work(work_id, {"processing_stage": "scanning"})
            print(f"[Background] Scanning {work_id[:8]}...")
            match_count = scan_for_matches(work_id, transcript)
            print(f"[Background] {match_count} matches found for {work_id[:8]}")
        else:
            print(f"[Background] No transcript generated for {work_id[:8]}")

        # Move to monitoring regardless — fingerprint protection is the primary value
        db_update_work(work_id, {
            "processing_stage": "monitoring",
            "protected_at": datetime.now(timezone.utc).isoformat(),
        })
        print(f"[Background] {work_id[:8]} → monitoring")

    except Exception as e:
        db_update_work(work_id, {"processing_stage": "failed"})
        print(f"[Background] ERROR for {work_id[:8]}: {e}")

    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


# ============================================================
# SCHEDULED JOBS
# ============================================================
def process_pending_works():
    """Pick up works stuck at fingerprinted stage (e.g. if background_task failed on Render restart)."""
    works = db_get_works_needing_processing()
    if not works:
        return
    print(f"\n[Worker] {len(works)} works pending background processing...")
    for work in works:
        storage_path = work.get("storage_path")
        if storage_path:
            background_transcribe_and_scan(work["id"], storage_path)


def run_scheduled_scans():
    """Re-scan all monitored works for new matches."""
    print("\n[Scheduler] Periodic scan starting...")
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
                print(f"[Scheduler] +{new} new matches for {work['id'][:8]}")
        else:
            print(f"[Scheduler] (dry run) {work['id'][:8]}")
    print(f"[Scheduler] Done — {scanned} works checked (live={LIVE_SCANNING})\n")


def cleanup_expired_files():
    """Delete files from Supabase Storage older than 48 hours. Fingerprints stay forever."""
    print("\n[Cleanup] Checking for expired files...")
    res = (
        sb.table("protected_works")
        .select("id, storage_path, created_at")
        .not_.is_("storage_path", "null")
        .execute()
    )
    cleaned = 0
    for work in (res.data or []):
        try:
            created = datetime.fromisoformat(work["created_at"].replace("Z", "+00:00"))
            age_hours = (datetime.now(timezone.utc) - created).total_seconds() / 3600
            if age_hours > 48:
                delete_from_storage(work["storage_path"])
                db_update_work(work["id"], {"storage_path": None})
                cleaned += 1
        except Exception as e:
            print(f"[Cleanup] Error processing {work['id'][:8]}: {e}")
    print(f"[Cleanup] Purged {cleaned} expired files\n")


# ============================================================
# LIFECYCLE
# ============================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = BackgroundScheduler()
    scheduler.add_job(process_pending_works, "interval", minutes=5, id="process_pending")
    scheduler.add_job(run_scheduled_scans, "interval", minutes=30, id="scheduled_scan")
    scheduler.add_job(cleanup_expired_files, "interval", hours=1, id="storage_cleanup")
    scheduler.start()
    print("[Init] Schedulers: pending(5m), scan(30m), cleanup(1h)")
    yield
    scheduler.shutdown()


# ============================================================
# APP
# ============================================================
app = FastAPI(title="Content Redact API", version="4.1", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Health ---
@app.get("/")
def health():
    return {
        "app": "Content Redact API",
        "version": "4.1",
        "architecture": "async (fast fingerprint + background scan)",
        "ai": ai_client is not None,
        "scanning": apify_client is not None,
        "live_scanning": LIVE_SCANNING,
    }


# --- Fast path: protect + return download link ---
@app.post("/api/v1/works/protect")
async def protect_new_work(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    owner: str = Form("Default Owner"),
):
    """
    FAST PATH (~3-5 seconds):
      1. Save to /tmp
      2. Hash + Fingerprint
      3. Stamp metadata into file
      4. Upload stamped file to Supabase Storage
      5. Generate signed download URL (1 hour expiry)
      6. Save work record as "protected"
      7. Hand off transcription+scanning to background
      8. Delete local temp, return download URL
    """
    allowed = {
        "video/mp4": "video",
        "audio/mpeg": "audio",
        "audio/wav": "audio",
        "audio/x-wav": "audio",
        "audio/mp3": "audio",
    }
    media_type = allowed.get(file.content_type)
    if not media_type:
        raise HTTPException(400, f"Unsupported format: {file.content_type}. Use MP4, MP3, or WAV.")

    work_id = str(uuid.uuid4())
    file_ext = Path(file.filename).suffix
    temp_path = f"/tmp/{work_id}{file_ext}"

    # 1. Save to temp
    with open(temp_path, "wb") as buf:
        shutil.copyfileobj(file.file, buf)

    try:
        # 2. Hash + Fingerprint (instant math)
        file_hash = sha256_of_file(temp_path)
        print(f"[Fast] SHA-256: {file_hash[:16]}...")

        if media_type == "audio":
            fp = get_audio_fingerprint(temp_path)
            fp_type = "chromaprint"
        else:
            fp = get_video_fingerprint(temp_path)
            fp_type = "phash"

        # 3. Stamp metadata
        temp_path = stamp_file(temp_path, work_id, owner, media_type)

        # 4. Upload stamped file to Supabase Storage
        user = db_get_user_by_email(owner)
        user_id = user["id"] if user else "anonymous"
        storage_path = f"{user_id}/{work_id}{file_ext}"

        if not upload_to_storage(temp_path, storage_path):
            raise Exception("Failed to upload to storage")

        # 5. Generate signed download URL
        download_url = get_signed_download_url(storage_path)

        # 6. Save to database
        db_create_work({
            "id": work_id,
            "user_id": user["id"] if user else None,
            "title": file.filename,
            "media_type": media_type,
            "owner": owner,
            "original_hash": file_hash,
            "storage_path": storage_path,
        })

        if fp:
            db_save_fingerprint(work_id, fp_type, fp)
            print(f"[Fast] Fingerprint saved ({fp_type})")

        # 7. Background: transcribe + scan
        background_tasks.add_task(background_transcribe_and_scan, work_id, storage_path)

        # 8. Clean up temp, return instantly
        if os.path.exists(temp_path):
            os.remove(temp_path)

        return {
            "work_id": work_id,
            "status": "protected",
            "message": "Content fingerprinted and protected. Background scan in progress.",
            "download_url": download_url,
        }

    except Exception as e:
        # Clean up on any failure
        for f in [temp_path, f"/tmp/stamped_{work_id}{file_ext}"]:
            if os.path.exists(f):
                os.remove(f)
        raise HTTPException(500, f"Protection failed: {str(e)}")


# --- Manual re-scan ---
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


# --- DMCA takedown notice ---
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
        "fair_use_warning": (
            "Before submitting, you MUST consider whether this use qualifies as fair use. "
            "Filing a knowingly false DMCA claim exposes you to liability under Section 512(f)."
        ),
        "submission_links": {
            "youtube": "https://www.youtube.com/copyright_complaint_page",
            "tiktok": "https://www.tiktok.com/legal/report/Copyright",
            "instagram": "https://help.instagram.com/contact/372592039493026",
            "facebook": "https://www.facebook.com/help/contact/634636770043106",
            "twitter": "https://help.twitter.com/forms/dmca",
        },
    }


# --- Certificate ---
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
        "fingerprints": [
            {"type": f["fingerprint_type"], "data": f["fingerprint_data"][:40] + "..."}
            for f in (fps.data or [])
        ],
        "transcript_excerpt": (work.get("transcript") or "")[:200],
        "processing_stage": work.get("processing_stage"),
        "protected_at": work.get("protected_at"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# --- Refresh download link (if file hasn't expired yet) ---
@app.get("/api/v1/works/{work_id}/download-link")
async def get_download_link(work_id: str):
    """Generate a fresh signed download URL if the file still exists in storage."""
    work = db_get_work(work_id)
    if not work:
        raise HTTPException(404, "Work not found")

    storage_path = work.get("storage_path")
    if not storage_path:
        raise HTTPException(410, "File has expired. Only fingerprints are retained after 48 hours.")

    url = get_signed_download_url(storage_path)
    if not url:
        raise HTTPException(500, "Failed to generate download link")

    return {"download_url": url, "expires_in_seconds": SIGNED_URL_EXPIRY}