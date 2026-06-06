import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { UserPlus, User, Activity, Stethoscope, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { createSessionState, getSessionConfig, getSessionKey } from '../utils/queueSession';

export default function ReceptionDesk() {
  // --- STATE FOR ONLINE CHECK-INS ---
  const [bookedPatients, setBookedPatients] = useState([]);

  // --- STATE FOR WALK-INS ---
  const [patientName, setPatientName] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedDoctor, setSelectedDoctor] = useState('');
  const [sessionBlock, setSessionBlock] = useState('Morning');
  const [isProcessing, setIsProcessing] = useState(false);

  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [activeDocProfile, setActiveDocProfile] = useState(null);

  // 1. Fetch Online Bookings waiting to Arrive
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    const q = query(
      collection(db, "today_queue"), 
      where("status", "==", "booked"),
      where("appointment_date", "==", today)
    );
    const unsub = onSnapshot(q, (snap) => {
      setBookedPatients(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsub();
  }, []);

  // 2. Fetch Organization Data
  useEffect(() => {
    const unsubDepts = onSnapshot(collection(db, "departments"), (snap) => {
      const depts = snap.docs.map(doc => doc.data().name);
      setDepartments(depts);
      if (depts.length > 0 && !selectedDept) setSelectedDept(depts[0]);
    });
    const unsubDocs = onSnapshot(collection(db, "doctors"), (snap) => {
      setDoctors(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => { unsubDepts(); unsubDocs(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3. Auto-update Walk-in Doctor selection
  useEffect(() => {
    const availableDocs = doctors.filter(d => d.department === selectedDept);
    if (availableDocs.length > 0) {
      setSelectedDoctor(availableDocs[0].id);
      setActiveDocProfile(availableDocs[0]);
    } else {
      setSelectedDoctor('');
      setActiveDocProfile(null);
    }
  }, [selectedDept, doctors]);

  useEffect(() => {
    if (selectedDoctor) setActiveDocProfile(doctors.find(d => d.id === selectedDoctor));
  }, [selectedDoctor, doctors]);

  // --- ACTIONS ---

  // Action A: Verify Online Booking (Booked -> Arrived)
  const markAsArrived = async (tokenId) => {
    try {
      await updateDoc(doc(db, "today_queue", tokenId), {
        status: "arrived",
        is_physically_present: true
      });
    } catch (error) {
      console.error("Error updating status:", error);
    }
  };

  // Action B: Process New Walk-In
  const handleWalkIn = async (e) => {
    e.preventDefault();
    if (!patientName || phone.length !== 10 || !selectedDoctor || !activeDocProfile) return alert("Fill all required fields.");
    setIsProcessing(true);

    const doctorQueueRef = doc(db, "doctor_queues", selectedDoctor);
    const today = new Date().toISOString().split('T')[0];

    try {
      await runTransaction(db, async (transaction) => {
        const queueSnap = await transaction.get(doctorQueueRef);
        if (!queueSnap.exists()) throw new Error('INIT_ERROR');
        
        const queueData = queueSnap.data();

        // Capacity Check for Walk-ins
        const blockKey = getSessionKey(today, sessionBlock);
        const dailyBookingsMap = queueData.daily_bookings || {};
        
        const sessionConfig = getSessionConfig(activeDocProfile, sessionBlock);
        const maxCapacity = sessionConfig?.capacity || 20;
        const sessionState = createSessionState(dailyBookingsMap[blockKey], maxCapacity);
        const blockCount = sessionState.last_token;

        if (blockCount >= maxCapacity) throw new Error('CAPACITY_FULL');
        const nextToken = sessionState.last_token + 1;
        const nextSessionState = {
          ...sessionState,
          last_token: nextToken,
          capacity: maxCapacity
        };

        // 1. Create Patient Profile Auto-ID
        const newPatientRef = doc(collection(db, "patients"));
        transaction.set(newPatientRef, {
          full_name: patientName, phone_number: "+91" + phone, registration_type: "walk-in", last_updated: new Date()
        });

        // 2. Add to Queue as ARRIVED immediately
        const queueRef = doc(collection(db, "today_queue"));
        const secureTrackerId = queueRef.id;

        transaction.set(queueRef, {
          tracker_id: secureTrackerId, token_number: nextToken, patient_uid: newPatientRef.id,
          patient_name: patientName, department: selectedDept, doctor_id: selectedDoctor,
          doctor_name: activeDocProfile.name, appointment_date: today,
          session_block: sessionBlock, session_key: blockKey, // Valid Morning/Evening block!
          is_physically_present: true, 
          status: "arrived", // Straight to active queue!
          booking_type: "walk-in", penalty_count: 0
        });

        // 3. Update this date/session counter only.
        transaction.update(doctorQueueRef, { 
          daily_bookings: { ...dailyBookingsMap, [blockKey]: nextSessionState }
        });

        return { nextToken, secureTrackerId };
      }).then((result) => {
        alert(`Success! Walk-In Token is #${result.nextToken}.`);
        setPatientName(''); setPhone('');
      });
      
    } catch (error) {
      if (error.message === 'CAPACITY_FULL') alert(`The ${sessionBlock} session for this doctor is fully booked!`);
      else alert("Registration failed. Ensure doctor is configured.");
    }
    setIsProcessing(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <div className="bg-emerald-100 p-4 rounded-2xl text-emerald-600">
            <UserPlus size={32} />
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">Reception Desk</h1>
            <p className="text-slate-500 font-medium">Verify online arrivals & Register walk-ins</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* LEFT: ONLINE CHECK-INS */}
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><CheckCircle size={20} className="text-blue-500"/> Pending Online Arrivals</h2>
            <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden h-150 overflow-y-auto">
              {bookedPatients.length === 0 ? (
                <div className="p-10 text-center text-slate-400 font-bold flex flex-col items-center gap-2">
                  <CheckCircle size={32} className="opacity-50"/> No pending arrivals right now.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {bookedPatients.map(patient => (
                    <div key={patient.id} className="p-5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="bg-blue-100 text-blue-700 font-black px-2 py-0.5 rounded text-sm">#{patient.token_number}</span>
                          <h3 className="font-bold text-slate-900">{patient.patient_name}</h3>
                        </div>
                        <p className="text-sm text-slate-500 mt-1 flex items-center gap-1"><Clock size={14}/> {patient.doctor_name} ({patient.session_block})</p>
                      </div>
                      <button 
                        onClick={() => markAsArrived(patient.id)}
                        className="flex items-center gap-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-bold px-4 py-2 rounded-xl transition-colors"
                      >
                        Verify Arrival
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: NEW WALK-IN REGISTRATION */}
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><UserPlus size={20} className="text-emerald-500"/> Walk-In Registration</h2>
            <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
              <form onSubmit={handleWalkIn} className="p-8 space-y-5">
                
                <div className="space-y-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Patient Name</label>
                    <div className="relative">
                      <User className="absolute left-4 top-3 text-slate-400" size={16} />
                      <input type="text" required placeholder="Full Name" value={patientName} onChange={(e) => setPatientName(e.target.value)} className="w-full pl-12 pr-4 py-2 bg-white border border-slate-200 rounded-xl font-medium text-slate-800" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Mobile Number</label>
                    <div className="relative flex items-center">
                      <span className="absolute left-4 font-bold text-slate-400">+91</span>
                      <input type="tel" required maxLength="10" placeholder="10-digit number" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} className="w-full pl-14 pr-4 py-2 bg-white border border-slate-200 rounded-xl font-bold text-slate-800" />
                    </div>
                  </div>
                </div>

                <div className="space-y-4 bg-emerald-50/50 p-4 rounded-2xl border border-emerald-100/50">
                  <div>
                    <label className="flex text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 items-center gap-1"><Stethoscope size={14} className="text-emerald-500"/> Department</label>
                    <select required value={selectedDept} onChange={(e) => setSelectedDept(e.target.value)} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl font-medium text-slate-800">
                      {departments.map((dept, idx) => <option key={idx} value={dept}>{dept}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Assign Doctor</label>
                    <select required value={selectedDoctor} onChange={(e) => setSelectedDoctor(e.target.value)} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl font-medium text-slate-800">
                      {doctors.filter(d => d.department === selectedDept).map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Session Block</label>
                    <select required value={sessionBlock} onChange={(e) => setSessionBlock(e.target.value)} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl font-medium text-slate-800">
                      {activeDocProfile?.op_schedule?.morning?.enabled && <option value="Morning">Morning Session</option>}
                      {activeDocProfile?.op_schedule?.evening?.enabled && <option value="Evening">Evening Session</option>}
                    </select>
                  </div>
                </div>

                <button type="submit" disabled={isProcessing} className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-4 rounded-xl flex justify-center items-center gap-2 transition-all mt-4">
                  <UserPlus size={20} /> {isProcessing ? "Processing..." : "Generate Walk-In Token"}
                </button>
              </form>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
