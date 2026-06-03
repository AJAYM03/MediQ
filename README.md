# MediQ 🏥

A fully serverless, real-time Outpatient (OP) Queue Management System built with React and Firebase.

MediQ was designed to eliminate chaotic hospital waiting rooms by providing patients with live queue tracking and giving hospital staff dynamic, multi-room control over consultation flows. It utilizes a zero-backend architecture, relying on mathematically strict Firestore Security Rules to enforce Role-Based Access Control (RBAC) and prevent concurrency spam directly from the client.

## 🚀 Features

* **Patient Self-Onboarding:** Secure mobile login using Firebase Phone Auth (OTP).
* **Live Cryptographic Tracking:** Patients receive unguessable, randomized URLs (e.g., `/tracker/aB3xY9Pq...`) to monitor their ETA in real-time without exposing Personally Identifiable Information (PII).
* **Reception Desk (Walk-ins):** Unified entry point for staff to register walk-in patients and merge them securely into the digital queue.
* **Dynamic Nurse Dashboard:** Multi-room selector allowing nurses to dynamically hook into specific doctors' queues to call, pause, or skip tokens.
* **Admin Control Center:** Centralized management of hospital departments and practitioner assignments.
* **Anti-Spam Architecture:** Client-side concurrency limits (max 3 active bookings per patient) enforced strictly at the database layer using Firestore `arrayUnion` locks.

## 🛠️ Tech Stack

* **Frontend:** React (Vite), Tailwind CSS, Lucide React (Icons)
* **Routing:** React Router v6 (with custom client-side Route Guards)
* **Backend as a Service:** Firebase (Auth, Firestore)
* **Security:** Hardened `firestore.rules` (Strict schema validation and RBAC)

## 🔒 Security & Database Architecture

This application operates without a traditional Node.js backend (like Firebase Cloud Functions) to remain highly cost-effective (MVP). To achieve production-grade security, the `firestore.rules` file acts as the ultimate gatekeeper:

1. **Role-Based Access:** Read/Write operations are strictly partitioned between `admin`, `nurse`, `reception`, and `patient` roles verified via the `users` collection.
2. **Schema Enforcement:** The `today_queue` blocks client-side forgery by enforcing exact key matches and data types before committing transactions.
3. **The Concurrency Lock:** Patients are mathematically restricted from spamming the global queue counter by a self-locking array constraint on their profile document.

## 💻 Local Setup & Installation

**1. Clone the repository**

```bash
git clone https://github.com/your-username/mediq.git
cd mediq
```

**2. Install dependencies**

```bash
npm install
```

**3. Environment Variables**

Create a `.env` file in the root directory based on the provided example:

```bash
cp .env.example .env
```

Populate the `.env` file with your Firebase project credentials.

**4. Deploy Firestore Rules**

To ensure the backend logic functions correctly, deploy the security rules to your Firebase project:

```bash
firebase deploy --only firestore:rules
```

(Alternatively, copy the contents of `firestore.rules` directly into the Firebase Console).

**5. Start the Development Server**

```bash
npm run dev
```

## 🗺️ Project Structure

```plaintext
src/
├── components/
│   ├── AdminDashboard.jsx     # Master config & staff management
│   ├── NurseDashboard.jsx     # Live room routing & queue control
│   ├── PatientOnboarding.jsx  # Phone Auth & secure token booking
│   ├── PatientTracker.jsx     # Live ETA & unguessable bearer links
│   ├── ProtectedRoute.jsx     # Client-side RBAC Bouncer
│   └── ReceptionDesk.jsx      # Walk-in registration
├── App.jsx                    # Routing & Bouncer integration
├── firebase.js                # Environment config & initialization
└── index.css                  # Tailwind directives
```
