import { useState, useEffect } from 'react';
import { collection, doc, onSnapshot, updateDoc, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { ArrowRight, SkipForward, PlayCircle, AlertCircle, Activity } from 'lucide-react';
import { createSessionState, getSessionKey } from '../utils/queueSession';

export default function NurseDashboard() {
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [activeDocProfile, setActiveDocProfile] = useState(null);
  
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split('T')[0]);
  const [sessionBlock, setSessionBlock] = useState('Morning');
  
  const [activePatient, setActivePatient] = useState(null); 
  const [waitingQueue, setWaitingQueue] = useState([]); 
  const [queueEngine, setQueueEngine] = useState(null);
  
  const sessionKey = getSessionKey(sessionDate, sessionBlock);
  const sessionState = createSessionState(queueEngine?.daily_bookings?.[sessionKey]);

  useEffect(() => {
    const unsubDocs = onSnapshot(collection(db, "doctors"), (snap) => {
      setDoctors(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubDocs();
  }, []);

  useEffect(() => {
    if (!selectedDoctorId) return;
    const unsub = onSnapshot(doc(db, "doctor_queues", selectedDoctorId), (snap) => {
      if (snap.exists()) setQueueEngine(snap.data());
    });
    return () => unsub();
  }, [selectedDoctorId]);

  useEffect(() => {
    if (!selectedDoctorId || !sessionKey) return;
    
    const q = query(
      collection(db, "today_queue"), 
      where("doctor_id", "==", selectedDoctorId),
      where("session_key", "==", sessionKey) 
    );
    
    const unsub = onSnapshot(q, (snap) => {
      const allTickets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      const current = allTickets.find(t => t.status === "called" || t.status === "in_consultation");
      setActivePatient(current || null);

      let waiting = allTickets.filter(t => t.status === "arrived");
      
      waiting.sort((a, b) => {
        const PENALTY_WEIGHT = 3; 
        const aVirtualToken = a.token_number + (a.penalty_count * PENALTY_WEIGHT);
        const bVirtualToken = b.token_number + (b.penalty_count * PENALTY_WEIGHT);
        return aVirtualToken - bVirtualToken;
      });
      
      setWaitingQueue(waiting);
    });
    return () => unsub();
  }, [selectedDoctorId, sessionKey]);

  const handleDoctorChange = (e) => {
    const docId = e.target.value;
    setSelectedDoctorId(docId);
    
    const docProfile = doctors.find(d => d.id === docId);
    setActiveDocProfile(docProfile || null);
    
    if (docProfile) {
      const hasMorning = docProfile.op_schedule?.morning?.enabled;
      const hasEvening = docProfile.op_schedule?.evening?.enabled;
      if (!hasMorning && hasEvening) setSessionBlock('Evening');
      else if (hasMorning && !hasEvening) setSessionBlock('Morning');
    }
  };

  const getQueueRef = () => doc(db, "doctor_queues", selectedDoctorId);

  const updateSessionState = async (patch) => {
    const updates = {};
    Object.entries(patch).forEach(([key, value]) => {
      updates[`daily_bookings.${sessionKey}.${key}`] = value;
    });
    await updateDoc(getQueueRef(), updates);
  };

  const handleStartConsult = async () => {
    if (!activePatient) return;
    
    await updateDoc(doc(db, "today_queue", activePatient.id), { status: "in_consultation" });
    
    await updateSessionState({
      last_consultation_start_time: serverTimestamp(),
      session_active: true,
      is_paused: false
    });
  };

  const handleCallNext = async () => {
    let newAverage = sessionState.rolling_average || 5;
    let newDurations = sessionState.recent_durations || [];

    if (activePatient) {
      await updateDoc(doc(db, "today_queue", activePatient.id), { status: "completed" });
      
      if (sessionState.last_consultation_start_time) {
        const lastCallDate = sessionState.last_consultation_start_time.toDate();
        const durationMins = Math.max(1, Math.min(30, Number(((new Date() - lastCallDate) / 60000).toFixed(1))));
        
        newDurations = [...newDurations, durationMins].slice(-5); 
        newAverage = Number((newDurations.reduce((a, b) => a + b, 0) / newDurations.length).toFixed(1));
      }
    }

    if (waitingQueue.length > 0) {
      const nextUp = waitingQueue[0];
      await updateDoc(doc(db, "today_queue", nextUp.id), { status: "called" });
      
      await updateSessionState({
        current_serving_token: nextUp.token_number, 
        rolling_average: newAverage,
        recent_durations: newDurations,
        session_active: true,               // KEEP TRUE: Protects the rolling average
        last_consultation_start_time: null, // THE FIX: Kills the ghost timer
        is_paused: false
      });
    } else {
      await updateSessionState({
        rolling_average: newAverage,
        recent_durations: newDurations,
        session_active: false,
        last_consultation_start_time: null, // Clear timer for empty room
        is_paused: true
      });
    }
  };

  const handleSkip = async () => {
    if (!activePatient) return;
    await updateDoc(doc(db, "today_queue", activePatient.id), { 
      status: "arrived", 
      penalty_count: activePatient.penalty_count + 1 
    });
    
    await updateSessionState({
      session_active: false,
      is_paused: true
    });
  };

  return (
    <div className="min-h-screen bg-gray-900 p-6 flex flex-col items-center font-sans">
      <div className="w-full max-w-lg space-y-6 mt-10">
        
        <select 
          value={selectedDoctorId} onChange={handleDoctorChange}
          className="w-full bg-gray-800 text-white border border-gray-700 rounded-xl px-4 py-3 font-bold cursor-pointer"
        >
          <option value="">-- Choose Doctor's Room --</option>
          {doctors.map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
        </select>

        <div className="grid grid-cols-2 gap-3">
          <input
            type="date"
            value={sessionDate}
            onChange={(e) => setSessionDate(e.target.value)}
            className="w-full bg-gray-800 text-white border border-gray-700 rounded-xl px-4 py-3 font-bold cursor-pointer"
          />
          <select
            value={sessionBlock}
            onChange={(e) => setSessionBlock(e.target.value)}
            className="w-full bg-gray-800 text-white border border-gray-700 rounded-xl px-4 py-3 font-bold cursor-pointer"
          >
            {activeDocProfile?.op_schedule?.morning?.enabled && <option value="Morning">Morning</option>}
            {activeDocProfile?.op_schedule?.evening?.enabled && <option value="Evening">Evening</option>}
            {!activeDocProfile && <option value="Morning">Morning</option>}
          </select>
        </div>

        {selectedDoctorId && queueEngine && (
          <div className="space-y-4">
            
            {/* Active Display Panel */}
            <div className="bg-white rounded-3xl p-8 text-center shadow-xl relative overflow-hidden">
              <div className="absolute top-4 left-4 right-4 flex justify-between text-xs font-bold text-gray-400">
                <span className="flex items-center gap-1"><Activity size={14}/> Avg: {sessionState.rolling_average || 5}m</span>
                <span>Max: {sessionState.capacity || 20}</span>
              </div>

              <p className="text-gray-500 font-bold uppercase mb-2 mt-4">Current Status</p>
              
              {activePatient ? (
                <>
                  <div className="text-6xl font-black text-gray-900 mb-2">#{activePatient.token_number}</div>
                  <div className={`inline-block px-4 py-1 rounded-full text-sm font-bold ${activePatient.status === 'in_consultation' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'} mb-6`}>
                    {activePatient.status === 'in_consultation' ? 'IN CONSULTATION' : 'CALLED TO ROOM'}
                  </div>
                  
                  {/* ENFORCED UI WORKFLOW */}
                  {activePatient.status === 'called' && (
                    <div className="grid grid-cols-2 gap-3 mt-4">
                      <button onClick={handleStartConsult} className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-4 rounded-xl flex justify-center items-center gap-2 text-lg">
                        <PlayCircle size={24}/> Walked In
                      </button>
                      <button onClick={handleSkip} className="bg-orange-100 hover:bg-orange-200 text-orange-700 font-bold py-4 rounded-xl flex justify-center items-center gap-2 text-lg">
                        <SkipForward size={24}/> Absent / Skip
                      </button>
                    </div>
                  )}

                  {activePatient.status === 'in_consultation' && (
                    <div className="space-y-3 mt-4">
                      <button onClick={handleCallNext} className="w-full bg-gray-900 hover:bg-black text-white font-bold py-4 rounded-xl flex justify-center items-center gap-2 text-lg">
                        Finish Consult & Call Next <ArrowRight size={24}/>
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="py-10 text-gray-400 font-medium">Room is empty. Call next patient.</div>
                  <button 
                    onClick={handleCallNext} disabled={waitingQueue.length === 0}
                    className="w-full mt-4 bg-gray-900 hover:bg-black text-white font-bold py-4 rounded-xl flex justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Call Next Patient <ArrowRight size={20}/>
                  </button>
                </>
              )}
            </div>

            {/* Live Active Queue */}
            <div className="bg-gray-800 rounded-3xl p-6 border border-gray-700">
              <h3 className="text-gray-400 font-bold uppercase text-xs mb-4">Active Queue ({waitingQueue.length})</h3>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                {waitingQueue.length === 0 && <p className="text-gray-500 text-sm italic">No arrived patients waiting.</p>}
                {waitingQueue.map(p => (
                  <div key={p.id} className="bg-gray-900 p-3 rounded-xl flex justify-between items-center">
                    <div className="text-white font-bold">#{p.token_number} <span className="text-gray-400 font-medium text-sm ml-2">{p.patient_name}</span></div>
                    {p.penalty_count > 0 && <span className="flex items-center gap-1 text-xs font-bold text-orange-500 bg-orange-500/10 px-2 py-1 rounded"><AlertCircle size={12}/> Skipped</span>}
                  </div>
                ))}
              </div>
            </div>
            
          </div>
        )}
      </div>
    </div>
  );
}