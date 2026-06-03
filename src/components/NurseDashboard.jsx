import { useState, useEffect } from 'react';
import { collection, doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { UserCheck, ArrowRight, PauseCircle, PlayCircle, SkipForward, Power, Stethoscope, AlertCircle } from 'lucide-react';

export default function NurseDashboard() {
  // Setup States
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  
  // Operational States
  const [clinicData, setClinicData] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // 1. Fetch the live list of Doctors configured by the Admin
  useEffect(() => {
    const unsubDocs = onSnapshot(collection(db, "doctors"), (snap) => {
      setDoctors(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubDocs();
  }, []);

  // 2. Dynamically hook into the selected doctor's specific clinic desk
  useEffect(() => {
    if (!selectedDoctorId) {
      setClinicData(null);
      return;
    }

    const targetDoctor = doctors.find(d => d.id === selectedDoctorId);
    if (!targetDoctor || !targetDoctor.desk_id) return;

    const unsubDesk = onSnapshot(doc(db, "clinic_status", targetDoctor.desk_id), (docSnap) => {
      if (docSnap.exists()) {
        setClinicData(docSnap.data());
      } else {
        console.error("This desk has not been initialized by the Admin yet.");
        setClinicData(null);
      }
    });

    return () => unsubDesk();
  }, [selectedDoctorId, doctors]);


  // --- CORE QUEUE LOGIC (Now routed dynamically) ---

  const getActiveDeskRef = () => {
    const targetDoctor = doctors.find(d => d.id === selectedDoctorId);
    return doc(db, "clinic_status", targetDoctor.desk_id);
  };

  const toggleSession = async () => {
    try {
      const isStarting = !clinicData.session_active;
      await updateDoc(getActiveDeskRef(), {
        session_active: isStarting,
        is_paused: false, 
        ...(isStarting && { 
          rolling_average: clinicData.baseline_average || 5, 
          recent_durations: [],
          last_call_time: serverTimestamp() 
        })
      });
    } catch (error) {
      console.error("Error toggling session:", error);
    }
  };

  const handleCallNext = async () => {
    if (!clinicData || !clinicData.session_active) return alert("Please Start Session first!");
    setIsUpdating(true);
    
    try {
      let newAverage = clinicData.rolling_average;
      let newDurations = clinicData.recent_durations || [];

      if (clinicData.last_call_time) {
        const lastCallDate = clinicData.last_call_time.toDate();
        const durationMinutes = Math.max(1, Math.min(30, Number(((new Date() - lastCallDate) / 60000).toFixed(1))));

        newDurations = [...newDurations, durationMinutes].slice(-5);
        newAverage = Number((newDurations.reduce((a, b) => a + b, 0) / newDurations.length).toFixed(1));
      }

      await updateDoc(getActiveDeskRef(), {
        current_serving_token: clinicData.current_serving_token + 1,
        last_call_time: serverTimestamp(),
        recent_durations: newDurations,
        rolling_average: newAverage,
        is_paused: false 
      });
      
    } catch (error) {
      console.error("Error calling next patient:", error);
    }
    setIsUpdating(false);
  };

  const togglePause = async () => {
    if (!clinicData.session_active) return;
    await updateDoc(getActiveDeskRef(), { is_paused: !clinicData.is_paused });
  };

  const handleSkip = async () => {
    if (!clinicData.session_active) return;
    alert(`Token #${clinicData.current_serving_token} skipped! Moving to next patient.`);
    await handleCallNext(); 
  };


  return (
    <div className="min-h-screen bg-gray-900 p-6 flex flex-col items-center justify-start font-sans">
      <div className="w-full max-w-lg space-y-6 mt-10">
        
        {/* ROOM SELECTOR (The new addition) */}
        <div className="bg-gray-800 rounded-3xl p-6 border border-gray-700 shadow-lg">
          <label className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
            <Stethoscope size={16} className="text-blue-400"/> Select Assignment
          </label>
          <select 
            value={selectedDoctorId} 
            onChange={(e) => setSelectedDoctorId(e.target.value)}
            className="w-full bg-gray-900 text-white border border-gray-700 rounded-xl px-4 py-3 font-bold focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="">-- Choose Doctor's Room --</option>
            {doctors.map(doc => (
              <option key={doc.id} value={doc.id}>{doc.name} ({doc.department})</option>
            ))}
          </select>
        </div>

        {/* If no room is selected, show a prompt */}
        {!selectedDoctorId && (
          <div className="bg-gray-800/50 rounded-3xl p-10 text-center border border-gray-800 border-dashed">
            <AlertCircle size={48} className="text-gray-600 mx-auto mb-4" />
            <h3 className="text-gray-400 font-medium">Please select a doctor to load the control panel.</h3>
          </div>
        )}

        {/* If a room is selected, show the Dashboard */}
        {selectedDoctorId && clinicData && (
          <div className="bg-white rounded-3xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4">
            
            {/* Header */}
            <div className={`p-6 text-white flex justify-between items-center transition-colors ${!clinicData.session_active ? 'bg-gray-600' : clinicData.is_paused ? 'bg-orange-500' : 'bg-emerald-600'}`}>
              <div>
                <h1 className="text-xl font-bold tracking-tight">{doctors.find(d => d.id === selectedDoctorId)?.name}</h1>
                <p className="text-xs font-medium opacity-80">{doctors.find(d => d.id === selectedDoctorId)?.department}</p>
              </div>
              <button 
                onClick={toggleSession}
                className="flex items-center gap-2 text-sm font-bold px-4 py-2 rounded-full bg-black/20 hover:bg-black/30 transition-colors"
              >
                <Power size={16} /> {clinicData.session_active ? 'END SESSION' : 'START SESSION'}
              </button>
            </div>

            {/* Status Dashboard */}
            <div className={`p-8 text-center transition-opacity ${!clinicData.session_active ? 'opacity-50 pointer-events-none' : ''}`}>
              <p className="text-gray-500 font-semibold uppercase tracking-wide text-sm mb-2">Inside Consultation</p>
              <div className="text-8xl font-black text-gray-900 mb-8">#{clinicData.current_serving_token}</div>

              <div className="space-y-3">
                <button 
                  onClick={handleCallNext} disabled={isUpdating}
                  className={`w-full flex items-center justify-center gap-3 py-5 rounded-2xl text-xl font-bold text-white transition-all ${isUpdating ? "bg-emerald-400" : "bg-emerald-600 hover:bg-emerald-700 shadow-lg"}`}
                >
                  {isUpdating ? "Calculating..." : "Call Next Patient"} <ArrowRight size={24} />
                </button>

                <div className="flex gap-3">
                  <button onClick={handleSkip} className="flex-1 flex justify-center gap-2 py-3 rounded-xl font-bold text-red-600 bg-red-50 hover:bg-red-100"><SkipForward size={18} /> Skip</button>
                  <button onClick={togglePause} className={`flex-1 flex justify-center gap-2 py-3 rounded-xl font-bold ${clinicData.is_paused ? "text-emerald-700 bg-emerald-100" : "text-orange-600 bg-orange-50"}`}>
                    {clinicData.is_paused ? <PlayCircle size={18} /> : <PauseCircle size={18} />} {clinicData.is_paused ? "Resume" : "Freeze"}
                  </button>
                </div>
              </div>
            </div>

            {/* Footer Stats */}
            <div className="bg-gray-50 p-4 border-t flex justify-between text-gray-500 text-sm font-medium px-6">
              <div className="flex items-center gap-2">
                 <UserCheck size={16} /> 
                 {clinicData.session_active ? `Live Avg: ${clinicData.rolling_average}m` : `Baseline: ${clinicData.baseline_average}m`}
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}