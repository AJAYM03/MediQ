import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { doc, onSnapshot, collection, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Clock, AlertCircle, User, MapPin, Users, Activity, Timer, Info } from 'lucide-react';
import { createSessionState } from '../utils/queueSession';
import toast from 'react-hot-toast';

export default function PatientTracker() {
  const { tokenId } = useParams();
  
  // Core States
  const [ticket, setTicket] = useState(null);
  const [patientName, setPatientName] = useState("Loading..."); // <-- PII STATE
  const [docProfile, setDocProfile] = useState(null);
  const [queueEngine, setQueueEngine] = useState(null);
  const [activeQueue, setActiveQueue] = useState([]); 
  
  const [clockTick, setClockTick] = useState(() => Date.now()); 

  // 1. Fetch Public Math Ticket (today_queue)
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "today_queue", tokenId), (snap) => {
      if (snap.exists()) setTicket({ id: snap.id, ...snap.data() });
    });
    return () => unsub();
  }, [tokenId]);

  // 2. Fetch Secure Identity (queue_pii) - NEW ARCHITECTURE
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "queue_pii", tokenId), (snap) => {
      if (snap.exists()) {
        setPatientName(snap.data().patient_name);
      } else {
        setPatientName("Patient");
      }
    });
    return () => unsub();
  }, [tokenId]);

  // 3. Proactive Notifications
  useEffect(() => {
    if (ticket?.status === 'called') {
      toast.success("It's your turn! Please proceed to the room.", {
        duration: 8000,
        icon: '👨‍⚕️',
      });
    } else if (ticket?.status === 'skipped') {
      toast.error("You missed your call! Please see reception.", {
        duration: 8000,
      });
    }
  }, [ticket?.status]);

  // 4. Fetch Doctor & Queue State
  useEffect(() => {
    if (!ticket?.doctor_id) return;
    const unsubDocs = onSnapshot(doc(db, "doctors", ticket.doctor_id), (snap) => {
      if (snap.exists()) setDocProfile(snap.data());
    });
    const unsubQueue = onSnapshot(doc(db, "doctor_queues", ticket.doctor_id), (snap) => {
      if (snap.exists()) setQueueEngine(snap.data());
    });
    return () => { unsubDocs(); unsubQueue(); };
  }, [ticket?.doctor_id]);

  // 5. Fetch Active Lobby (Math Only, No PII)
  useEffect(() => {
    if (!ticket?.session_key || !ticket?.doctor_id) return;
    const q = query(
      collection(db, "today_queue"),
      where("doctor_id", "==", ticket.doctor_id),
      where("session_key", "==", ticket.session_key),
      where("status", "in", ["arrived", "called"]) 
    );
    const unsub = onSnapshot(q, (snap) => {
      // 🛡️ Map ONLY the math variables needed for ETA calculation
      const safeDocs = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          token_number: data.token_number,
          penalty_count: data.penalty_count || 0,
          status: data.status
        };
      });

      safeDocs.sort((a, b) => {
        const PENALTY_WEIGHT = 3;
        const aVirtualToken = a.token_number + (a.penalty_count * PENALTY_WEIGHT);
        const bVirtualToken = b.token_number + (b.penalty_count * PENALTY_WEIGHT);
        return aVirtualToken - bVirtualToken;
      });
      
      setActiveQueue(safeDocs);
    });
    return () => unsub();
  }, [ticket?.session_key, ticket?.doctor_id]);

  // Clock Engine
  useEffect(() => {
    const intervalId = window.setInterval(() => setClockTick(Date.now()), 60000); 
    return () => window.clearInterval(intervalId);
  }, []);

  const getDynamicETA = () => {
    if (!ticket || !docProfile?.op_schedule || !queueEngine) return null;
    
    if (['completed', 'skipped'].includes(ticket.status)) return null;
    
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
      const currentServing = sessionState.current_serving_token || 0;
      lobbyIndex = Math.max(0, (myToken + ((ticket.penalty_count || 0) * 3)) - currentServing - 1);
    }

    if (sessionState.session_active) {
      liveAvg = sessionState.rolling_average || 5;
      
      const hasActiveConsultation = sessionState.last_consultation_start_time != null;
      let currentRemainingMins = 0;

      if (hasActiveConsultation) {
        const startedAt = sessionState.last_consultation_start_time.toDate();
        currentElapsed = Math.floor(Math.max(0, (clockTick - startedAt.getTime()) / 60000));
        currentRemainingMins = Math.max(0, liveAvg - currentElapsed);
      }

      const totalWaitMins = currentRemainingMins + (lobbyIndex * liveAvg);
      targetDate = new Date(clockTick + (totalWaitMins * 60000));

      displayAhead = lobbyIndex + (hasActiveConsultation ? 1 : 0);

    } 
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
    const hasActiveConsultation = sessionState.last_consultation_start_time != null;
    
    let countdownText = `${minutesRemaining} mins remaining`;

    if (ticket.status === 'called') {
      countdownText = "Proceed to consultation room";
    } 
    else if (ticket.status === 'in_consultation') {
      countdownText = "Consultation in progress";
    } 
    else if (!sessionState.session_active) {
      if (sessionState.current_serving_token > 0) {
        if (ticket.status === 'arrived') {
          countdownText = "Waiting for next patient to be called";
        } else {
          countdownText = "Queue is currently empty / waiting for patients";
        }
      } else {
        countdownText = "Session has not started yet";
      }
    } 
    else if (!hasActiveConsultation) {
      if (displayAhead === 0) {
        countdownText = "You are next in line!";
      } else {
        countdownText = "Waiting for next patient to be called";
      }
    } 
    else {
      if (currentElapsed > (liveAvg * 2)) {
        countdownText = "Consultation taking longer than usual";
      } else if (minutesRemaining <= 0) {
        countdownText = "Doctor is finishing up current patient";
      }
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
  const etaData = getDynamicETA() || { clockTime: "--:--", countdown: "Consultation Ended", ahead: 0, liveAvg: 0, currentElapsed: 0 };
  const sessionState = createSessionState(queueEngine.daily_bookings?.[ticket.session_key]);

  const isActivelyWaiting = ['booked', 'arrived'].includes(ticket.status);

  // UX POLISH: Dynamic Header for the ETA block
  const getEtaHeader = () => {
    if (ticket.status === 'called') return "Action Required";
    if (ticket.status === 'in_consultation') return "Session Live";
    return "Estimated Consultation";
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 flex flex-col items-center justify-center font-sans">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100">
        
        <div className={`p-6 text-white text-center transition-colors ${ui.color}`}>
          <h1 className="text-2xl font-bold tracking-tight">{ui.text}</h1>
          <p className="text-white/90 text-sm mt-1">{ui.desc}</p>
        </div>

        <div className="p-8 text-center space-y-6">
          
          <div className="text-left bg-gray-50 rounded-xl p-4 border border-gray-100 text-sm text-gray-600 space-y-2">
            <div className="flex items-center gap-2 font-medium"><User size={16} className="text-gray-400"/> {patientName}</div>
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
            
            {sessionState.session_active && !['completed', 'skipped'].includes(ticket.status) && (
              <div className="absolute top-4 right-4 flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-100 px-2 py-1 rounded-full animate-pulse">
                <Activity size={12} /> LIVE
              </div>
            )}

            <div className="flex flex-col items-center justify-center gap-2 mb-2">
              <Clock className="text-blue-500" size={28} />
              <p className="text-blue-800 font-bold text-sm">{getEtaHeader()}</p>
              
              <span className="text-3xl font-black text-blue-900">
                {isActivelyWaiting ? etaData.clockTime : "--:--"}
              </span>
              
              {(isActivelyWaiting || ticket.status === 'called' || ticket.status === 'in_consultation') && (
                <div className={`mt-1 flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold ${etaData.countdown.includes("Behind") || etaData.countdown.includes("longer") ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"}`}>
                   <Timer size={14} /> {etaData.countdown}
                </div>
              )}
            </div>

            {ticket.status === 'in_consultation' && sessionState.session_active && etaData.currentElapsed > 0 && (
               <div className="mt-2 text-xs text-blue-600 font-medium bg-blue-100/50 py-1.5 px-3 rounded-lg inline-block">
                 Current Consultation: {etaData.currentElapsed} mins elapsed
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