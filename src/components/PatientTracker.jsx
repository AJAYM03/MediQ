import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { doc, onSnapshot, collection, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Clock, AlertCircle, User, MapPin, Users, Activity, Timer, Info } from 'lucide-react';
import { createSessionState } from '../utils/queueSession';

export default function PatientTracker() {
  const { tokenId } = useParams();
  
  const [ticket, setTicket] = useState(null);
  const [docProfile, setDocProfile] = useState(null);
  const [queueEngine, setQueueEngine] = useState(null);
  const [activeQueue, setActiveQueue] = useState([]); 
  
  const [clockTick, setClockTick] = useState(() => Date.now()); 

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "today_queue", tokenId), (snap) => {
      if (snap.exists()) setTicket({ id: snap.id, ...snap.data() });
    });
    return () => unsub();
  }, [tokenId]);

  useEffect(() => {
    if (!ticket?.doctor_id) return;
    const unsub = onSnapshot(doc(db, "doctors", ticket.doctor_id), (snap) => {
      if (snap.exists()) setDocProfile(snap.data());
    });
    return () => unsub();
  }, [ticket]);

  useEffect(() => {
    if (!ticket?.doctor_id) return;
    const unsub = onSnapshot(doc(db, "doctor_queues", ticket.doctor_id), (snap) => {
      if (snap.exists()) setQueueEngine(snap.data());
    });
    return () => unsub();
  }, [ticket]);

  // THE FIX: doctor_id isolation AND ["arrived", "called"] hallway bridge
  useEffect(() => {
    if (!ticket?.session_key || !ticket?.doctor_id) return;
    const q = query(
      collection(db, "today_queue"),
      where("doctor_id", "==", ticket.doctor_id),
      where("session_key", "==", ticket.session_key),
      where("status", "in", ["arrived", "called"]) 
    );
    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      docs.sort((a, b) => {
        const PENALTY_WEIGHT = 3;
        const aVirtualToken = a.token_number + ((a.penalty_count || 0) * PENALTY_WEIGHT);
        const bVirtualToken = b.token_number + ((b.penalty_count || 0) * PENALTY_WEIGHT);
        return aVirtualToken - bVirtualToken;
      });
      setActiveQueue(docs);
    });
    return () => unsub();
  }, [ticket?.session_key, ticket?.doctor_id]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setClockTick(Date.now()), 60000); 
    return () => window.clearInterval(intervalId);
  }, []);

  const getDynamicETA = () => {
    if (!ticket || !docProfile?.op_schedule || !queueEngine) return null;
    
    const isMorning = ticket.session_block === 'Morning';
    const scheduleConfig = isMorning ? docProfile.op_schedule.morning : docProfile.op_schedule.evening;
    if (!scheduleConfig || !scheduleConfig.startTime) return null;

    const sessionState = createSessionState(queueEngine.daily_bookings?.[ticket.session_key]);
    const myToken = ticket.token_number;
    
    let targetDate;
    let liveAvg;
    let displayAhead;
    let lobbyIndex;
    let currentElapsed = 0; 

    const myVirtualIndex = activeQueue.findIndex(t => t.id === ticket.id);
    
    if (myVirtualIndex !== -1) {
      lobbyIndex = myVirtualIndex; 
    } else {
      // Fallback: Safe math that handles penalties
      const currentServing = sessionState.current_serving_token || 0;
      lobbyIndex = Math.max(0, (myToken + (ticket.penalty_count * 3)) - currentServing - 1);
    }

    // MODE 1: LIVE SESSION
    if (sessionState.session_active) {
      liveAvg = sessionState.rolling_average || 5;
      
      // THE FIX: Check if someone is actually sitting in the room
      const hasActiveConsultation = sessionState.last_consultation_start_time != null;
      let currentRemainingMins = 0; // Default to 0 for an empty room

      if (hasActiveConsultation) {
        const startedAt = sessionState.last_consultation_start_time.toDate();
        currentElapsed = Math.floor(Math.max(0, (clockTick - startedAt.getTime()) / 60000));
        currentRemainingMins = Math.max(0, liveAvg - currentElapsed);
      }

      // MATH: Wait time only adds room time if someone is actually in it
      const totalWaitMins = currentRemainingMins + (lobbyIndex * liveAvg);
      targetDate = new Date(clockTick + (totalWaitMins * 60000));

      // UI: Display count only adds +1 if someone is actually in the room
      displayAhead = lobbyIndex + (hasActiveConsultation ? 1 : 0);

    } 
    // MODE 2: PRE-SESSION / PAUSED SESSION
    else {
      const [startHour, startMinute] = scheduleConfig.startTime.split(':').map(Number);
      liveAvg = sessionState.baseline_average || 5;
      
      const totalWaitMins = lobbyIndex * liveAvg;
      
      const [year, month, day] = ticket.appointment_date.split('-').map(Number);
      const scheduledStart = new Date(year, month - 1, day, startHour, startMinute);
      
      const anchorTime = Math.max(clockTick, scheduledStart.getTime());
      targetDate = new Date(anchorTime + (totalWaitMins * 60000));
      
      displayAhead = lobbyIndex;
    }

    if (ticket.status === 'called' || ticket.status === 'in_consultation') {
      displayAhead = 0;
    }

    const diffMs = targetDate.getTime() - clockTick;
    const minutesRemaining = Math.max(0, Math.ceil(diffMs / 60000));
    
    let countdownText = `${minutesRemaining} mins remaining`;
    
    if (minutesRemaining <= 0) countdownText = "Doctor Running Behind Schedule";

    // UX POLISH: Contextual overrides so the text always makes logical sense
    if (ticket.status === 'called') {
      countdownText = "Proceed to the room";
    } else if (ticket.status === 'in_consultation') {
      countdownText = "Consultation in progress";
    } else if (sessionState.session_active && !sessionState.last_consultation_start_time && minutesRemaining <= 0) {
      // If the timer is paused but the session is live, they are in the hallway!
      countdownText = "Waiting for next patient to enter";
    }

    return {
      clockTime: targetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      countdown: countdownText,
      ahead: displayAhead,
      liveAvg: liveAvg,
      currentElapsed: currentElapsed
    };
  };
  

  const getStateUI = () => {
    switch (ticket?.status) {
      case 'booked': return { color: 'bg-indigo-600', text: 'Booking Confirmed', desc: 'Proceed to hospital reception to check-in.' };
      case 'arrived': return { color: 'bg-blue-600', text: 'Checked In', desc: 'You are in the active queue. Please wait in the lobby.' };
      case 'called': return { color: 'bg-orange-500', text: 'Proceed to Room', desc: 'The doctor is ready for you now!' };
      case 'in_consultation': return { color: 'bg-emerald-600', text: 'In Consultation', desc: 'Your session has started.' };
      case 'completed': return { color: 'bg-gray-800', text: 'Completed', desc: 'Your consultation is finished. Thank you!' };
      case 'skipped': return { color: 'bg-red-600', text: 'Missed Call', desc: 'You missed your consultation. Please see reception.' };
      default: return { color: 'bg-gray-500', text: 'Loading...', desc: '' };
    }
  };

  if (!ticket || !queueEngine) return <div className="p-10 text-center font-bold text-gray-400">Verifying secure token...</div>;
  
  const ui = getStateUI();
  const etaData = getDynamicETA() || { clockTime: "--:--", countdown: "Calculating...", ahead: 0, liveAvg: 0, currentElapsed: 0 };
  const sessionState = createSessionState(queueEngine.daily_bookings?.[ticket.session_key]);

  const isActivelyWaiting = ['booked', 'arrived'].includes(ticket.status);

  return (
    <div className="min-h-screen bg-gray-50 p-6 flex flex-col items-center justify-center font-sans">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100">
        
        <div className={`p-6 text-white text-center transition-colors ${ui.color}`}>
          <h1 className="text-2xl font-bold tracking-tight">{ui.text}</h1>
          <p className="text-white/90 text-sm mt-1">{ui.desc}</p>
        </div>

        <div className="p-8 text-center space-y-6">
          
          <div className="text-left bg-gray-50 rounded-xl p-4 border border-gray-100 text-sm text-gray-600 space-y-2">
            <div className="flex items-center gap-2 font-medium"><User size={16} className="text-gray-400"/> {ticket.patient_name}</div>
            <div className="flex items-center gap-2 font-medium"><MapPin size={16} className="text-emerald-500"/> Room: <span className="text-emerald-700 font-black">{docProfile?.current_room || "Ask reception"}</span></div>
          </div>

          <div>
            <p className="text-gray-500 font-medium uppercase tracking-wide text-sm mb-2">Your Token</p>
            <div className="text-7xl font-extrabold text-gray-900">#{ticket.token_number}</div>
            {ticket.penalty_count > 0 && (
               <p className="text-orange-600 font-bold text-sm mt-2 flex items-center justify-center gap-1"><AlertCircle size={16}/> You missed your call. Re-added to queue.</p>
            )}
          </div>

          <div className="h-px w-full bg-gray-100"></div>

          <div className="bg-blue-50 rounded-2xl p-6 border border-blue-100 relative overflow-hidden">
            
            {sessionState.session_active && (
              <div className="absolute top-4 right-4 flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-100 px-2 py-1 rounded-full animate-pulse">
                <Activity size={12} /> LIVE
              </div>
            )}

            <div className="flex flex-col items-center justify-center gap-2 mb-2">
              <Clock className="text-blue-500" size={28} />
              <p className="text-blue-800 font-bold text-sm">Estimated Consultation</p>
              
              <span className="text-3xl font-black text-blue-900">
                {isActivelyWaiting ? etaData.clockTime : "--:--"}
              </span>
              
              {isActivelyWaiting && (
                <div className={`mt-1 flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold ${etaData.countdown.includes("Behind") ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"}`}>
                   <Timer size={14} /> {etaData.countdown}
                </div>
              )}
            </div>

            {isActivelyWaiting && sessionState.session_active && etaData.currentElapsed > 0 && (
               <div className="mt-2 text-xs text-blue-600 font-medium bg-blue-100/50 py-1.5 px-3 rounded-lg inline-block">
                 Current Patient: {etaData.currentElapsed} mins elapsed
               </div>
            )}

            {isActivelyWaiting && (
              <>
                <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-blue-100/50">
                  <div className="flex flex-col items-center">
                    <Users className="text-blue-400 mb-1" size={16} />
                    <span className="text-lg font-bold text-blue-900">{etaData.ahead}</span>
                    <span className="text-xs text-blue-500 font-medium">Ahead of you</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <Activity className="text-blue-400 mb-1" size={16} />
                    <span className="text-lg font-bold text-blue-900">{etaData.liveAvg}m</span>
                    <span className="text-xs text-blue-500 font-medium">Typical consult</span>
                  </div>
                </div>
                
                <div className="mt-5 text-[10px] text-blue-400 font-medium flex items-center justify-center gap-1 text-center leading-tight">
                  <Info size={12} className="shrink-0"/> ETA adjusts automatically based on live queue progress.
                </div>
              </>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}