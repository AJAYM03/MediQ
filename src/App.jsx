import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import PatientOnboarding from "./components/PatientOnboarding";
import PatientTracker from "./components/PatientTracker";
import AdminDashboard from "./components/AdminDashboard";
import NurseDashboard from "./components/NurseDashboard";
import ReceptionDesk from "./components/ReceptionDesk";
import ProtectedRoute from "./components/ProtectedRoute"; // <-- Import the Bouncer

// Define these outside the App component
const ADMIN_ROLE = ['admin'];
const NURSE_ROLES = ['admin', 'nurse'];
const RECEPTION_ROLES = ['admin', 'reception'];

  // <ProtectedRoute allowedRoles={NURSE_ROLES}>


function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<PatientOnboarding />} />
        <Route path="/tracker/:tokenId" element={<PatientTracker />} />
        
        {/* Protected Routes (Wrapped by the Bouncer) */}
        <Route 
          path="/admin" 
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLE}>
              <AdminDashboard />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/nurse" 
          element={
            <ProtectedRoute allowedRoles={NURSE_ROLES}>
              <NurseDashboard />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/reception" 
          element={
            <ProtectedRoute allowedRoles={RECEPTION_ROLES}>
              <ReceptionDesk />
            </ProtectedRoute>
          } 
        />
        
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;