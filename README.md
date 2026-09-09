# 🛣️ RoadGuard AI

### AI-Powered Smart Pothole Detection & Road Condition Management System

RoadGuard AI is an AI-powered road inspection and management platform designed to automate pothole detection, assess road conditions, estimate repair costs, and generate actionable inspection reports for authorities.

The system combines **Computer Vision, Real-Time Video Processing, Geospatial Mapping, Cloud Database Infrastructure, Automated Reporting, and Production-Ready Deployment** into a unified platform.

> Built with the goal of making road inspection faster, more data-driven, and easier to manage at scale.

---

## Overview

Traditional road inspection processes are often dependent on manual surveys, which can be time-consuming, inconsistent, and difficult to scale across large road networks.

**RoadGuard AI** addresses this problem by using AI-based computer vision to automatically identify potholes from live camera or drone feeds and associate detected road defects with their geographic locations.

The platform can then:

- Detect potholes in real time
- Track detected potholes geographically
- Reverse-geocode locations into readable street addresses
- Estimate potential repair costs
- Classify road damage using severity metrics
- Generate detailed PDF inspection reports
- Automatically send reports to relevant authorities
- Maintain historical inspection data through a cloud-backed dashboard

---

# Problem Statement

Road infrastructure requires continuous monitoring and maintenance. However, conventional inspection methods can involve:

- Manual road surveys
- Delayed identification of road damage
- Difficulty maintaining historical inspection records
- Lack of centralized geographical information
- Limited automation in reporting and communication
- Difficulty estimating maintenance requirements efficiently

These limitations can make road monitoring slower and less scalable.

### RoadGuard AI aims to solve this by creating an automated digital pipeline:

**Road Feed → AI Detection → Location Mapping → Severity Assessment → Cost Estimation → Report Generation → Authority Notification**

---

# Our Solution

RoadGuard AI uses a custom-trained **YOLO-based Computer Vision model** to identify potholes from camera and drone footage.

Once a pothole is detected, the system can associate it with GPS coordinates, display it on an interactive map, generate a readable address using reverse geocoding, and record the inspection information for future reference.

The collected information can then be transformed into a structured PDF report containing inspection details, severity information, location data, and estimated repair costs.

The generated report can also be automatically dispatched to relevant authorities through email.

---

# ✨ Key Features

### 🔴 1. Real-Time Pothole Detection

Detect potholes directly from live camera or drone feeds using custom-trained YOLO Computer Vision models.

#### Capabilities

- Real-time video processing
- AI-powered pothole detection
- Bounding-box based detection
- Continuous road monitoring
- Support for camera/drone-based inspection workflows

---

### 🗺️ 2. Interactive Road Inspection Mapping

Detected potholes can be visualized geographically through an interactive map interface powered by **Leaflet**.

The mapping system provides:

- Live GPS tracking
- Detection location visualization
- Interactive map markers
- Satellite map support
- Reverse geocoding
- Readable street-address generation

This allows inspection teams to move from:

**"Pothole detected"**

to:

**"Pothole detected at a specific geographical location/address."**

---

### 📊 3. Severity Assessment

RoadGuard AI incorporates severity-related metrics into its inspection workflow.

This allows detected road damage to be represented in a structured manner rather than simply treating every pothole as identical.

> Severity calculation and classification logic can be expanded as the inspection model evolves.

---

### 💰 4. Repair Cost Estimation

The platform generates estimated repair costs associated with detected road damage.

This helps transform raw detection data into information that can potentially support:

- Maintenance planning
- Budget estimation
- Inspection reports
- Infrastructure prioritization

---

### 📄 5. Automated PDF Reports

RoadGuard AI can automatically generate detailed inspection reports in PDF format.

Reports can contain information such as:

- Detection details
- Road condition information
- Location
- Address
- Severity metrics
- Estimated repair cost

This reduces the need for manually preparing inspection documentation.

---

### 📧 6. Automated Email Reporting

Generated inspection reports can be automatically sent to relevant authorities using SMTP-based email integration.

The workflow can therefore move from:

**Detection → Report Generation → Email Dispatch**

without requiring manual report sharing.

---

### 🗄️ 7. Session History

RoadGuard AI maintains historical inspection information through a cloud-backed dashboard.

Historical records can include:

- Previous detections
- Detection locations
- Estimated costs
- Inspection history

The system uses **Supabase** for cloud database infrastructure and storage.

---

### 🔒 8. Production-Ready Deployment

The application is containerized using Docker and configured for production deployment.

The deployment architecture includes:

- Docker Compose
- Nginx reverse proxy
- Caddy
- Automatic HTTPS/SSL provisioning
- Microsoft Azure VM deployment

This enables the application to run consistently across local development and cloud environments.

---

## How RoadGuard AI Works

```text
                ┌─────────────────────┐
                │ Camera / Drone Feed │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │ YOLO Object         │
                │ Detection Model     │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │ Pothole Detection   │
                │ & Analysis          │
                └──────────┬──────────┘
                           │
                  ┌────────┴────────┐
                  │                 │
                  ▼                 ▼
        ┌─────────────────┐   ┌─────────────────┐
        │ GPS Coordinates │   │ Severity / Cost │
        └────────┬────────┘   │ Estimation      │
                 │            └────────┬────────┘
                 ▼                     │
        ┌─────────────────┐             │
        │ Reverse         │             │
        │ Geocoding       │             │
        └────────┬────────┘             │
                 │                     │
                 └──────────┬──────────┘
                            ▼
                 ┌─────────────────────┐
                 │ Supabase / Session  │
                 │ History             │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │ PDF Report          │
                 │ Generation          │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │ Email Dispatch      │
                 │ to Authorities      │
                 └─────────────────────┘
```

## Tech Stack
| Layer                    | Technologies                                |
| ------------------------ | ------------------------------------------- |
| **Frontend**             | Next.js, React, Tailwind CSS, React-Leaflet |
| **Backend**              | FastAPI, Python                             |
| **Computer Vision**      | YOLO, OpenCV                                |
| **Database**             | Supabase PostgreSQL                         |
| **Storage**              | Supabase Storage                            |
| **Mapping**              | Leaflet / React-Leaflet                     |
| **Email**                | SMTP                                        |
| **Containerization**     | Docker, Docker Compose                      |
| **Reverse Proxy**        | Nginx                                       |
| **HTTPS / SSL**          | Caddy                                       |
| **Cloud Infrastructure** | Microsoft Azure VM                          |

## Project Structure
```text
RoadGuardAI/
│
├── frontend/
│   └── # Next.js web application
│
├── backend/
│   └── # FastAPI server & YOLO ML models
│
├── docker-compose.yml
│   └── # Multi-container orchestration
│
├── nginx.conf
│   └── # Reverse proxy configuration
│
├── Caddyfile
│   └── # Automatic HTTPS/SSL configuration
│
└── README.md
```

## Getting Started
Follow the steps below to run RoadGuard AI locally.

### Prerequisites
Make sure the following are installed on your system:

- Node.js
- npm
= Python 3.x
- Git
- Docker & Docker Compose (required for containerized deployment)

## 1️⃣ Clone the Repository
```bash
git clone https://github.com/tusharsingh-sde/RoadGuardAI.git
cd RoadGuardAI
```
## 2️⃣ Frontend Setup
Navigate to the frontend directory:
```bash
cd frontend
```
Install dependencies
```bash
npm install
```
Create a .env.local file in the frontend directory.

Add the required Supabase configuration:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```
Then start the development server:
```bash
npm run dev
```
The frontend will start in development mode.

## 3️⃣ Backend Setup
Open a new terminal and navigate to the backend:
```bash
cd backend
```
Create a Python virtual environment:
```bash
python -m venv venv
```
Activate venv
```bash
venv\Scripts\activate
```
Install the required Python dependencies:
```bash
pip install -r requirements.txt
```
Create a .env file inside the backend directory.

Add the required configuration for:

-Supabase
-SMTP
- Other backend environment variables required by the application

example:
```env
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key

SMTP_HOST=your_smtp_host
SMTP_PORT=your_smtp_port
SMTP_USER=your_email
SMTP_PASSWORD=your_app_password
```
--Do not commit .env or .env.local files to GitHub.

Start the FastAPI server:
```bash
uvicorn main:app --reload
```

## 🔐 Environment Variables

RoadGuard AI uses environment variables to keep credentials and configuration separate from source code.

#### frontend
```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

#### backend
```env
SUPABASE_URL=
SUPABASE_KEY=

SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
```
⚠️ The exact environment variables required may depend on the current implementation of the project.

Never expose:

-Database passwords
-SMTP passwords
-API secrets
-Service-role keys
-Private credentials

in the public repository.

## 🚀 Production Deployment

RoadGuard AI is designed to support containerized deployment on cloud infrastructure such as Microsoft Azure VM.

The production setup uses:
```text
Internet
   │
   ▼
 Caddy
   │
   ▼
 Nginx
   │
   ├──────────────► Frontend
   │
   └──────────────► Backend
                         │
                         ▼
                     Supabase
```
### 1️⃣ Configure Caddy

Update the Caddyfile with the public address of your Azure VM.

Example:
```
<your-vm-ip>.nip.io
```
Replace the placeholder with your actual deployment address.

### 2️⃣ Build the Containers

From the project root:
```
docker compose down
```
Build the containers:
```
docker compose build --no-cache
```
Start the application:
```
docker compose up -d
```
## 3️⃣ Verify Running Containers

Use:
```bash
docker compose ps
```
To inspect logs:
```bash
docker compose logs
```
For a specific service:
```bash
docker compose logs <service-name>
```

## 🔒 HTTPS & Secure Deployment

Caddy is used to handle automatic HTTPS/SSL provisioning in the production deployment.

This provides a secure HTTPS endpoint for the application and enables browser features such as camera access that require a secure context.

The production stack uses:

- Caddy → HTTPS / SSL
- Nginx → Reverse proxy
- Docker → Application containers
- Azure VM → Cloud infrastructure

### 🎯 Use Cases
- RoadGuard AI can be used as a foundation for automated road inspection workflows involving:


### 🛣️ Road Infrastructure Monitoring
- Automated identification and documentation of potholes across road networks.
  

### 🏛️ Government & Municipal Inspections
- Assist inspection teams by converting road survey data into structured reports.


### 🚁 Drone-Based Road Surveys
- Analyze aerial road footage to identify road defects over larger areas.


### 📊 Maintenance Planning
-Use historical detection and cost information to support road maintenance planning.


### 🗺️ Geographic Road-Damage Analysis
- Visualize road defects geographically to understand where maintenance issues are concentrated.

 
## 🔮 Future Roadmap
Potential future improvements include:

- Improved pothole severity classification
- More detailed road-condition analytics
- Advanced maintenance prioritization
- Expanded geospatial analytics
- Historical trend visualization
- Improved cost estimation models
- Large-scale road network monitoring
- Additional computer vision models
- Mobile-based inspection support
- More granular authority workflows

The roadmap is subject to change as the project evolves.

# 👥 Contributors
## Tushar Singh
- Full Stack & AI Integration
Responsible for application development, AI integration, backend/frontend integration, and overall system implementation.

## Nitin Panwar
- DevOps & Deployment
Responsible for deployment infrastructure and production setup.

## 🤝 Contributing
Contributions, suggestions, and improvements are welcome.

#### 1. Fork the repository
```bash
git fork
```

#### 2. Clone your fork
```bash
git clone <your-fork-url>
```

#### 3. Create a feature branch
```bash
git checkout -b feature/your-feature
```

#### 4. Commit your changes
```bash
git add .
git commit -m "Add: your feature"
```

#### 5. Push the branch
```bash
git push origin feature/your-feature
```

#### 6. Open a Pull Request

Describe what you changed and why the change is useful.

## ⚠️ Security Notice

#### Never commit sensitive credentials to the repository.

Make sure the following files are included in ```.gitignore```:
```text
.env
.env.local
.env.production
venv/
__pycache__/
node_modules/
.next/
```
If a credential is accidentally exposed, revoke and regenerate it immediately.

# 📜 License

A license has not yet been specified for this project.

If you intend to make RoadGuard AI open source, add an appropriate license such as MIT, Apache 2.0, or another license that matches your intended usage.

# 🇮🇳 Built for SIH 2026

RoadGuard AI was developed as part of the Smart India Hackathon 2026 ecosystem with the goal of exploring how Artificial Intelligence and modern cloud technologies can improve road infrastructure monitoring.

# ⭐ Support the Project

If you find RoadGuard AI interesting or useful:

- ⭐ Star the repository
- 🍴 Fork the project
- 🐛 Report issues
- 💡 Suggest improvements
- 🤝 Contribute to the project

### Built with ❤️, AI, and a lot of debugging.

RoadGuard AI — Making road inspection smarter, faster, and more data-driven.
