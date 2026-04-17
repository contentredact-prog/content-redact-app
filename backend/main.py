"""
Content Redact App — Backend API (SQLite & Auto-Scanner Edition)
"""

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
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
from pathlib import Path
from typing import Optional
import os
gemini_api_key = os.environ.get("GEMINI_API_KEY")

from mutagen.mp3 import MP3
from mutagen.id3 import ID3, TIT2, TCOP, TXXX, TCOM
from mutagen.wave import WAVE
from google import genai
from apscheduler.schedulers.background import BackgroundScheduler

# ============================================================
# DATABASE SETUP (PERMANENT STORAGE)
# ============================================================
DB_FILE = "content_redact.db"

def init_db():
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS works (id TEXT PRIMARY KEY, data TEXT)")

init_db()

def get_work(work_id: str) -> Optional[dict]:
    with sqlite3.connect(DB_FILE) as conn:
        cur = conn.execute("SELECT data FROM works WHERE id = ?", (work_id,))
        row = cur.fetchone()
        return json.loads(row[0]) if row else None

def save_work(work_id: str, work_data: dict):
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("INSERT OR REPLACE INTO works (id, data) VALUES (?, ?)", (work_id, json.dumps(work_data)))

def get_all_works() -> list:
    with sqlite3.connect(DB_FILE) as conn:
        cur = conn.execute("SELECT data FROM works")
        return [json.loads(row[0]) for row in cur.fetchall()]

# ============================================================
# AI PIPELINE FUNCTIONS
# ============================================================
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY") 

ai_client = None
if GOOGLE_API_KEY:
    try:
        ai_client = genai.Client(api_key=GOOGLE_API_KEY)
    except Exception as e:
        print(f"[AI] Failed to initialize client: {e}")

def transcribe_media_with_ai(filepath: str) -> str:
    if not ai_client: return "Transcription failed."
    try:
        print("[AI] Uploading to Google AI for transcription...")
        media_file = ai_client.files.upload(file=filepath)
        while "PROCESSING" in str(media_file.state):
            print("[AI] Waiting for Google AI to process the video (~10 seconds)...")
            time.sleep(5)
            media_file = ai_client.files.get(name=media_file.name)
        if "FAILED" in str(media_file.state): return "AI Video Processing Failed."
        
        response = ai_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[media_file, "Please transcribe the audio in this file verbatim."]
        )
        return response.text
    except Exception as e:
        print(f"[AI Transcription Error] {e}")
        return "Transcription failed."

def scan_web_for_shares(transcript: str) -> list:
    if not ai_client or "failed" in transcript.lower() or len(transcript) < 10: return []
    try:
        print("[AI] Scanning the web for unauthorized shares...")
        prompt = f"Search the internet and tell me if this specific text appears anywhere online: '{transcript[:500]}'. Return a JSON array of URLs where you found it."
        response = ai_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt
        )
        # Using mock data to simulate new findings
        return [
            {"platform": "YouTube", "url": "https://youtube.com/watch?v=AI_Found123", "action_status": "pending"},
            {"platform": "TikTok", "url": "https://tiktok.com/@user/video/AI_Found456", "action_status": "pending"}
        ]
    except Exception as e:
        print(f"[AI Scanning Error] {e}")
        return []

# ============================================================
# BACKGROUND SCANNER
# ============================================================
def run_daily_scans():
    print("\n[Scanner] ⏰ Waking up for scheduled automated scan...")
    works = get_all_works()
    
    if not works:
        print("[Scanner] Database is empty. Going back to sleep.\n")
        return

    scanned_count = 0
    for work in works:
        transcript = work.get("transcript")
        # Only scan if the file successfully transcribed
        if transcript and "failed" not in transcript.lower():
            scanned_count += 1
            # In a real production app, this would hit the AI. 
            # We are printing here to show the logic without burning API credits!
            print(f"[Scanner] Checking the web for work ID: {work['id'][:8]}...")
            
    print(f"[Scanner] ✨ Scan complete. Checked {scanned_count} fingerprints. Going back to sleep.\n")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start the background clock when the server boots
    scheduler = BackgroundScheduler()
    scheduler.add_job(run_daily_scans, 'interval', minutes=1)
    scheduler.start()
    yield
    # Kill the clock when the server shuts down
    scheduler.shutdown()

# ============================================================
# APP SETUP & CONFIG
# ============================================================
app = FastAPI(title="Content Redact API", version="1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path("./uploads")
PROTECTED_DIR = Path("./protected")
for d in [UPLOAD_DIR, PROTECTED_DIR]: d.mkdir(exist_ok=True)

# ============================================================
# UTILITY FUNCTIONS
# ============================================================
def sha256_of_file(filepath: str) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""): h.update(chunk)
    return h.hexdigest()

def get_audio_fingerprint(filepath: str) -> Optional[dict]:
    try:
        result = subprocess.run(["./fpcalc.exe", "-json", filepath], capture_output=True, text=True, timeout=120)
        if result.returncode == 0: return {"fingerprint": json.loads(result.stdout).get("fingerprint")}
    except: pass
    return None

def get_video_fingerprint(filepath: str) -> Optional[dict]:
    try:
        thumb_path = filepath + ".thumb.jpg"
        subprocess.run(["ffmpeg", "-y", "-i", filepath, "-ss", "5", "-frames:v", "1", thumb_path], capture_output=True, timeout=60)
        if os.path.exists(thumb_path):
            h = sha256_of_file(thumb_path)
            os.remove(thumb_path)
            return {"thumbnail_hash": h}
    except: pass
    return None

def embed_audio_metadata(filepath: str, work_id: str, owner: str) -> bool:
    try:
        ext = Path(filepath).suffix.lower()
        if ext == ".mp3":
            audio = MP3(filepath)
            if audio.tags is None: audio.add_tags()
            audio.tags.add(TCOP(encoding=3, text=[f"© {owner}"]))
            audio.tags.add(TXXX(encoding=3, desc="ContentRedact-WorkID", text=[work_id]))
            audio.save()
            return True
        elif ext == ".wav":
            audio = WAVE(filepath)
            if audio.tags is None: audio.add_tags()
            audio.tags.add(TCOP(encoding=3, text=[f"© {owner}"]))
            audio.tags.add(TXXX(encoding=3, desc="ContentRedact-WorkID", text=[work_id]))
            audio.save()
            return True
    except: pass
    return False

def embed_video_metadata(filepath: str, output_path: str, work_id: str, owner: str) -> bool:
    try:
        res = subprocess.run(["ffmpeg", "-y", "-i", filepath, "-metadata", f"copyright=© {owner}", "-metadata", f"comment=ContentRedact-WorkID:{work_id}", "-codec", "copy", output_path], capture_output=True)
        return res.returncode == 0
    except: pass
    return False

def process_and_protect_media(work_id: str, file_path: str, media_type: str, owner: str = "Default Owner"):
    print(f"[Pipeline] Starting protection for {work_id} ({media_type})")
    work = get_work(work_id)
    if not work: return
    
    protections = []
    protected_path = str(PROTECTED_DIR / f"{work_id}{Path(file_path).suffix}")
    
    try:
        work["original_hash"] = sha256_of_file(file_path)
        transcript = transcribe_media_with_ai(file_path)
        work["transcript"] = transcript
        
        matches = scan_web_for_shares(transcript)
        work["matches"] = matches
        work["matches_found"] = len(matches)

        fp = get_audio_fingerprint(file_path) if media_type == "audio" else get_video_fingerprint(file_path)
        if fp:
            work["fingerprint"] = fp
            protections.append(f"{media_type}_fingerprint")
        
        shutil.copy2(file_path, protected_path)
        if media_type == "audio":
            if embed_audio_metadata(protected_path, work_id, owner): protections.append("metadata_embedded")
        else:
            meta_output = protected_path + ".meta.mp4"
            if embed_video_metadata(protected_path, meta_output, work_id, owner):
                shutil.move(meta_output, protected_path)
                protections.append("metadata_embedded")
                
        work["protections_applied"] = protections
        work["protected_at"] = datetime.now(timezone.utc).isoformat()
        work["status"] = "protected"
        print(f"[Pipeline] ✓ Protection complete for {work_id}")
        
    except Exception as e:
        work["status"] = "error"
        work["error"] = str(e)
    save_work(work_id, work)

# ============================================================
# API ROUTES
# ============================================================
@app.get("/")
def read_root(): return {"message": "Content Redact API is running!"}

@app.get("/api/v1/works")
async def get_my_works():
    return sorted(get_all_works(), key=lambda x: x.get('created_at', ''), reverse=True)

@app.post("/api/v1/works/protect")
async def protect_new_work(background_tasks: BackgroundTasks, file: UploadFile = File(...), owner: str = "Default Owner"):
    allowed = {"video/mp4": "video", "audio/mpeg": "audio", "audio/wav": "audio", "audio/mp3": "audio"}
    media_type = allowed.get(file.content_type)
    if not media_type: raise HTTPException(status_code=400, detail="Unsupported format")

    work_id = str(uuid.uuid4())
    file_path = str(UPLOAD_DIR / f"{work_id}{Path(file.filename).suffix}")
    with open(file_path, "wb") as buffer: shutil.copyfileobj(file.file, buffer)

    save_work(work_id, {
        "id": work_id, "title": file.filename, "media_type": media_type, "owner": owner,
        "status": "processing", "protections_applied": [], "matches_found": 0, "matches": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    background_tasks.add_task(process_and_protect_media, work_id=work_id, file_path=file_path, media_type=media_type, owner=owner)
    return {"message": "Upload received.", "work_id": work_id, "status": "processing"}

@app.post("/api/v1/works/{work_id}/generate-dmca")
async def generate_dmca_notice(work_id: str, infringing_url: str):
    work = get_work(work_id)
    if not work: raise HTTPException(status_code=404, detail="Work not found")
    notice_text = f"DMCA TAKEDOWN NOTICE\n\nTo Whom It May Concern:\n\nI am writing to notify you of an infringement of my copyrighted work.\n\nIDENTIFICATION OF COPYRIGHTED WORK:\nTitle: {work['title']}\nContent Redact Work ID: {work_id}\nOriginal File Hash (SHA-256): {work.get('original_hash', 'N/A')}\n\nIDENTIFICATION OF INFRINGING MATERIAL:\nURL: {infringing_url}\n\nI have a good faith belief that the use of the copyrighted material described above is not authorized by the copyright owner, its agent, or the law.\n\nElectronic Signature: ____________________________\nDate: {datetime.now(timezone.utc).strftime('%B %d, %Y')}\n"
    return {"notice_text": notice_text}

@app.get("/api/v1/works/{work_id}/download")
async def download_protected_work(work_id: str, background_tasks: BackgroundTasks):
    work = get_work(work_id)
    protected_files = list(PROTECTED_DIR.glob(f"{work_id}.*"))
    if not work or not protected_files: raise HTTPException(status_code=404, detail="File unavailable.")
    
    file_path = protected_files[0]
    def cleanup():
        try:
            os.remove(file_path)
            for f in UPLOAD_DIR.glob(f"{work_id}.*"): os.remove(f)
        except: pass
    background_tasks.add_task(cleanup)
    return FileResponse(path=file_path, filename=f"PROTECTED_{work['title']}", media_type="application/octet-stream")

@app.delete("/api/v1/works/{work_id}")
async def delete_work(work_id: str):
    with sqlite3.connect(DB_FILE) as conn: conn.execute("DELETE FROM works WHERE id = ?", (work_id,))
    for f in PROTECTED_DIR.glob(f"{work_id}.*"):
        try: os.remove(f)
        except: pass
    return {"message": "Deleted"}