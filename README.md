# MediQ 🏥

A fully serverless, real-time Outpatient (OP) Queue Management System built with React and Firebase.

MediQ aims to reduce uncertainty and waiting times in hospital OP departments by providing patients with live queue tracking and giving hospital staff dynamic control over consultation workflows.

Inspired by the idea behind "Where is my Train", MediQ allows patients to monitor their consultation progress remotely through live ETAs and queue updates, while hospital staff manage both online appointments and walk-in patients through a unified workflow.

---

## 🚀 Features

### 👨‍⚕️ Patient Experience

* **Secure Self-Onboarding** using Firebase Phone Authentication (OTP).
* **Live Queue Tracking** with continuously updated ETAs and queue positions.
* **Secure Tracker Links** using randomized cryptographic URLs (e.g. `/tracker/aB3xY9Pq...`).
* **Active Booking Recovery** allowing patients to seamlessly continue tracking after refresh or browser closure.
* **Dynamic ETA Calculation** based on real consultation durations.

### 🏥 Staff Experience

* **Reception Desk Dashboard** for registering and managing walk-in patients.
* **Nurse Dashboard** for calling, skipping, pausing, and managing consultations across multiple doctors and rooms.
* **Admin Control Center** for configuring departments, doctors, schedules, and capacities.

### ⚙️ Queue Intelligence

* Real-time consultation status updates.
* Skip and re-prioritization logic.
* Dynamic consultation-time prediction.
* Session-aware queue state management.
* Recovery from refreshes and temporary disconnects.

---

## 🛠️ Tech Stack

| Category             | Technology                          |
| -------------------- | ----------------------------------- |
| Frontend             | React (Vite)                        |
| Styling              | Tailwind CSS                        |
| Routing              | React Router v6                     |
| Icons                | Lucide React                        |
| Backend-as-a-Service | Firebase Authentication & Firestore |
| State Management     | React Hooks                         |
| Security             | Firestore Security Rules            |

---

## 🔒 Security & Architecture

MediQ follows a **zero-backend architecture** (no dedicated Node.js server or Cloud Functions) to remain lightweight and cost-effective while still enforcing strict security guarantees.

### Role-Based Access Control (RBAC)

Operations are partitioned between:

* **Admin**
* **Nurse**
* **Reception**
* **Patient**

Access is enforced directly at the Firestore layer.

### Privacy-First Design

Patient identity information is isolated from public queue data.

* `today_queue` → Queue math and operational state.
* `queue_pii` → Personally Identifiable Information (PII).

This architecture allows public tracker links to calculate ETAs without exposing patient identities.

### Strict Database Validation

Firestore Security Rules enforce:

* Schema validation
* Data type validation
* Role authorization
* Booking limits
* Concurrency protection

### Anti-Spam Protection

Patients are restricted to a maximum of **3 active bookings** simultaneously.

Concurrency constraints are enforced directly at the database layer.

---

## 💻 Local Setup

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/mediq.git
cd mediq
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file:

```bash
cp .env.example .env
```

Populate the file using your Firebase project credentials.

Example:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

### 4. Deploy Firestore Rules

```bash
firebase deploy --only firestore:rules
```

Alternatively, copy the contents of `firestore.rules` directly into the Firebase Console.

### 5. Run the Development Server

```bash
npm run dev
```

---

## 🗂️ Project Structure

```plaintext
src/
├── components/
│   ├── AdminDashboard.jsx
│   ├── NurseDashboard.jsx
│   ├── PatientOnboarding.jsx
│   ├── PatientTracker.jsx
│   ├── ProtectedRoute.jsx
│   └── ReceptionDesk.jsx
│
├── utils/
│   └── queueSession.js
│
├── firebase.js
├── App.jsx
└── index.css
```

---

## 🔄 Core Workflow

```text
Patient Books Appointment
            ↓
Patient Receives Secure Tracker Link
            ↓
Patient Checks Queue Status Remotely
            ↓
Reception Confirms Arrival
            ↓
Nurse Calls Patient
            ↓
Consultation Starts
            ↓
Dynamic ETA Recalculated For Remaining Patients
            ↓
Consultation Completed
```

---

## 🌱 Future Improvements

* SMS notifications and reminders.
* Doctor-facing dashboard.
* Historical analytics and reporting.
* Multi-branch hospital support.
* Progressive Web App (PWA) support.
* Firebase Cloud Functions integration for advanced automation.

---

## 📜 License

This project was built primarily as a learning exercise and proof-of-concept exploring real-time systems, workflow design, and healthcare queue optimization.
