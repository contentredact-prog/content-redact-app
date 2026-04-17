"""
Content Redact — Backend API v3.0
==================================
Writes all data to Supabase Postgres. Processes uploads locally,
extracts proofs (hash, fingerprint, transcript), scans for theft,
then DELETES the original files. No file storage costs.

Run:  uvicorn main:app --reload --port 8000

Env vars:
  SUPABASE_URL         — https://dkppcuotnphzjcmncnjg.supabase.co
  SUPABASE_SERVICE_KEY  — service_role key (NOT anon — needed for server-side writes)
  GOOGLE_API_KEY       — Gemini for transcription
  APIFY_API_TOKEN      — Apify for TikTok sweeps
  LIVE_SCANNING        — "true" to enable scheduled scans
"""

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Query
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
UPLOAD_DIR = Path("./uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

BACKEND_DIR = Path(__file__).parent
FPCALC_BIN = str(BACKEND_DIR / "fpcalc.exe") if platform.system() == "Windows" else "fpcalc"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://dkppcuotnphzjcmncnjg.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")
APIFY_TOKEN = os.environ.get("APIFY_API_TOKEN")
LIVE_SCANNING = os.environ.get("LIVE_SCANNING", "false").lower() == "true"

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
# DATABASE HELPERS (Supabase)
# ============================================================
def db_create_work(work: dict):
    sb.table("protected_works").insert({
        "id": work["id"],
        "user_id": work.get("user_id"),
        "title": work["title"],
        "media_type": work.get("media_type"),
        "owner_name": work.get("owner", "Unknown"),
        "processing_status": "processing",
        "original_storage_path": "",  # We don't store files
    }).execute()


def db_update_work(work_id: str, updates: dict):
    sb.table("protected_works").update(updates).eq("id", work_id).execute()


def db_get_work(work_id: str) -> Optional[dict]:
    res = sb.table("protected_works").select("*").eq("id", work_id).maybe_single().execute()
    return res.data


def db_get_all_protected() -> list:
    res = sb.table("protected_works").select("*").eq("processing_status", "protected").execute()
    return res.data or []


def db_save_fingerprint(work_id: str, fp_type: str, fp_data: str):
    sb.table("fingerprints").insert({
        "work_id": work_id,
        "fingerprint_type": fp_type,
        "fingerprint_data": fp_data,
    }).execute()


def db_save_match(work_id: str, platform: str, url: str, description: str = "", confidence: int = 50):
    # Check for duplicate URL first
    existing = sb.table("discovered_matches").select("id").eq("work_id", work_id).eq("match_url", url).execute()
    if existing.data:
        return  # Already exists
    sb.table("discovered_matches").insert({
        "work_id": work_id,
        "platform": platform,
        "match_url": url,
        "confidence_score": confidence,
        "match_evidence": {"description": description},
        "review_status": "pending",
    }).execute()


def db_get_matches(work_id: str) -> list:
    res = sb.table("discovered_matches").select("*").eq("work_id", work_id).execute()
    return res.data or []


def db_get_user_by_email(email: str) -> Optional[dict]:
    res = sb.table("users").select("*").eq("email", email).maybe_single().execute()
    return res.data


# ============================================================
# AI TRANSCRIPTION
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
        transcript = response.text.strip()
        print(f"[AI] Transcript: {len(transcript)} chars")
        return transcript
    except Exception as e:
        print(f"[AI] Error: {e}")
        return None


# ============================================================
# TIKTOK SCANNING
# ============================================================
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
                suspects.append({
                    "url": url,
                    "description": (item.get("text") or "")[:300],
                })
        print(f"[TikTok] {len(suspects)} suspects")
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


# ============================================================
# PROTECTION UTILITIES
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
            capture_output=True, text=True, timeout=120
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
            capture_output=True, timeout=60
        )
        if os.path.exists(thumb):
            h = sha256_of_file(thumb)
            os.remove(thumb)
            return h
    except Exception as e:
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
        print(f"[Meta] {e}")
        return False


def embed_video_metadata(input_path: str, output_path: str, work_id: str, owner: str) -> bool:
    try:
        result = subprocess.run([
            "ffmpeg", "-y", "-i", input_path,
            "-metadata", f"copyright=\u00a9 {owner}",
            "-metadata", f"comment=ContentRedact-WorkID:{work_id}",
            "-codec", "copy", output_path
        ], capture_output=True, timeout=300)
        return result.returncode == 0
    except Exception as e:
        print(f"[Video Meta] {e}")
        return False


# ============================================================
# MAIN PIPELINE
# ============================================================
def process_and_protect(work_id: str, file_path: str, media_type: str, owner: str):
    print(f"\n{'='*50}")
    print(f"[Pipeline] Processing {work_id} ({media_type})")
    print(f"{'='*50}")

    try:
        # 1. Hash
        file_hash = sha256_of_file(file_path)
        print(f"[Pipeline] SHA-256: {file_hash[:20]}...")

        # 2. Fingerprint
        if media_type == "audio":
            fp = get_audio_fingerprint(file_path)
            if fp:
                db_save_fingerprint(work_id, "chromaprint", fp)
                print("[Pipeline] Audio fingerprint saved")
        else:
            fp = get_video_fingerprint(file_path)
            if fp:
                db_save_fingerprint(work_id, "phash", fp)
                print("[Pipeline] Video fingerprint saved")

        # 3. Transcribe
        transcript = transcribe_media(file_path)

        # 4. Scan for theft
        match_count = 0
        if transcript:
            match_count = scan_for_matches(work_id, transcript)
            print(f"[Pipeline] {match_count} matches found")

        # 5. Update work record in Supabase
        db_update_work(work_id, {
            "original_hash": file_hash,
            "transcript": transcript,
            "processing_status": "protected",
            "protected_at": datetime.now(timezone.utc).isoformat(),
        })

        print(f"[Pipeline] Complete!")

    except Exception as e:
        db_update_work(work_id, {"processing_status": "failed"})
        print(f"[Pipeline] ERROR: {e}")

    # 6. Delete all local files — only Supabase data remains
    for f in UPLOAD_DIR.glob(f"{work_id}*"):
        try:
            os.remove(f)
        except OSError:
            pass
    print(f"[Pipeline] Local files cleaned up")
    print(f"{'='*50}\n")


# ============================================================
# SCHEDULED SCANNER
# ============================================================
def run_scheduled_scans():
    print("\n[Scheduler] Starting periodic scan...")
    works = db_get_all_protected()
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
app = FastAPI(title="Content Redact API", version="3.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.get("/")
def health():
    return {"app": "Content Redact API", "version": "3.0", "ai": ai_client is not None, "scanning": apify_client is not None}


@app.post("/api/v1/works/protect")
async def protect_new_work(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    owner: str = "Default Owner",
):
    allowed = {"video/mp4": "video", "audio/mpeg": "audio", "audio/wav": "audio", "audio/x-wav": "audio", "audio/mp3": "audio"}
    media_type = allowed.get(file.content_type)
    if not media_type:
        raise HTTPException(400, f"Unsupported: {file.content_type}")

    work_id = str(uuid.uuid4())
    file_path = str(UPLOAD_DIR / f"{work_id}{Path(file.filename).suffix}")
    with open(file_path, "wb") as buf:
        shutil.copyfileobj(file.file, buf)

    # Look up user by email to link the work
    user = db_get_user_by_email(owner)
    user_id = user["id"] if user else None

    db_create_work({
        "id": work_id,
        "user_id": user_id,
        "title": file.filename,
        "media_type": media_type,
        "owner": owner,
    })

    background_tasks.add_task(process_and_protect, work_id, file_path, media_type, owner)
    return {"message": "Upload received.", "work_id": work_id, "status": "processing"}


@app.post("/api/v1/works/{work_id}/scan")
async def trigger_scan(work_id: str, background_tasks: BackgroundTasks):
    work = db_get_work(work_id)
    if not work:
        raise HTTPException(404, "Work not found")
    if not work.get("transcript"):
        raise HTTPException(400, "No transcript available")

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
        "protected_at": work.get("protected_at"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }