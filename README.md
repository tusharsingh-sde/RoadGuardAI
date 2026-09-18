<p align="center">
  <img src="https://img.shields.io/badge/YOLOv11-Pothole_Detection-00C853?style=for-the-badge&logo=opencv&logoColor=white" alt="YOLOv11" />
  <img src="https://img.shields.io/badge/FastAPI-Backend-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Next.js_16-Frontend-000000?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/Supabase-Auth_%26_Storage-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" />
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
</p>

<h1 align="center">🛣️ RoadGuard AI</h1>

<p align="center">
  <strong>AI-Powered Pothole Detection & Maintenance Cost Estimation System</strong>
  <br />
  Real-time road condition monitoring using YOLOv11, with automated PDF reporting and email alerts.
  <br /><br />
  <a href="https://github.com/tusharsingh-sde/RoadGuardAI">View Repository</a>
  ·
  <a href="https://github.com/tusharsingh-sde/RoadGuardAI/issues">Report Bug</a>
  ·
  <a href="https://github.com/tusharsingh-sde/RoadGuardAI/issues">Request Feature</a>
</p>

---

## 📋 Table of Contents

- [About the Project](#-about-the-project)
- [Key Features](#-key-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Getting Started](#-getting-started)
  - [1. Clone the Repository](#1-clone-the-repository)
  - [2. Supabase Setup](#2-supabase-setup)
  - [3. Configure Environment Variables](#3-configure-environment-variables)
  - [4A. Local Development (Without Docker)](#4a-local-development-without-docker)
  - [4B. Production Deployment (Docker Compose)](#4b-production-deployment-docker-compose)
- [API Reference](#-api-reference)
- [How Detection Works](#-how-detection-works)
- [Contributing](#-contributing)
- [License](#-license)
- [Acknowledgements](#-acknowledgements)

---

## 🔍 About the Project

**RoadGuard AI** is a full-stack pothole detection system that uses a custom-trained **YOLOv11** model to detect potholes in real time from live camera feeds (IP/USB/drone cameras, device browser cameras) or uploaded video files. The system estimates each pothole's **physical dimensions** (width, breadth, estimated depth) and calculates **maintenance repair costs** in INR. At the end of every detection session, a branded **PDF report** is automatically generated, uploaded to **Supabase Storage**, and emailed to the administrator.

Authentication is handled via **Supabase Auth** with domain-restricted access (configurable, defaults to `@miet.ac.in`), supporting both **Google OAuth** and **email/password** sign-in.

---

## ✨ Key Features

| Feature | Description |
|---|---|
| **🎯 Real-Time Detection** | Live pothole detection via IP cameras, USB cameras, drone feeds, or the device's built-in browser camera using WebSockets |
| **📹 Video Upload Analysis** | Batch analyze pre-recorded road survey videos (supports large 100MB+ files) |
| **📏 Dimension Estimation** | AI-estimated width, breadth, and depth for each detected pothole |
| **💰 Cost Estimation** | Per-pothole maintenance cost calculated using material volume + fixed labour cost |
| **🗺️ Satellite Map** | Live Leaflet satellite map with color-coded severity markers and reverse geocoding |
| **📊 Severity Classification** | Three-tier severity — **Critical** (≥85% confidence), **High** (≥75%), **Medium** (<75%) |
| **📄 PDF Reports** | Branded, per-pothole PDF reports with cropped images, dimensions, cost breakdown |
| **☁️ Cloud Storage** | Reports auto-uploaded to Supabase Storage with public download links |
| **📧 Email Alerts** | Rich HTML email with session summary + attached PDF sent automatically |
| **🔐 Domain-Restricted Auth** | Supabase Auth with Google OAuth + email/password, restricted to a configurable email domain |
| **🐳 Docker Ready** | Full Docker Compose setup with Caddy (HTTPS) + Nginx reverse proxy |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Browser                          │
│  Next.js 16 (Static Export) + Supabase Auth + Leaflet Map      │
└────────────┬──────────────────────────┬─────────────────────────┘
             │  WebSocket (frames)      │  REST (video upload)
             ▼                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Nginx (Port 100)                           │
│        Static files + reverse proxy to backend                 │
└────────────┬──────────────────────────┬─────────────────────────┘
             │  /ws/*                   │  /api/*
             ▼                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                FastAPI Backend (Port 8000)                      │
│   YOLOv11 inference · ByteTrack · PDF generation · Email       │
└────────────┬──────────────────────────┬─────────────────────────┘
             │                          │
             ▼                          ▼
     ┌──────────────┐         ┌──────────────────┐
     │  IP / USB /  │         │    Supabase      │
     │  Drone Cam   │         │  (Auth + Storage)│
     └──────────────┘         └──────────────────┘
```

---

## 🛠️ Tech Stack

### Backend

| Technology | Purpose |
|---|---|
| **Python 3.12** | Runtime |
| **FastAPI** | REST API + WebSocket server |
| **Ultralytics YOLOv11** | Object detection model |
| **OpenCV** | Video capture and image processing |
| **ByteTrack** | Multi-object tracking across frames |
| **ReportLab** | PDF report generation |
| **Supabase Python SDK** | Cloud storage for PDF reports |
| **smtplib** | SMTP email with HTML templates |
| **Gunicorn + Uvicorn** | Production ASGI server |

### Frontend

| Technology | Purpose |
|---|---|
| **Next.js 16** | React framework (static export mode) |
| **TypeScript** | Type-safe frontend code |
| **Tailwind CSS 4** | Utility-first styling |
| **Supabase JS SDK** | Authentication (Google OAuth + email/password) |
| **Leaflet + React-Leaflet** | Satellite map with pothole markers |
| **Nginx** | Static file serving + API/WebSocket reverse proxy |

### Infrastructure

| Technology | Purpose |
|---|---|
| **Docker Compose** | Multi-container orchestration |
| **Caddy** | Automatic HTTPS with Let's Encrypt |
| **nip.io** | DNS for VM public IP (development) |

---

## 📁 Project Structure

```
roadguard-email-auth/
├── backend/
│   ├── main.py                  # FastAPI app — all endpoints, YOLO inference, PDF, email
│   ├── pothole_best.pt          # Custom-trained YOLOv11 model weights
│   ├── requirements.txt         # Python dependencies (CPU-only PyTorch)
│   ├── Dockerfile               # Python 3.12-slim + system deps + model
│   ├── .env.example             # Backend environment template
│   ├── session_captures/        # Per-session pothole crop images (auto-created)
│   ├── session_reports/         # Generated PDF reports (auto-created)
│   └── temp_uploads/            # Temporary uploaded video files (auto-created)
│
├── frontend/
│   ├── app/
│   │   ├── page.tsx             # Main dashboard — live detection, history, uploads, reports
│   │   ├── login/page.tsx       # Authentication page (email/password + Google OAuth)
│   │   ├── PotholeMap.tsx       # Leaflet satellite map component
│   │   ├── layout.tsx           # Root layout with AuthProvider
│   │   └── globals.css          # Global styles
│   ├── lib/supabase/
│   │   ├── client.ts            # Supabase client singleton + domain validation
│   │   └── AuthProvider.tsx     # React context for auth state management
│   ├── supabase/sql/
│   │   └── restrict_email_domain.sql  # DB-level domain restriction trigger
│   ├── nginx.conf               # Nginx config for Docker (proxy + WebSocket)
│   ├── dockerfile               # Multi-stage build (Node → Nginx)
│   ├── .env.example             # Frontend environment template
│   ├── package.json             # Node dependencies
│   └── next.config.ts           # Static export configuration
│
├── docker-compose.yml           # Backend + Frontend + Caddy orchestration
├── Caddyfile                    # Reverse proxy with auto-HTTPS
├── .gitignore
└── README.md                    # ← You are here
```

---

## 📦 Prerequisites

Ensure the following are installed on your system before proceeding:

| Tool | Version | Installation |
|---|---|---|
| **Git** | Any recent | [git-scm.com](https://git-scm.com/downloads) |
| **Python** | 3.10 – 3.12 | [python.org](https://www.python.org/downloads/) |
| **Node.js** | 18+ (LTS recommended) | [nodejs.org](https://nodejs.org/) |
| **Docker** *(production only)* | 20+ | [docs.docker.com](https://docs.docker.com/get-docker/) |
| **Docker Compose** *(production only)* | v2+ | Included with Docker Desktop |

> **Supabase Account** — You'll need a free [Supabase](https://supabase.com/) project for authentication and PDF cloud storage.

---

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/tusharsingh-sde/RoadGuardAI.git
cd RoadGuardAI
```

---

### 2. Supabase Setup

1. Go to [supabase.com](https://supabase.com/) and create a new project.

2. **Enable Google OAuth:**
   - Navigate to **Authentication → Providers → Google**
   - Enable it and add your Google Cloud OAuth client ID and secret
   - Set the redirect URL to your app's domain (e.g., `http://localhost:3000` for local dev)

3. **Create a Storage Bucket:**
   - Go to **Storage** → Create a new bucket named `pothole-reports`
   - Set it to **Public** so report PDF links are accessible

4. **Apply Domain Restriction (Recommended):**
   - Go to **SQL Editor** → New Query
   - Paste the contents of [`frontend/supabase/sql/restrict_email_domain.sql`](frontend/supabase/sql/restrict_email_domain.sql) and run it
   - This ensures only `@miet.ac.in` accounts can sign up (change the domain in the SQL if needed)

5. **Create Session History Table (Optional):**
   - Run this SQL in the SQL Editor:
   ```sql
   CREATE TABLE session_history (
     id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     location_address TEXT,
     total_potholes INTEGER,
     estimated_cost NUMERIC,
     session_date TIMESTAMPTZ DEFAULT NOW()
   );
   ```

6. **Note down these values** (from **Project Settings → API**):
   - `Project URL` — e.g., `https://abcdefgh.supabase.co`
   - `anon/public key` — safe for browser use
   - `service_role key` — backend only, never expose to client

---

### 3. Configure Environment Variables

#### Backend (`backend/.env`)

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` with your values:

```env
# Supabase (PDF cloud storage)
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_KEY=your-supabase-service-role-key
SUPABASE_BUCKET=pothole-reports

# Email (Gmail recommended)
SENDER_EMAIL=your-app-email@gmail.com
SENDER_APP_PASSWORD=your-16-char-app-password
ADMIN_EMAIL=admin@example.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
```

> **Gmail App Password:** Go to [Google Account → Security → 2-Step Verification → App Passwords](https://myaccount.google.com/apppasswords) to generate one. Regular Gmail passwords will not work.

#### Frontend (`frontend/.env.local`)

```bash
cd ../frontend
cp .env.example .env.local
```

Edit `frontend/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN=miet.ac.in
```

---

### 4A. Local Development (Without Docker)

#### Backend Setup

<details>
<summary><strong>🪟 Windows</strong></summary>

```powershell
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
.\venv\Scripts\Activate.ps1

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Start the backend server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

</details>

<details>
<summary><strong>🍎 macOS</strong></summary>

```bash
cd backend

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Start the backend server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

</details>

<details>
<summary><strong>🐧 Linux (Ubuntu/Debian)</strong></summary>

```bash
# Install system dependencies (required for OpenCV)
sudo apt-get update
sudo apt-get install -y python3-venv libgl1 libglib2.0-0

cd backend

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Start the backend server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

</details>

The backend will be running at **`http://localhost:8000`**. You can verify by visiting `http://localhost:8000/docs` for the interactive Swagger UI.

#### Frontend Setup

<details>
<summary><strong>🪟 Windows / 🍎 macOS / 🐧 Linux</strong></summary>

```bash
cd frontend

# Install Node dependencies
npm install

# Start the dev server
npm run dev
```

</details>

The frontend will be running at **`http://localhost:3000`**.

> **Note:** In local development, the frontend automatically connects to the backend at `http://127.0.0.1:8000` — no proxy configuration needed.

---

### 4B. Production Deployment (Docker Compose)

This is the recommended approach for deploying to a cloud VM (Azure, AWS, GCP, etc.).

#### Step 1: Update the Caddyfile

Edit the `Caddyfile` and replace the IP address with your VM's public IP:

```
YOUR_VM_PUBLIC_IP.nip.io {
    reverse_proxy frontend:100
}
```

#### Step 2: Build and Start

```bash
docker compose up -d --build
```

This starts three containers:

| Container | Role | Port |
|---|---|---|
| `back-nitin` | FastAPI + YOLOv11 backend | Internal (8000) |
| `front-nitin` | Next.js static export via Nginx | Internal (100) |
| `caddy-nitin` | HTTPS reverse proxy | 80, 443 |

#### Step 3: Access the Application

Open your browser and navigate to:

```
https://YOUR_VM_PUBLIC_IP.nip.io
```

Caddy will automatically provision an HTTPS certificate via Let's Encrypt.

#### Useful Docker Commands

```bash
# View logs
docker compose logs -f backend
docker compose logs -f frontend

# Restart a specific service
docker compose restart backend

# Rebuild after code changes
docker compose up -d --build

# Stop everything
docker compose down
```

---

## 📡 API Reference

### WebSocket Endpoints

| Endpoint | Description |
|---|---|
| `ws://.../ws/drone-stream?email=user@example.com` | **Pull Model** — Backend connects to an IP/USB camera, runs YOLO inference, and streams annotated frames + detection data back over WebSocket |
| `ws://.../ws/device-stream?email=user@example.com` | **Push Model** — Client captures frames from the device's browser camera and sends them to the backend for inference; processed results are streamed back |

### REST Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/analyze-video?email=user@example.com` | Upload a video file for batch pothole analysis. Returns detection summary with per-pothole dimensions and costs |
| `GET` | `/api/v1/reports/{session_id}/status` | Poll the status of a session's PDF report (`processing`, `ready`, or `error`) |

### WebSocket Payload (Response)

```json
{
  "session_id": "a1b2c3d4e5f6",
  "image": "data:image/jpeg;base64,...",
  "count": 3,
  "critical": 1,
  "high": 1,
  "medium": 1,
  "session_total_maintenance_cost": 1250,
  "session_unique_potholes": 5,
  "detections": [
    {
      "id": 1,
      "confidence": 0.91,
      "width_cm": 28.4,
      "breadth_cm": 19.2,
      "depth_cm": 8.7,
      "volume_m3": 0.00475,
      "estimated_cost": 190
    }
  ]
}
```

---

## 🧠 How Detection Works

1. **Model:** A custom-trained YOLOv11 model (`pothole_best.pt`) detects potholes in each video frame with a confidence threshold of **60%**.

2. **Tracking:** [ByteTrack](https://github.com/ifzhang/ByteTrack) multi-object tracker ensures each physical pothole is counted only once across frames, assigning persistent track IDs.

3. **Dimension Estimation:**
   - Width & Breadth are derived from bounding box pixel dimensions × a configurable `CM_PER_PIXEL` ratio (default: `0.4`).
   - Depth is heuristically estimated using detection confidence and bounding box area.

4. **Cost Calculation:**
   ```
   Volume (m³) = (width_cm / 100) × (breadth_cm / 100) × (depth_cm / 100)
   Material Cost = Volume × ₹8,500/m³
   Total Cost = ₹150 (fixed labour) + Material Cost
   ```

5. **Severity Classification:**
   - **Critical:** Confidence ≥ 85%
   - **High:** Confidence ≥ 75%
   - **Medium:** Confidence < 75%

---

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'feat: add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

---

## 📄 License

This project is open source. See the repository for license details.

---

## 🙏 Acknowledgements

- [Ultralytics YOLOv11](https://github.com/ultralytics/ultralytics) — State-of-the-art object detection
- [FastAPI](https://fastapi.tiangolo.com/) — Modern Python web framework
- [Next.js](https://nextjs.org/) — React framework for production
- [Supabase](https://supabase.com/) — Open-source Firebase alternative
- [Leaflet](https://leafletjs.com/) — Interactive maps
- [ReportLab](https://www.reportlab.com/) — PDF generation
- [Caddy](https://caddyserver.com/) — Automatic HTTPS server
- [ByteTrack](https://github.com/ifzhang/ByteTrack) — Multi-object tracking

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/tusharsingh-sde">Tushar Singh</a>
</p>
