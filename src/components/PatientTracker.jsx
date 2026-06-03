import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { Clock, Users, Activity, AlertCircle, CalendarClock, User, Stethoscope, MapPin } from 'lucide-react';

export default function PatientTracker() {
  const { tokenId } = useParams(); // This is now the secure alphanumeric tracker_id string
  const navigate = useNavigate();

  const [patientTicket, setPatientTicket] = useState(null);
  const [clinicData, setClinicData] = useState(null);
  const [doctorData, setDoctorData] = useState(null);
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

  // STEP 2: Listen to the Doctor's live profile (for the Digital Concierge room mapping)
  useEffect(() => {
    if (!patientTicket?.doctor_id) return;
    
    const unsubDoc = onSnapshot(doc(db, "doctors", patientTicket.doctor_id), (snap) => {
      if (snap.exists()) setDoctorData(snap.data());
    });
    
    return () => unsubDoc();
  }, [patientTicket]);
  
  // STEP 3: Listen to the live queue engine tied directly to this doctor
  useEffect(() => {
    if (!patientTicket?.doctor_id) return;

    // Dynamically look up the doctor's personal queue engine
    const queueRef = doc(db, "doctor_queues", patientTicket.doctor_id);

    const unsubQueue = onSnapshot(queueRef, (docSnap) => {
      if (docSnap.exists()) {
        setClinicData(docSnap.data());
      }
      setLoading(false);
    });

    return () => unsubQueue();
  }, [patientTicket]);

  if (loading) return <div className="min-h-screen flex items-center justify-center font-bold text-gray-600">Verifying secure token link...</div>;
  
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
          <h1 className="text-2xl font-bold tracking-tight">MediQ Outpatient</h1>
          <p className="text-white/90 text-sm mt-1 flex items-center justify-center gap-2">
            {!sessionActive ? <CalendarClock size={16} /> : <Activity size={16} />} 
            {!sessionActive ? "Session Not Started" : isPaused ? "Queue Temporarily Paused" : "Live Tracker Active"}
          </p>
        </div>

        {/* Live Tracking Information */}
        <div className="p-8 text-center space-y-6">
          
          {/* Display Patient Assignment Details & Digital Concierge */}
          <div className="text-left bg-gray-50 rounded-xl p-4 border border-gray-100 text-sm text-gray-600 space-y-2">
            <div className="flex items-center gap-2 font-medium">
              <User size={16} className="text-gray-400"/> Patient: 
              <span className="text-gray-900 font-bold">
                {patientTicket.patient_name.split(' ')[0]} {patientTicket.patient_name.split(' ')[1] ? patientTicket.patient_name.split(' ')[1][0] + '.' : ''}
              </span>
            </div>
            <div className="flex items-center gap-2 font-medium">
              <Stethoscope size={16} className="text-gray-400"/> Doctor: 
              <span className="text-gray-900 font-bold">{patientTicket.doctor_name}</span>
            </div>
            {/* The Digital Concierge Room Mapping */}
            <div className="flex items-center gap-2 font-medium pt-2 border-t border-gray-200 mt-2">
              <MapPin size={16} className="text-emerald-500"/> Location: 
              <span className="text-emerald-700 font-black">{doctorData?.current_room || "Please ask reception"}</span>
            </div>
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