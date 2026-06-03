import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { Clock, Users, Activity, AlertCircle, CalendarClock, User, Stethoscope } from 'lucide-react';

export default function PatientTracker() {
  const { tokenId } = useParams(); // This is now the secure alphanumeric tracker_id string
  const navigate = useNavigate();

  const [patientTicket, setPatientTicket] = useState(null);
  const [clinicData, setClinicData] = useState(null);
  const [loading, setLoading] = useState(true);

  // STEP 1: Listen to the specific secure token document
  useEffect(() => {
    const ticketRef = doc(db, "today_queue", tokenId);
    
    const unsubTicket = onSnapshot(ticketRef, (docSnap) => {
      if (docSnap.exists()) {
        setPatientTicket(docSnap.data());
      } else {
        console.error("Secure tracker ID not found in active queue.");
        setLoading(false);
      }
    }, (error) => {
      console.error("Firestore access denied:", error);
      setLoading(false);
    });

    return () => unsubTicket();
  }, [tokenId]);

  // STEP 2: Listen to the live clinic status desk tied to this patient's doctor
  useEffect(() => {
    if (!patientTicket) return;

    // Dynamically look up the desk ID assigned to this doctor (e.g., op_desk_1)
    const targetDeskId = patientTicket.desk_id || 'op_desk_1'; 
    const clinicRef = doc(db, "clinic_status", targetDeskId);

    const unsubClinic = onSnapshot(clinicRef, (docSnap) => {
      if (docSnap.exists()) {
        setClinicData(docSnap.data());
      }
      setLoading(false);
    });

    return () => unsubClinic();
  }, [patientTicket]);

  if (loading) return <div className="p-10 text-center font-bold text-gray-600">Verifying secure token link...</div>;
  if (!patientTicket) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md border border-gray-100">
          <AlertCircle className="text-red-500 mx-auto mb-4" size={48} />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Invalid or Expired Tracker Link</h2>
          <p className="text-gray-500 text-sm mb-6">This tracking session does not exist or has been removed from the active queue system.</p>
          <button onClick={() => navigate('/')} className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl">Go to Booking Portal</button>
        </div>
      </div>
    );
  }

  // The Dual-Tier Math Engine operating on verified backend data
  const myToken = patientTicket.token_number;
  const currentServing = clinicData ? clinicData.current_serving_token : 0;
  const isPaused = clinicData ? clinicData.is_paused : false;
  const sessionActive = clinicData ? clinicData.session_active : false;
  const effectiveAverage = clinicData ? (sessionActive ? clinicData.rolling_average : clinicData.baseline_average) : 5;

  const peopleAhead = Math.max(0, myToken - currentServing);
  const estimatedMinutes = Math.round(peopleAhead * effectiveAverage);

  return (
    <div className="min-h-screen bg-gray-50 p-6 flex flex-col items-center justify-center font-sans">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100">
        
        {/* Dynamic Security/Status Header */}
        <div className={`p-6 text-white text-center transition-colors ${!sessionActive ? 'bg-indigo-600' : isPaused ? 'bg-orange-500' : 'bg-blue-600'}`}>
          <h1 className="text-2xl font-bold tracking-tight">City Hospital OP</h1>
          <p className="text-white/90 text-sm mt-1 flex items-center justify-center gap-2">
            {!sessionActive ? <CalendarClock size={16} /> : <Activity size={16} />} 
            {!sessionActive ? "Session Not Started" : isPaused ? "Queue Temporarily Paused" : "Live Tracker Active"}
          </p>
        </div>

        {/* Live Tracking Information */}
        <div className="p-8 text-center space-y-6">
          
          {/* Display Patient Assignment Details */}
          <div className="text-left bg-gray-50 rounded-xl p-3 border border-gray-100 text-xs text-gray-600 space-y-1">
            <div className="flex items-center gap-2 font-medium"><User size={14} className="text-gray-400"/> Patient: <span className="text-gray-900 font-bold">{patientTicket.patient_name.split(' ')[0]} {patientTicket.patient_name.split(' ')[1] ? patientTicket.patient_name.split(' ')[1][0] + '.' : ''}</span></div>
            <div className="flex items-center gap-2 font-medium"><Stethoscope size={14} className="text-gray-400"/> Consultation: <span className="text-gray-900 font-bold">{patientTicket.doctor_name} ({patientTicket.department})</span></div>
          </div>

          {!sessionActive && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-center gap-3 text-left text-indigo-800 text-sm">
              <CalendarClock className="text-indigo-600 shrink-0" size={20} />
              <div>
                <p className="font-bold">Advance Booking Confirmed</p>
                <p className="text-indigo-700 text-xs">The practitioner is not currently in session. Your order is secured; arrival estimation is pinned to typical benchmarks.</p>
              </div>
            </div>
          )}

          {isPaused && sessionActive && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-center gap-3 text-left text-orange-800 text-sm">
              <AlertCircle className="text-orange-600 shrink-0" size={20} />
              <div>
                <p className="font-bold">Clinical Queue Frozen</p>
                <p className="text-orange-700 text-xs">The doctor is briefly unavailable. Live durations are suspended; tracking sequence numbers remain locked.</p>
              </div>
            </div>
          )}

          <div>
            <p className="text-gray-500 font-medium uppercase tracking-wide text-sm mb-2">Currently Serving</p>
            <div className="text-7xl font-extrabold text-gray-900">
              #{currentServing}
            </div>
          </div>

          <div className="h-px w-full bg-gray-100"></div>

          {/* Secure Live Ticket Display */}
          <div className="bg-blue-50 rounded-2xl p-6 border border-blue-100">
            <p className="text-blue-600 font-medium mb-1">Your Verified Token</p>
            <div className="text-4xl font-bold text-blue-700 mb-4">#{myToken}</div>
            
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="flex flex-col items-center p-3 bg-white rounded-xl shadow-sm">
                <Users className="text-gray-400 mb-1" size={20} />
                <span className="text-2xl font-bold text-gray-800">{peopleAhead}</span>
                <span className="text-xs text-gray-500 font-medium">Ahead of you</span>
              </div>
              <div className="flex flex-col items-center p-3 bg-white rounded-xl shadow-sm">
                <Clock className="text-blue-400 mb-1" size={20} />
                <span className="text-2xl font-bold text-blue-600">
                  {isPaused && sessionActive ? "--" : `~${estimatedMinutes}`}
                </span>
                <span className="text-xs text-blue-400 font-medium">Mins wait</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}