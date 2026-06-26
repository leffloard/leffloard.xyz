# leffloard.xyz - Personal Portfolio and Blog

A personal portfolio and blog web application built with a modern web stack. The project features a React (Vite) frontend, a FastAPI backend, and a MongoDB database.

---

## Tech Stack

### Frontend
- **React 19** & **Vite** - High-performance frontend library and build tool
- **Tailwind CSS** - Utility-first styling framework
- **React Router DOM** - Client-side routing for multi-page navigation and dynamic blog routes
- **shadcn/ui** & **Radix UI** - Accessible and customizable UI component primitives
- **Axios** - HTTP client for backend API communication
- **Lucide React** - Icon library
- **Sonner & Toast** - Toast notification management

### Backend & Database
- **FastAPI** - High-performance asynchronous Python API framework
- **MongoDB** & **Motor** - Asynchronous MongoDB driver for python
- **Pydantic v2** - Data validation and settings management using python type annotations
- **Uvicorn** - ASGI web server implementation

---

## Project Structure

```text
leffloard.xyz/
├── frontend/                     # React application codebase
│   ├── src/
│   │   ├── components/           # UI components (Hero, About, Blog, etc.)
│   │   │   ├── ui/               # Low-level UI primitives (Button, Input, etc.)
│   │   │   └── ...
│   │   ├── data/                 # Static mock data or configurations
│   │   ├── hooks/                # Custom React hooks
│   │   ├── lib/                  # Shared utility code
│   │   ├── App.jsx               # Main application component
│   │   └── main.jsx              # Application entry point
│   ├── tailwind.config.js        # Tailwind CSS configuration
│   └── package.json              # NPM dependencies and script definitions
│
├── backend/                      # FastAPI application codebase
│   ├── server.py                 # Core server logic and API routing
│   ├── requirements.txt          # Python dependency specifications
│   └── .env.example              # Sample environment variables file
│
├── tests/                        # Automated testing suite directory
│   └── __init__.py
│
└── egefitnessalwaysinbussinies.bat # Convenience startup batch script (Windows)
```

---

## Getting Started

### Quick Start (Windows)
To start both the frontend and backend development servers concurrently, execute the provided batch script in the root directory:
```cmd
egefitnessalwaysinbussinies.bat
```
This script opens a new command prompt window to host the FastAPI uvicorn server, and runs the Vite development server in the current terminal window.

---

## Manual Installation

### Prerequisites
- Node.js (v18 or higher)
- Python (v3.10 or higher)
- MongoDB instance (running locally or hosted via MongoDB Atlas)

### Backend Setup
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate a virtual environment:
   ```bash
   python -m venv venv
   # Windows:
   venv\Scripts\activate
   # macOS/Linux:
   source venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Copy the environment configuration file and provide your database credentials:
   ```bash
   copy .env.example .env
   # macOS/Linux:
   cp .env.example .env
   ```
   Modify `.env` as required:
   ```env
   MONGO_URL=mongodb://localhost:27017
   DB_NAME=leffloard
   CORS_ORIGINS=http://localhost:5173
   ```
5. Run the ASGI server:
   ```bash
   python -m uvicorn server:app --reload
   ```
   The backend API will be available at `http://127.0.0.1:8000`.

### Frontend Setup
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
   The frontend interface will be available at `http://localhost:5173`.

---

## API Endpoints

The FastAPI backend exposes the following API routing structure:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| **GET** | `/api/` | Base endpoint, returns server greeting message. |
| **POST** | `/api/status` | Commits a new status check document to the database. |
| **GET** | `/api/status` | Retrieves a list of all status checks from the database. |

---

## Component Architecture

The React interface is composed of modular components:
- **Hero**: Landing area introduction.
- **About**: Biography and personal summary.
- **Skills**: Visualization of technical proficiencies.
- **Experience & Education**: Timeline representation of career and academic milestones.
- **Projects**: Portfolio listing and search interface.
- **Pricing**: Freelance rates and package matrices.
- **Blog & BlogDetails**: Layouts for listing posts and reading individual blog entries.
- **Contact**: User inquiry submission forms.

---

## Deployment

### Frontend Production Build
To generate static assets for hosting (e.g. Netlify, Vercel, or GitHub Pages):
```bash
cd frontend
npm run build
```
Upload the contents of the generated `frontend/dist` directory to your hosting provider.

### Backend Hosting
The FastAPI backend can be served using Uvicorn or Gunicorn inside a containerized setup (Docker), or deployed directly to application hosts such as Render, Railway, or VPS environments.

---

## License

Private personal project. All rights reserved.
