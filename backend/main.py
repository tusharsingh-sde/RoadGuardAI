import traceback
import math
import binascii
import re
import socket
import ipaddress
import cv2
import numpy as np
import os
import shutil
import time
import uuid
import base64
import asyncio
import threading
import smtplib
import json
from pathlib import Path
from urllib.parse import urlparse
from datetime import datetime
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email import encoders
from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect, HTTPException, Depends, Header, Query, status
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
from dotenv import load_dotenv
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage

load_dotenv()

SMTP_TIMEOUT_SECONDS = int(os.getenv("SMTP_TIMEOUT_SECONDS", "20"))
REPORT_TTL_HOURS = int(os.getenv("REPORT_TTL_HOURS", "24"))
REPORT_WORKERS = max(1, int(os.getenv("REPORT_WORKERS", "2")))

report_executor: ThreadPoolExecutor | None = None


def get_report_executor() -> ThreadPoolExecutor:
    global report_executor
    if report_executor is None:
        report_executor = ThreadPoolExecutor(
            max_workers=REPORT_WORKERS,
            thread_name_prefix="report-worker",
        )
    return report_executor


async def _periodic_cleanup_loop():
    while True:
        await asyncio.sleep(3600)  # Har 1 ghante mein expired files clean hon
        try:
            await asyncio.to_thread(cleanup_expired_files)
        except Exception as e:
            print(f"[Cleanup] Periodic cleanup error: {e}", flush=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    get_report_executor()
    await asyncio.to_thread(cleanup_expired_files)
    cleanup_task = asyncio.create_task(_periodic_cleanup_loop())
    try:
        yield
    finally:
        cleanup_task.cancel()
        try:
            await cleanup_task
        except asyncio.CancelledError:
            pass
        global report_executor
        if report_executor is not None:
            print("[Shutdown] Waiting for in-flight PDF/email report jobs to finish...", flush=True)
            report_executor.shutdown(wait=True)
            report_executor = None


app = FastAPI(title="RoadGuard AI Backend", version="1.0", lifespan=lifespan)

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

MODEL_PATH = "pothole_best.pt"
print("Loading YOLOv11 Model...", flush=True)
model = YOLO(MODEL_PATH)

os.makedirs("temp_uploads", exist_ok=True)

DRONE_IP_CAM_URL = "http://192.168.1.2:8080/video"

# ---------------------------------------------------------------------------
# MAINTENANCE COST ESTIMATION & INFERENCE CONFIG
# ---------------------------------------------------------------------------
CANONICAL_FRAME_WIDTH = 640.0
CM_PER_PIXEL = 0.4
MIN_DEPTH_CM = 3.0
MAX_DEPTH_CM = 25.0
COST_PER_CUBIC_METER_INR = 8500
FIXED_LABOR_COST_INR = 150

MAX_CONCURRENT_INFERENCE = max(1, int(os.getenv("MAX_CONCURRENT_INFERENCE", "2")))
INFERENCE_SEMAPHORE = threading.Semaphore(MAX_CONCURRENT_INFERENCE)
MAX_CAM_READ_FAILURES = 60  # ~3s at 0.05s sleep before closing dead IP cam


def create_session_model() -> YOLO:
    """Create an isolated YOLO instance per session so ByteTrack state never bleeds."""
    return YOLO(MODEL_PATH)


def estimate_pothole_dimensions(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    conf: float,
    frame_width: int = 640,
):
    # Normalize pixel dimensions to canonical 640px width so 4K & 640p produce consistent estimates
    scale = CANONICAL_FRAME_WIDTH / max(1.0, float(frame_width))
    width_px = max(1.0, (x2 - x1) * scale)
    breadth_px = max(1.0, (y2 - y1) * scale)

    width_cm = round(width_px * CM_PER_PIXEL, 1)
    breadth_cm = round(breadth_px * CM_PER_PIXEL, 1)
    area_px = width_px * breadth_px
    depth_cm = 3.0 + (conf ** 2) * 15.0 + (area_px / 6000.0)
    depth_cm = round(min(MAX_DEPTH_CM, max(MIN_DEPTH_CM, depth_cm)), 1)
    return width_cm, breadth_cm, depth_cm


def calculate_maintenance_cost(width_cm: float, breadth_cm: float, depth_cm: float):
    volume_m3 = (width_cm / 100.0) * (breadth_cm / 100.0) * (depth_cm / 100.0)
    material_cost = volume_m3 * COST_PER_CUBIC_METER_INR
    total_cost = round(FIXED_LABOR_COST_INR + material_cost)
    return total_cost, round(volume_m3, 5)


def compute_sighting_score(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    conf: float,
    frame_w: int,
    frame_h: int,
) -> float:
    """Prefer high-confidence, well-framed (non-border-clipped), larger sightings."""
    margin = 5.0
    is_clipped = x1 <= margin or y1 <= margin or x2 >= (frame_w - margin) or y2 >= (frame_h - margin)
    norm_area = ((max(1.0, x2 - x1) * max(1.0, y2 - y1)) / max(1.0, float(frame_w * frame_h)))
    base_score = conf * (1.0 + min(norm_area * 2.0, 0.5))
    return base_score * (0.6 if is_clipped else 1.0)


# ---------------------------------------------------------------------------
# SESSION REPORT (PDF) + SUPABASE STORAGE + EMAIL + SECURITY CONFIG
# ---------------------------------------------------------------------------
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_BUCKET = os.getenv("SUPABASE_BUCKET", "pothole-reports")

SENDER_EMAIL = os.getenv("SENDER_EMAIL")
SENDER_APP_PASSWORD = os.getenv("SENDER_APP_PASSWORD")
ADMIN_EMAIL = (os.getenv("ADMIN_EMAIL") or "").strip() or None
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))

REQUIRE_AUTH = os.getenv("REQUIRE_AUTH", "true").strip().lower() == "true"
ALLOWED_EMAIL_DOMAIN = (os.getenv("ALLOWED_EMAIL_DOMAIN") or "").strip().lower()
ALLOW_LOCAL_CAM = os.getenv("ALLOW_LOCAL_CAM", "false").strip().lower() == "true"
ALLOW_PRIVATE_CAM_IPS = os.getenv("ALLOW_PRIVATE_CAM_IPS", "false").strip().lower() == "true"
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "200"))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}
SESSION_ID_PATTERN = re.compile(r"^[a-f0-9]{12}$")

CAPTURES_DIR = "session_captures"
REPORTS_DIR = "session_reports"
os.makedirs(CAPTURES_DIR, exist_ok=True)
os.makedirs(REPORTS_DIR, exist_ok=True)

report_status = {}


def validate_session_id(session_id: str) -> str:
    if not SESSION_ID_PATTERN.fullmatch(session_id):
        raise HTTPException(status_code=400, detail="Invalid session_id format")
    return session_id


def _status_file_path(session_id: str) -> str:
    safe_id = validate_session_id(session_id)
    return os.path.join(REPORTS_DIR, f"{safe_id}.status.json")


def write_report_status(session_id: str, data: dict):
    safe_id = validate_session_id(session_id)
    report_status[safe_id] = data
    try:
        with open(_status_file_path(safe_id), "w") as f:
            json.dump(data, f)
    except Exception as e:
        print(f"[Report] failed to persist status file for {safe_id}: {e}", flush=True)


def read_report_status(session_id: str):
    safe_id = validate_session_id(session_id)
    path = _status_file_path(safe_id)
    if os.path.exists(path):
        try:
            with open(path) as f:
                return json.load(f)
        except Exception as e:
            print(f"[Report] failed to read status file for {safe_id}: {e}", flush=True)
    return report_status.get(safe_id)


supabase_client = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        from supabase import create_client
        supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"[Supabase] client init failed: {e}", flush=True)
else:
    print("[Supabase] SUPABASE_URL/SUPABASE_KEY not set in .env — PDF upload to cloud will be skipped.", flush=True)


async def verify_jwt_and_get_email(token: str | None) -> str | None:
    """Verify Supabase JWT and enforce optional email domain restriction."""
    if not REQUIRE_AUTH:
        return None
    if not supabase_client:
        raise HTTPException(status_code=503, detail="Auth service unavailable (Supabase not configured)")
    if not token:
        raise HTTPException(status_code=401, detail="Missing authentication token")

    try:
        user_resp = await asyncio.to_thread(supabase_client.auth.get_user, token)
        user = getattr(user_resp, "user", None)
        email = (getattr(user, "email", None) or "").strip().lower()
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired authentication token")

    if not email:
        raise HTTPException(status_code=401, detail="Authenticated user has no email")
    if ALLOWED_EMAIL_DOMAIN and not email.endswith(f"@{ALLOWED_EMAIL_DOMAIN}"):
        raise HTTPException(status_code=403, detail=f"Email domain restricted to @{ALLOWED_EMAIL_DOMAIN}")

    return email


async def require_http_user(authorization: str | None = Header(default=None)) -> str | None:
    if not REQUIRE_AUTH:
        return None
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization.split(" ", 1)[1].strip()
    return await verify_jwt_and_get_email(token)


def validate_camera_url(raw_url):
    """Prevent SSRF and local file reads via cv2.VideoCapture."""
    if isinstance(raw_url, int) or (isinstance(raw_url, str) and raw_url.strip().isdigit()):
        if not ALLOW_LOCAL_CAM:
            raise ValueError("Local USB/webcam index access is disabled on this server.")
        cam_idx = int(str(raw_url).strip())
        if not (0 <= cam_idx <= 4):
            raise ValueError("Camera index out of allowed range (0-4).")
        return cam_idx

    if not isinstance(raw_url, str) or not raw_url.strip():
        raise ValueError("Camera URL must be a non-empty string.")

    url = raw_url.strip()
    parsed = urlparse(url)
    if parsed.scheme.lower() not in {"http", "https", "rtsp", "rtsps"}:
        raise ValueError("Only http, https, rtsp, and rtsps camera streams are allowed.")
    if not parsed.hostname:
        raise ValueError("Camera URL must include a valid host.")

    try:
        addr_infos = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror:
        raise ValueError("Unable to resolve camera host.")

    for info in addr_infos:
        ip_obj = ipaddress.ip_address(info[4][0])
        if (
            ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_unspecified
            or ip_obj.is_multicast
            or ip_obj.is_reserved
        ):
            raise ValueError("Camera URL points to a blocked internal/metadata address.")
        if ip_obj.is_private and not ALLOW_PRIVATE_CAM_IPS:
            raise ValueError("Private network camera IPs are disabled on this server.")

    return url


print(
    f"[Config] Supabase configured: {bool(supabase_client)} | "
    f"Email configured: {bool(SENDER_EMAIL and SENDER_APP_PASSWORD)} | "
    f"ADMIN_EMAIL set: {bool(ADMIN_EMAIL)} | "
    f"REQUIRE_AUTH={REQUIRE_AUTH} | "
    f"ALLOWED_ORIGINS={ALLOWED_ORIGINS} | "
    f"SUPABASE_BUCKET={SUPABASE_BUCKET}",
    flush=True,
)


def save_pothole_context_crop(session_id: str, pothole_id, frame, x1, y1, x2, y2, margin_ratio: float = 0.6, min_margin_px: int = 30, max_width: int = 640):
    try:
        h, w = frame.shape[:2]
        bw, bh = max(1.0, x2 - x1), max(1.0, y2 - y1)
        pad_x = max(bw * margin_ratio, min_margin_px)
        pad_y = max(bh * margin_ratio, min_margin_px)

        cx1 = max(0, int(x1 - pad_x))
        cy1 = max(0, int(y1 - pad_y))
        cx2 = min(w, int(x2 + pad_x))
        cy2 = min(h, int(y2 + pad_y))
        if cx2 <= cx1 or cy2 <= cy1:
            return None

        crop = frame[cy1:cy2, cx1:cx2].copy()
        box_x1, box_y1 = int(x1 - cx1), int(y1 - cy1)
        box_x2, box_y2 = int(x2 - cx1), int(y2 - cy1)
        cv2.rectangle(crop, (box_x1, box_y1), (box_x2, box_y2), (0, 0, 255), 3)

        ch, cw = crop.shape[:2]
        if cw > max_width:
            scale = max_width / cw
            crop = cv2.resize(crop, (max_width, int(ch * scale)))

        session_dir = os.path.join(CAPTURES_DIR, str(session_id))
        os.makedirs(session_dir, exist_ok=True)
        crop_path = os.path.join(session_dir, f"{pothole_id}.jpg")
        cv2.imwrite(crop_path, crop, [cv2.IMWRITE_JPEG_QUALITY, 88])
        return crop_path
    except Exception as e:
        print(f"[Capture] failed to save context crop for pothole {pothole_id}: {e}", flush=True)
        return None


def build_pdf_report(session_id: str, pothole_list: list, source: str = "Live Drone Stream"):
    pdf_path = os.path.join(REPORTS_DIR, f"{session_id}.pdf")
    doc = SimpleDocTemplate(
        pdf_path, pagesize=A4,
        topMargin=1.2 * cm, bottomMargin=1.2 * cm,
        leftMargin=1.4 * cm, rightMargin=1.4 * cm,
    )

    ACCENT = colors.HexColor("#19e68c")
    DARK = colors.HexColor("#0b1a14")
    TEXT_DARK = colors.HexColor("#0f172a")
    MUTED = colors.HexColor("#64748b")
    BORDER = colors.HexColor("#e2e8f0")
    CARD_BG = colors.HexColor("#f8fafc")
    CRITICAL = colors.HexColor("#ff5252")
    HIGH = colors.HexColor("#ffb000")
    MEDIUM = colors.HexColor("#eab308")

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("BrandTitle", parent=styles["Title"], textColor=colors.white, fontSize=20, leading=24, spaceAfter=2)
    subtitle_style = ParagraphStyle("BrandSubtitle", parent=styles["Normal"], textColor=ACCENT, fontSize=10, leading=13)
    section_style = ParagraphStyle("Section", parent=styles["Heading2"], textColor=TEXT_DARK, fontSize=13, spaceBefore=6, spaceAfter=6)
    label_style = ParagraphStyle("StatLabel", parent=styles["Normal"], textColor=MUTED, fontSize=8.5)
    value_style = ParagraphStyle("StatValue", parent=styles["Normal"], textColor=TEXT_DARK, fontSize=16, leading=19, fontName="Helvetica-Bold")
    detail_style = ParagraphStyle("Detail", parent=styles["Normal"], textColor=TEXT_DARK, fontSize=9.5, leading=15)
    footer_style = ParagraphStyle("Footer", parent=styles["Normal"], textColor=MUTED, fontSize=8, alignment=1)

    story = []
    total_cost = sum(p.get("cost", 0) for p in pothole_list)

    def severity_for(conf):
        if conf is None: return "MEDIUM", MEDIUM
        if conf >= 0.85: return "CRITICAL", CRITICAL
        if conf >= 0.75: return "HIGH", HIGH
        return "MEDIUM", MEDIUM

    header_table = Table(
        [[Paragraph("RoadGuard AI", title_style),
          Paragraph(datetime.now().strftime("%d %b %Y, %I:%M %p"), subtitle_style)]],
        colWidths=[13 * cm, 5.5 * cm],
    )
    header_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), DARK),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("LEFTPADDING", (0, 0), (0, 0), 16),
        ("RIGHTPADDING", (1, 0), (1, 0), 16),
        ("TOPPADDING", (0, 0), (-1, -1), 16),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(header_table)

    subheader_table = Table(
        [[Paragraph(f"Pothole Maintenance Report &nbsp;•&nbsp; Session {session_id} &nbsp;•&nbsp; {source}", subtitle_style)]],
        colWidths=[18.5 * cm],
    )
    subheader_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), DARK),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
        ("LEFTPADDING", (0, 0), (-1, -1), 16),
    ]))
    story.append(subheader_table)
    story.append(Spacer(1, 16))

    stats_table = Table(
        [[
            Table([[Paragraph("TOTAL POTHOLES", label_style)], [Paragraph(str(len(pothole_list)), value_style)]], colWidths=[5.8 * cm]),
            Table([[Paragraph("TOTAL MAINTENANCE COST", label_style)], [Paragraph(f"Rs. {total_cost:,}", value_style)]], colWidths=[5.8 * cm]),
            Table([[Paragraph("REPORT SOURCE", label_style)], [Paragraph(source, detail_style)]], colWidths=[5.8 * cm]),
        ]],
        colWidths=[6.17 * cm, 6.17 * cm, 6.17 * cm],
    )
    stats_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
        ("BOX", (0, 0), (0, 0), 0.75, BORDER),
        ("BOX", (1, 0), (1, 0), 0.75, BORDER),
        ("BOX", (2, 0), (2, 0), 0.75, BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("LINEBELOW", (0, 0), (-1, -1), 3, ACCENT),
    ]))
    story.append(stats_table)
    story.append(Spacer(1, 22))

    story.append(Paragraph("Detected Potholes", section_style))
    story.append(Spacer(1, 4))

    if not pothole_list:
        story.append(Paragraph("No potholes were detected in this session.", detail_style))

    for p in pothole_list:
        image_path = p.get("image_path")
        cell_image = None
        if image_path and os.path.exists(image_path):
            try:
                from PIL import Image as PILImage
                with PILImage.open(image_path) as im:
                    iw, ih = im.size
                target_w = 5.2 * cm
                target_h = target_w * (ih / iw)
                max_h = 4.0 * cm
                if target_h > max_h:
                    target_h = max_h
                    target_w = target_h * (iw / ih)
                cell_image = RLImage(image_path, width=target_w, height=target_h)
            except Exception:
                cell_image = RLImage(image_path, width=5.2 * cm, height=3.5 * cm)
        if cell_image is None:
            cell_image = Paragraph("No Image<br/>Captured", detail_style)

        sev_label, sev_color = severity_for(p.get("confidence"))
        conf_pct = f"{p.get('confidence', 0) * 100:.1f}%" if p.get("confidence") is not None else "N/A"

        badge = Table([[Paragraph(f"<font color='white'><b>{sev_label}</b></font>", ParagraphStyle("Badge", fontSize=7.5, alignment=1))]], colWidths=[2.2 * cm])
        badge.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), sev_color), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))

        detail = Paragraph(
            f"<b>Pothole&nbsp;#{p.get('id')}</b> &nbsp;·&nbsp; Confidence {conf_pct}<br/>"
            f"<font color='#64748b'>Width</font> {p.get('width_cm', 'N/A')} cm &nbsp;&nbsp;"
            f"<font color='#64748b'>Breadth</font> {p.get('breadth_cm', 'N/A')} cm &nbsp;&nbsp;"
            f"<font color='#64748b'>Depth</font> {p.get('depth_cm', 'N/A')} cm<br/>"
            f"<font color='#0f8a56'><b>Maintenance Cost: Rs. {p.get('cost', 0)}</b></font>",
            detail_style,
        )

        inner = Table([[badge, ""]], colWidths=[2.3 * cm, 0.1 * cm])
        inner.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0)]))

        row_table = Table([[cell_image, [inner, Spacer(1, 4), detail]]], colWidths=[5.6 * cm, 12.2 * cm])
        row_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOX", (0, 0), (-1, -1), 0.75, BORDER),
            ("BACKGROUND", (0, 0), (-1, -1), colors.white),
            ("TOPPADDING", (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ("LEFTPADDING", (0, 0), (0, -1), 10),
            ("LEFTPADDING", (1, 0), (1, -1), 12),
            ("LINEBEFORE", (0, 0), (0, -1), 3, sev_color),
        ]))
        story.append(row_table)
        story.append(Spacer(1, 10))

    story.append(Spacer(1, 10))
    story.append(Paragraph("Generated automatically by RoadGuard AI — Pothole Detection & Maintenance Costing", footer_style))

    doc.build(story)
    return pdf_path, total_cost


def upload_pdf_to_supabase(pdf_path: str, session_id: str):
    if not supabase_client:
        return None
    remote_path = f"{session_id}.pdf"
    try:
        with open(pdf_path, "rb") as f:
            data = f.read()
        supabase_client.storage.from_(SUPABASE_BUCKET).upload(
            remote_path,
            data,
            {"content-type": "application/pdf", "upsert": "true"},
        )
        return supabase_client.storage.from_(SUPABASE_BUCKET).get_public_url(remote_path)
    except Exception as e:
        print(f"[Supabase] upload failed: {e}", flush=True)
        return None


def resolve_report_recipients(operator_email: str | None) -> list[str]:
    recipients: list[str] = []
    for addr in (operator_email, ADMIN_EMAIL):
        cleaned = (addr or "").strip()
        if cleaned and cleaned.lower() not in {r.lower() for r in recipients}:
            recipients.append(cleaned)
    return recipients


def send_report_email(pdf_path: str, session_id: str, total_cost, pothole_count: int, receiver_email: str | None, pdf_url: str = None):
    recipients = resolve_report_recipients(receiver_email)
    if not (SENDER_EMAIL and SENDER_APP_PASSWORD and recipients):
        print(
            f"[Email] Skipping: Sender({bool(SENDER_EMAIL)}) "
            f"AppPass({bool(SENDER_APP_PASSWORD)}) Recipients({len(recipients)})",
            flush=True,
        )
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = SENDER_EMAIL
        msg["To"] = recipients[0]
        if len(recipients) > 1:
            msg["Cc"] = ", ".join(recipients[1:])
        msg["Subject"] = f"RoadGuard AI Report — {pothole_count} potholes, Rs. {total_cost}"

        text_body = (
            f"New pothole detection session completed.\n\n"
            f"Session ID: {session_id}\n"
            f"Total Potholes Detected: {pothole_count}\n"
            f"Total Estimated Maintenance Cost: Rs. {total_cost}\n"
        )
        if pdf_url:
            text_body += f"\nCloud copy (Supabase): {pdf_url}\n"
        msg.attach(MIMEText(text_body, "plain", "utf-8"))

        cta_button = (
            f'<a href="{pdf_url}" target="_blank" '
            f'style="display:inline-block;padding:12px 22px;background-color:#19e68c;'
            f'color:#03120b;font-weight:700;text-decoration:none;border-radius:8px;'
            f'font-family:Arial,Helvetica,sans-serif;font-size:14px;">Open PDF Report ↗</a>'
            if pdf_url else
            '<p style="color:#64748b;font-family:Arial,Helvetica,sans-serif;font-size:13px;">'
            'Cloud storage not configured — PDF attached to this email only.</p>'
        )

        html_body = f"""\
<html>
  <head><meta charset="utf-8"/></head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="580" cellpadding="0" cellspacing="0"
                 style="background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr>
              <td style="background-color:#0b1a14;padding:24px 28px;">
                <span style="color:#19e68c;font-size:20px;font-weight:700;">🛣 RoadGuard AI</span><br/>
                <span style="color:#9fb0a8;font-size:12.5px;">Pothole Maintenance Report</span>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 28px 10px 28px;">
                <p style="color:#0f172a;font-size:14px;line-height:1.6;margin:0 0 18px 0;">
                  A pothole detection session has just completed. Summary below:
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;
                               padding:14px 18px;width:48%;">
                      <span style="display:block;color:#64748b;font-size:11px;letter-spacing:.04em;">TOTAL POTHOLES</span>
                      <span style="display:block;color:#0f172a;font-size:22px;font-weight:700;">{pothole_count}</span>
                    </td>
                    <td style="width:4%;"></td>
                    <td style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;
                               padding:14px 18px;width:48%;">
                      <span style="display:block;color:#64748b;font-size:11px;letter-spacing:.04em;">MAINTENANCE COST</span>
                      <span style="display:block;color:#0f8a56;font-size:22px;font-weight:700;">Rs. {total_cost:,}</span>
                    </td>
                  </tr>
                </table>
                <p style="color:#64748b;font-size:12.5px;margin:18px 0 4px 0;">Session ID: {session_id}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 28px 28px 28px;">
                {cta_button}
                <p style="color:#94a3b8;font-size:11.5px;margin-top:18px;line-height:1.5;">
                  The full report (per-pothole photo, dimensions & cost breakdown) is attached as a PDF
                  and also stored in the cloud link above.
                </p>
              </td>
            </tr>
            <tr>
              <td style="background-color:#f8fafc;padding:14px 28px;border-top:1px solid #e2e8f0;">
                <span style="color:#94a3b8;font-size:10.5px;">Generated automatically by RoadGuard AI</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        with open(pdf_path, "rb") as f:
            part = MIMEBase("application", "octet-stream")
            part.set_payload(f.read())
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", f"attachment; filename={session_id}.pdf")
        msg.attach(part)

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(SENDER_EMAIL, SENDER_APP_PASSWORD)
            server.send_message(msg, from_addr=SENDER_EMAIL, to_addrs=recipients)
        print(f"[Email] Sent successfully to {', '.join(recipients)}", flush=True)
        return True
    except Exception as e:
        print(f"[Email] sending failed: {e}", flush=True)
        return False


def cleanup_session_captures(session_id: str):
    """Remove per-session raw crop images once PDF generation finishes or is skipped."""
    try:
        safe_id = validate_session_id(session_id)
        session_dir = os.path.join(CAPTURES_DIR, safe_id)
        if os.path.isdir(session_dir):
            shutil.rmtree(session_dir, ignore_errors=True)
    except Exception as e:
        print(f"[Cleanup] failed to remove captures for {session_id}: {e}", flush=True)


def cleanup_expired_files():
    """Delete expired reports, status files, stray capture folders, and stale uploads."""
    now = time.time()
    report_cutoff = now - (REPORT_TTL_HOURS * 3600)
    upload_cutoff = now - (2 * 3600)  # Stray temp uploads older than 2h
    removed_files = 0

    # 1. Clean expired PDFs & status JSONs in session_reports/
    if os.path.isdir(REPORTS_DIR):
        for name in os.listdir(REPORTS_DIR):
            full_path = os.path.join(REPORTS_DIR, name)
            try:
                if os.path.isfile(full_path) and os.path.getmtime(full_path) < report_cutoff:
                    os.remove(full_path)
                    removed_files += 1
                    if name.endswith(".status.json"):
                        sid = name.removesuffix(".status.json")
                        report_status.pop(sid, None)
            except Exception as e:
                print(f"[Cleanup] failed to delete {full_path}: {e}", flush=True)

    # 2. Clean stray capture folders in session_captures/
    if os.path.isdir(CAPTURES_DIR):
        for name in os.listdir(CAPTURES_DIR):
            full_path = os.path.join(CAPTURES_DIR, name)
            try:
                if os.path.isdir(full_path) and os.path.getmtime(full_path) < report_cutoff:
                    shutil.rmtree(full_path, ignore_errors=True)
                    removed_files += 1
            except Exception as e:
                print(f"[Cleanup] failed to delete {full_path}: {e}", flush=True)

    # 3. Clean stale temp uploads in temp_uploads/
    if os.path.isdir("temp_uploads"):
        for name in os.listdir("temp_uploads"):
            full_path = os.path.join("temp_uploads", name)
            try:
                if os.path.isfile(full_path) and os.path.getmtime(full_path) < upload_cutoff:
                    os.remove(full_path)
                    removed_files += 1
            except Exception as e:
                print(f"[Cleanup] failed to delete {full_path}: {e}", flush=True)

    if removed_files > 0:
        print(f"[Cleanup] Removed {removed_files} expired artifact(s).", flush=True)


def process_session_report(session_id: str, pothole_list: list, source: str, receiver_email: str | None):
    try:
        pdf_path, total_cost = build_pdf_report(session_id, pothole_list, source=source)
        pdf_url = upload_pdf_to_supabase(pdf_path, session_id)
        email_sent = send_report_email(
            pdf_path,
            session_id,
            total_cost,
            len(pothole_list),
            receiver_email=receiver_email,
            pdf_url=pdf_url,
        )
        write_report_status(session_id, {
            "status": "ready",
            "pdf_url": pdf_url,
            "total_cost": total_cost,
            "pothole_count": len(pothole_list),
            "email_sent": email_sent,
            "error": None,
        })
        print(
            f"[Report] {session_id} ready. Potholes={len(pothole_list)} "
            f"Cost=Rs.{total_cost} EmailSent={email_sent} URL={pdf_url}",
            flush=True,
        )
    except Exception as e:
        print(f"[Report] generation failed for {session_id}: {e}", flush=True)
        traceback.print_exc()
        write_report_status(session_id, {"status": "error", "pdf_url": None, "error": str(e)})
    finally:
        cleanup_session_captures(session_id)


def schedule_session_report(
    session_id: str,
    pothole_list: list,
    source: str,
    verified_email: str | None,
):
    """Write explicit skipped status for 0-pothole sessions, otherwise queue PDF/email job."""
    if not pothole_list:
        write_report_status(session_id, {
            "status": "skipped",
            "reason": "No potholes detected in this session.",
            "pdf_url": None,
            "total_cost": 0,
            "pothole_count": 0,
            "email_sent": False,
            "error": None,
        })
        cleanup_session_captures(session_id)
        return

    try:
        write_report_status(session_id, {"status": "processing", "pdf_url": None, "error": None})
        get_report_executor().submit(
            process_session_report,
            session_id,
            pothole_list,
            source,
            verified_email,
        )
    except Exception as e:
        write_report_status(session_id, {"status": "error", "pdf_url": None, "error": str(e)})
        cleanup_session_captures(session_id)

# ---------------------------------------------------------------------------
# SYNC INFERENCE HELPERS (RUN VIA asyncio.to_thread TO KEEP EVENT LOOP FREE)
# ---------------------------------------------------------------------------
def open_video_capture(source):
    cap = cv2.VideoCapture(source)
    if cap.isOpened():
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return cap


def process_tracked_frame(
    session_model: YOLO,
    session_id: str,
    frame,
    session_pothole_data: dict,
    track_id_map: dict,
    id_prefix: str = "",
    frame_index: int | None = None,
    encode_frame: bool = True,
):
    frame_h, frame_w = frame.shape[:2]

    with INFERENCE_SEMAPHORE:
        results = session_model.track(
            frame,
            tracker="bytetrack.yaml",
            persist=True,
            conf=0.60,
            verbose=False,
        )

    annotated_frame = results[0].plot() if encode_frame else None

    detections = []
    critical, high, medium = 0, 0, 0
    boxes = results[0].boxes

    if boxes is not None:
        for box in boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            conf = float(box.conf[0])
            raw_track_id = int(box.id[0]) if box.id is not None else None

            if conf >= 0.85:
                critical += 1
            elif conf >= 0.75:
                high += 1
            else:
                medium += 1

            width_cm, breadth_cm, depth_cm = estimate_pothole_dimensions(
                x1, y1, x2, y2, conf, frame_width=frame_w
            )
            pothole_cost, volume_m3 = calculate_maintenance_cost(width_cm, breadth_cm, depth_cm)

            display_id = None
            if raw_track_id is not None:
                if raw_track_id not in track_id_map:
                    next_num = len(track_id_map) + 1
                    track_id_map[raw_track_id] = f"{id_prefix}{next_num}" if id_prefix else next_num
                display_id = track_id_map[raw_track_id]

                sighting_score = compute_sighting_score(x1, y1, x2, y2, conf, frame_w, frame_h)
                existing = session_pothole_data.get(display_id)
                is_first_sighting = existing is None
                # Hysteresis (+0.03) avoids unnecessary disk rewrites on tiny score jitter
                is_better_sighting = (
                    existing is not None and sighting_score > existing["best_score"] + 0.03
                )

                if is_first_sighting or is_better_sighting:
                    crop_path = save_pothole_context_crop(
                        session_id, display_id, frame, x1, y1, x2, y2
                    )
                    if crop_path is None and existing is not None:
                        crop_path = existing.get("image_path")

                    record = {
                        "id": display_id,
                        "confidence": conf,
                        "width_cm": width_cm,
                        "breadth_cm": breadth_cm,
                        "depth_cm": depth_cm,
                        "volume_m3": volume_m3,
                        "estimated_cost": pothole_cost,
                        "cost": pothole_cost,
                        "image_path": crop_path,
                        "best_score": sighting_score,
                    }
                    if frame_index is not None:
                        record["frame"] = frame_index
                    session_pothole_data[display_id] = record

            detections.append({
                "id": display_id,
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
                "confidence": conf,
                "width_cm": width_cm,
                "breadth_cm": breadth_cm,
                "depth_cm": depth_cm,
                "volume_m3": volume_m3,
                "estimated_cost": pothole_cost,
            })

    if not encode_frame:
        return detections

    _, buffer = cv2.imencode(".jpg", annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
    out_base64 = base64.b64encode(buffer).decode("utf-8")
    session_total_cost = sum(p["cost"] for p in session_pothole_data.values())

    return {
        "session_id": session_id,
        "image": f"data:image/jpeg;base64,{out_base64}",
        "count": len(detections),
        "critical": critical,
        "high": high,
        "medium": medium,
        "session_total_maintenance_cost": session_total_cost,
        "session_unique_potholes": len(session_pothole_data),
        "detections": detections,
    }


def decode_and_process_device_frame(
    session_model: YOLO,
    session_id: str,
    base64_str: str,
    session_pothole_data: dict,
    track_id_map: dict,
):
    _, encoded = base64_str.split(",", 1) if "," in base64_str else ("", base64_str)
    img_bytes = base64.b64decode(encoded, validate=True)
    np_arr = np.frombuffer(img_bytes, np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    if frame is None:
        return None
    return process_tracked_frame(
        session_model=session_model,
        session_id=session_id,
        frame=frame,
        session_pothole_data=session_pothole_data,
        track_id_map=track_id_map,
        encode_frame=True,
    )


def analyze_video_file(file_path: str, batch_session_id: str):
    cap = cv2.VideoCapture(file_path)
    if not cap.isOpened():
        raise ValueError("Could not decode uploaded video file.")

    session_model = create_session_model()
    session_pothole_data = {}
    track_id_map = {}

    try:
        raw_fps = cap.get(cv2.CAP_PROP_FPS)
        fps = raw_fps if (raw_fps and not math.isnan(raw_fps) and raw_fps > 0) else 30.0
        # ~3 FPS sampling keeps ByteTrack smooth across frames while preventing double-counting
        frame_skip = max(1, int(round(fps / 3.0)))

        frame_count = 0
        frames_analyzed = 0

        while cap.isOpened():
            success, frame = cap.read()
            if not success:
                break

            if frame_count % frame_skip == 0:
                frames_analyzed += 1
                process_tracked_frame(
                    session_model=session_model,
                    session_id=batch_session_id,
                    frame=frame,
                    session_pothole_data=session_pothole_data,
                    track_id_map=track_id_map,
                    id_prefix="B",
                    frame_index=frame_count,
                    encode_frame=False,
                )

            frame_count += 1
    finally:
        cap.release()
        session_model.predictor = None

    pothole_records = list(session_pothole_data.values())
    critical = sum(1 for p in pothole_records if p["confidence"] >= 0.85)
    high = sum(1 for p in pothole_records if 0.75 <= p["confidence"] < 0.85)
    medium = sum(1 for p in pothole_records if p["confidence"] < 0.75)
    total_maintenance_cost = sum(p["cost"] for p in pothole_records)

    # Internal list for PDF report (keeps image_path, strips best_score)
    report_records = [
        {k: v for k, v in p.items() if k != "best_score"}
        for p in pothole_records
    ]
    # Public API list (strips internal server image_path & best_score)
    public_records = [
        {k: v for k, v in p.items() if k not in {"best_score", "image_path"}}
        for p in pothole_records
    ]

    return {
        "frames_analyzed": frames_analyzed,
        "total_potholes": len(pothole_records),
        "severity_breakdown": {"critical": critical, "high": high, "medium": medium},
        "total_maintenance_cost": total_maintenance_cost,
        "report_records": report_records,
        "public_records": public_records,
    }


# ===========================================================================
# 1. PULL MODEL: WEBSOCKET FOR REAL-TIME IP STREAM / USB CAM
# ===========================================================================
@app.websocket("/ws/drone-stream")
async def drone_stream_websocket(websocket: WebSocket, token: str | None = Query(default=None)):
    try:
        verified_email = await verify_jwt_and_get_email(token)
    except HTTPException as exc:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason=exc.detail)
        return

    await websocket.accept()
    session_id = uuid.uuid4().hex[:12]

    try:
        init_data = await asyncio.wait_for(websocket.receive_json(), timeout=2.0)
        raw_camera_url = init_data.get("camera_url", DRONE_IP_CAM_URL)
    except Exception:
        raw_camera_url = DRONE_IP_CAM_URL

    try:
        camera_url = validate_camera_url(raw_camera_url)
    except ValueError as exc:
        await websocket.send_json({"error": str(exc)})
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    print(f"Connecting to Drone Camera Stream at: {camera_url} | session_id={session_id}", flush=True)
    cap = await asyncio.to_thread(open_video_capture, camera_url)

    if not cap.isOpened():
        await asyncio.to_thread(cap.release)
        await websocket.send_json({"error": "Failed to connect to IP Camera stream."})
        await websocket.close()
        return

    session_model = await asyncio.to_thread(create_session_model)
    session_pothole_data = {}
    track_id_map = {}
    consecutive_failures = 0

    try:
        while True:
            success, frame = await asyncio.to_thread(cap.read)
            if not success or frame is None:
                consecutive_failures += 1
                if consecutive_failures >= MAX_CAM_READ_FAILURES:
                    print(f"[DroneStream] Camera read timeout for session {session_id}.", flush=True)
                    await websocket.send_json({"error": "Camera stream disconnected or timed out."})
                    break
                await asyncio.sleep(0.05)
                continue

            consecutive_failures = 0
            payload = await asyncio.to_thread(
                process_tracked_frame,
                session_model,
                session_id,
                frame,
                session_pothole_data,
                track_id_map,
            )
            await websocket.send_json(payload)
            await asyncio.sleep(0.005)

    except WebSocketDisconnect:
        print("Frontend disconnected from Drone Stream.", flush=True)
    except Exception as e:
        print(f"Stream error: {e}", flush=True)
    finally:
        await asyncio.to_thread(cap.release)
        session_model.predictor = None
        pothole_list = [
            {k: v for k, v in p.items() if k != "best_score"}
            for p in session_pothole_data.values()
        ]
        total = sum(p["cost"] for p in pothole_list)
        print(f"Session {session_id} ended. Unique potholes: {len(pothole_list)} | Total cost: ₹{total}", flush=True)
        schedule_session_report(session_id, pothole_list, "Live IP Camera", verified_email)


# ===========================================================================
# 2. PUSH MODEL (NEW USP): WEBSOCKET FOR DEVICE BROWSER CAMERA
# ===========================================================================
@app.websocket("/ws/device-stream")
async def device_stream_websocket(websocket: WebSocket, token: str | None = Query(default=None)):
    try:
        verified_email = await verify_jwt_and_get_email(token)
    except HTTPException as exc:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason=exc.detail)
        return

    await websocket.accept()
    session_id = uuid.uuid4().hex[:12]
    print(f"Connecting to Device Browser Camera Stream | session_id={session_id}", flush=True)

    session_model = await asyncio.to_thread(create_session_model)
    session_pothole_data = {}
    track_id_map = {}

    try:
        while True:
            raw_text = await websocket.receive_text()
            try:
                data = json.loads(raw_text)
            except json.JSONDecodeError:
                print(f"[DeviceStream] Skipping malformed JSON frame in session {session_id}", flush=True)
                continue

            base64_str = data.get("frame") if isinstance(data, dict) else None
            if not isinstance(base64_str, str) or not base64_str:
                continue

            try:
                payload = await asyncio.to_thread(
                    decode_and_process_device_frame,
                    session_model,
                    session_id,
                    base64_str,
                    session_pothole_data,
                    track_id_map,
                )
            except (binascii.Error, ValueError) as exc:
                print(f"[DeviceStream] Skipping corrupt frame in session {session_id}: {exc}", flush=True)
                continue

            if payload is None:
                continue

            await websocket.send_json(payload)
    except WebSocketDisconnect:
        print("Frontend disconnected from Device Stream.", flush=True)
    except Exception as e:
        print(f"Device Stream error: {e}", flush=True)
    finally:
        session_model.predictor = None
        pothole_list = [
            {k: v for k, v in p.items() if k != "best_score"}
            for p in session_pothole_data.values()
        ]
        total = sum(p["cost"] for p in pothole_list)
        print(f"Device Session {session_id} ended. Unique potholes: {len(pothole_list)} | Total cost: ₹{total}", flush=True)
        schedule_session_report(session_id, pothole_list, "Local Device Browser Camera", verified_email)


# ===========================================================================
# 3. BATCH UPLOAD FOR LARGE 100MB+ RECORDED VIDEOS
# ===========================================================================
@app.post("/api/v1/analyze-video")
async def analyze_video(
    file: UploadFile = File(...),
    verified_email: str | None = Depends(require_http_user),
):
    original_name = Path(file.filename or "").name
    file_ext = Path(original_name).suffix.lower()
    if file_ext not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported video format '{file_ext or 'unknown'}'. Allowed: {', '.join(sorted(ALLOWED_VIDEO_EXTENSIONS))}",
        )
    if file.content_type and not (
        file.content_type.startswith("video/") or file.content_type == "application/octet-stream"
    ):
        raise HTTPException(status_code=400, detail=f"Invalid content type: {file.content_type}")

    unique_filename = f"{uuid.uuid4().hex}{file_ext}"
    file_path = os.path.join("temp_uploads", unique_filename)
    batch_session_id = uuid.uuid4().hex[:12]

    total_bytes = 0
    chunk_size = 1024 * 1024  # 1 MB chunks
    try:
        with open(file_path, "wb") as buffer:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Video exceeds maximum allowed size of {MAX_UPLOAD_MB} MB.",
                    )
                buffer.write(chunk)

        if total_bytes == 0:
            raise HTTPException(status_code=400, detail="Uploaded video file is empty.")

        try:
            analysis = await asyncio.to_thread(analyze_video_file, file_path, batch_session_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)

    report_records = analysis["report_records"]
    schedule_session_report(batch_session_id, report_records, "Batch Video Upload", verified_email)

    return {
        "status": "success",
        "session_id": batch_session_id,
        "total_frames_analyzed": analysis["frames_analyzed"],
        "total_potholes": analysis["total_potholes"],
        "severity_breakdown": analysis["severity_breakdown"],
        "estimated_cost_inr": analysis["total_maintenance_cost"],
        "pothole_dimensions": analysis["public_records"],
    }

# ===========================================================================
# 4. REPORT STATUS API
# ===========================================================================
@app.get("/api/v1/reports/{session_id}/status")
async def get_report_status(
    session_id: str,
    _: str | None = Depends(require_http_user),
):
    safe_id = validate_session_id(session_id)
    status_data = read_report_status(safe_id)
    if not status_data:
        raise HTTPException(status_code=404, detail="Report status not found")
    return status_data


# ===========================================================================
# 5. HEALTH & READINESS CHECKS
# ===========================================================================
@app.get("/health")
@app.get("/api/v1/health")
def health_check():
    return {"status": "ok"}


@app.get("/ready")
@app.get("/api/v1/ready")
def readiness_check():
    if model is None:
        raise HTTPException(status_code=503, detail="YOLO model not loaded")
    return {
        "status": "ready",
        "model_loaded": True,
        "supabase_configured": bool(supabase_client),
        "email_configured": bool(SENDER_EMAIL and SENDER_APP_PASSWORD),
    }
