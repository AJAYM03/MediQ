import { useState, useEffect } from 'react';
import { collection, doc, onSnapshot, updateDoc, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { ArrowRight, SkipForward, PlayCircle, AlertCircle, Activity } from 'lucide-react';
import { createSessionState, getSessionKey } from '../utils/queueSession';

export default function NurseDashboard() {
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split('T')[0]);
  const [sessionBlock, setSessionBlock] = useState('Morning');
  
  // The State Machine Trackers
  const [activePatient, setActivePatient] = useState(null); 
  const [waitingQueue, setWaitingQueue] = useState([]); 
  
  // THE MISSING PIECE: The Math Engine Tracker
  const [queueEngine, setQueueEngine] = useState(null);
  const sessionKey = getSessionKey(sessionDate, sessionBlock);
  const sessionState = createSessionState(queueEngine?.daily_bookings?.[sessionKey]);

  // 1. Fetch Doctors list
  useEffect(() => {
    const unsubDocs = onSnapshot(collection(db, "doctors"), (snap) => {
      setDoctors(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubDocs();
  }, []);

  // 2. Fetch the Math Engine (doctor_queues)
  useEffect(() => {
    if (!selectedDoctorId) return;
    const unsub = onSnapshot(doc(db, "doctor_queues", selectedDoctorId), (snap) => {
      if (snap.exists()) setQueueEngine(snap.data());
    });
    return () => unsub();
  }, [selectedDoctorId]);

  // 3. Fetch the Tickets & State Machine
  useEffect(() => {
    if (!selectedDoctorId) return;
    
    const q = query(
      collection(db, "today_queue"), 
      where("doctor_id", "==", selectedDoctorId),
      where("appointment_date", "==", sessionDate),
      where("session_block", "==", sessionBlock)
    );
    
    const unsub = onSnapshot(q, (snap) => {
      const allTickets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      const current = allTickets.find(t => t.status === "called" || t.status === "in_consultation");
      setActivePatient(current || null);

      let waiting = allTickets.filter(t => t.status === "arrived");
      waiting.sort((a, b) => {
        if (a.penalty_count !== b.penalty_count) return a.penalty_count - b.penalty_count;
        return a.token_number - b.token_number;
      });
      setWaitingQueue(waiting);
    });
    return () => unsub();
  }, [selectedDoctorId, sessionDate, sessionBlock]);

  const getQueueRef = () => doc(db, "doctor_queues", selectedDoctorId);

  const updateSessionState = async (patch) => {
    const updates = {};
    Object.entries(patch).forEach(([key, value]) => {
      updates[`daily_bookings.${sessionKey}.${key}`] = value;
    });
    await updateDoc(getQueueRef(), updates);
  };

  // --- RESTORED MATHEMATICAL STATE ACTIONS ---

  // Action A: They walked in the room. Start the hidden timer.
  const handleStartConsult = async () => {
    if (!activePatient) return;
    
    // 1. Update ticket UI
    await updateDoc(doc(db, "today_queue", activePatient.id), { status: "in_consultation" });
    
    // 2. Start the clock on the Engine
    await updateSessionState({
      last_consultation_start_time: serverTimestamp(),
      session_active: true,
      is_paused: false
    });
  };

  // Action B: Finish current, calculate math, call next.
  const handleCallNext = async () => {
    let newAverage = sessionState.rolling_average || 5;
    let newDurations = sessionState.recent_durations || [];

    // 1. If someone was in the room, finish them and calculate duration
    if (activePatient) {
      await updateDoc(doc(db, "today_queue", activePatient.id), { status: "completed" });
      
      if (sessionState.last_consultation_start_time) {
        const lastCallDate = sessionState.last_consultation_start_time.toDate();
        // Calculate mins passed (Min 1, Max 30 to prevent crazy outliers)
        const durationMins = Math.max(1, Math.min(30, Number(((new Date() - lastCallDate) / 60000).toFixed(1))));
        
        newDurations = [...newDurations, durationMins].slice(-5); // Keep last 5
        newAverage = Number((newDurations.reduce((a, b) => a + b, 0) / newDurations.length).toFixed(1));
      }
    }

    // 2. Call the next patient in line
    if (waitingQueue.length > 0) {
      const nextUp = waitingQueue[0];
      await updateDoc(doc(db, "today_queue", nextUp.id), { status: "called" });
      
      // 3. Update the Math Engine so Trackers recalculate!
      await updateSessionState({
        current_serving_token: nextUp.token_number, // Tells waiting patients who is inside!
        rolling_average: newAverage,
        recent_durations: newDurations,
        session_active: true,
        is_paused: false
      });
    } else {
      // If no one is left, just save the final math and pause the session
      await updateSessionState({
        rolling_average: newAverage,
        recent_durations: newDurations,
        session_active: false
      });
    }
  };

  // Action C: Skip Penalty (Kick them down the line)
  const handleSkip = async () => {
    if (!activePatient) return;
    // Don't update the math engine time here, because no consultation actually happened!
    await updateDoc(doc(db, "today_queue", activePatient.id), { 
      status: "arrived", 
      penalty_count: activePatient.penalty_count + 1 
    });
  };

  return (
    <div className="min-h-screen bg-gray-900 p-6 flex flex-col items-center font-sans">
      <div className="w-full max-w-lg space-y-6 mt-10">
        
        <select 
          value={selectedDoctorId} onChange={(e) => setSelectedDoctorId(e.target.value)}
          className="w-full bg-gray-800 text-white border border-gray-700 rounded-xl px-4 py-3 font-bold"
        >
          <option value="">-- Choose Doctor's Room --</option>
          {doctors.map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
        </select>

        <div className="grid grid-cols-2 gap-3">
          <input
            type="date"
            value={sessionDate}
            onChange={(e) => setSessionDate(e.target.value)}
            className="w-full bg-gray-800 text-white border border-gray-700 rounded-xl px-4 py-3 font-bold"
          />
          <select
            value={sessionBlock}
            onChange={(e) => setSessionBlock(e.target.value)}
            className="w-full bg-gray-800 text-white border border-gray-700 rounded-xl px-4 py-3 font-bold"
          >
            <option value="Morning">Morning</option>
            <option value="Evening">Evening</option>
          </select>
        </div>

        {selectedDoctorId && queueEngine && (
          <div className="space-y-4">
            {/* Active Display Panel */}
            <div className="bg-white rounded-3xl p-8 text-center shadow-xl relative overflow-hidden">
              
              {/* Live Math Stats Indicator */}
              <div className="absolute top-4 left-4 right-4 flex justify-between text-xs font-bold text-gray-400">
                <span className="flex items-center gap-1"><Activity size={14}/> Avg: {sessionState.rolling_average}m</span>
                <span>Max: {sessionState.capacity || 20}</span>
              </div>

              <p className="text-gray-500 font-bold uppercase mb-2 mt-4">Current Status</p>
              {activePatient ? (
                <>
                  <div className="text-6xl font-black text-gray-900 mb-2">#{activePatient.token_number}</div>
                  <div className={`inline-block px-4 py-1 rounded-full text-sm font-bold ${activePatient.status === 'in_consultation' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'} mb-6`}>
                    {activePatient.status === 'in_consultation' ? 'IN CONSULTATION' : 'CALLED TO ROOM'}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    {activePatient.status === 'called' && (
                      <button onClick={handleStartConsult} className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 rounded-xl flex justify-center gap-2"><PlayCircle size={20}/> Walked In</button>
                    )}
                    <button onClick={handleSkip} className="bg-orange-100 hover:bg-orange-200 text-orange-700 font-bold py-3 rounded-xl flex justify-center gap-2"><SkipForward size={20}/> Absent / Skip</button>
                  </div>
                </>
              ) : (
                <div className="py-10 text-gray-400 font-medium">Room is empty. Call next patient.</div>
              )}
              
              <button 
                onClick={handleCallNext} disabled={waitingQueue.length === 0 && !activePatient}
                className="w-full mt-4 bg-gray-900 hover:bg-black text-white font-bold py-4 rounded-xl flex justify-center gap-2"
              >
                {activePatient ? "Finish Consult & Call Next" : "Call Next Patient"} <ArrowRight size={20}/>
              </button>
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
