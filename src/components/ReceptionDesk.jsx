import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { UserPlus, User, Stethoscope, CheckCircle, Clock, CalendarDays, QrCode, Copy, Check } from 'lucide-react';
import { createSessionState, getSessionConfig, getSessionKey } from '../utils/queueSession';
import { QRCodeSVG } from 'qrcode.react';

export default function ReceptionDesk() {
  // --- UI & NAVIGATION STATES ---
  const [activeTab, setActiveTab] = useState('today'); // 'today', 'future', 'walkin'

  // --- DATA STATES ---
  const [bookedPatients, setBookedPatients] = useState([]);
  const [futureBookings, setFutureBookings] = useState([]);

  // --- WALK-IN STATES ---
  const [patientName, setPatientName] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedDoctor, setSelectedDoctor] = useState('');
  const [sessionBlock, setSessionBlock] = useState('Morning');
  const [isProcessing, setIsProcessing] = useState(false);

  // --- HANDOFF STATES ---
  const [generatedTracker, setGeneratedTracker] = useState(null); 
  const [copied, setCopied] = useState(false);

  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [activeDocProfile, setActiveDocProfile] = useState(null);

  // 1. Fetch Today's Online Bookings
  useEffect(() => {
    const today = new Date().toLocaleDateString('en-CA'); // Format: YYYY-MM-DD
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

  // 2. Fetch Future Bookings Directory
  useEffect(() => {
    const today = new Date().toLocaleDateString('en-CA'); // Format: YYYY-MM-DD 
    const q = query(
      collection(db, "today_queue"), 
      where("status", "==", "booked"),
      where("appointment_date", ">", today) 
    );
    const unsub = onSnapshot(q, (snap) => {
      setFutureBookings(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsub();
  }, []);

  // 3. Fetch Organization Data & Initial Load
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

  // 4. Initial sync of Doctor when data first loads
  useEffect(() => {
    if (!selectedDoctor) {
      const availableDocs = doctors.filter(d => d.department === selectedDept);
      if (availableDocs.length > 0) {
        setSelectedDoctor(availableDocs[0].id);
        setActiveDocProfile(availableDocs[0]);
        
        // Safely set initial session
        const hasMorning = availableDocs[0].op_schedule?.morning?.enabled;
        const hasEvening = availableDocs[0].op_schedule?.evening?.enabled;
        if (!hasMorning && hasEvening) setSessionBlock('Evening');
      }
    }
  }, [selectedDept, doctors, selectedDoctor]);


  // --- EXPLICIT UI EVENT HANDLERS (Fixes the Session State Bug) ---
  
  const handleDeptChange = (e) => {
    const newDept = e.target.value;
    setSelectedDept(newDept);
    
    const availableDocs = doctors.filter(d => d.department === newDept);
    if (availableDocs.length > 0) {
      const firstDoc = availableDocs[0];
      setSelectedDoctor(firstDoc.id);
      setActiveDocProfile(firstDoc);
      
      // Force correct session block state
      const hasMorning = firstDoc.op_schedule?.morning?.enabled;
      const hasEvening = firstDoc.op_schedule?.evening?.enabled;
      if (!hasMorning && hasEvening) setSessionBlock('Evening');
      else if (hasMorning && !hasEvening) setSessionBlock('Morning');
    } else {
      setSelectedDoctor('');
      setActiveDocProfile(null);
    }
  };

  const handleDoctorChange = (e) => {
    const docId = e.target.value;
    setSelectedDoctor(docId);
    
    const docProfile = doctors.find(d => d.id === docId);
    setActiveDocProfile(docProfile || null);
    
    // Force correct session block state when manually changing doctors
    if (docProfile) {
      const hasMorning = docProfile.op_schedule?.morning?.enabled;
      const hasEvening = docProfile.op_schedule?.evening?.enabled;
      if (!hasMorning && hasEvening) setSessionBlock('Evening');
      else if (hasMorning && !hasEvening) setSessionBlock('Morning');
    }
  };


  // --- ACTIONS ---

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

  const handleWalkIn = async (e) => {
    e.preventDefault();
    if (!patientName || phone.length !== 10 || !selectedDoctor || !activeDocProfile) return alert("Fill all required fields.");
    setIsProcessing(true);

    const doctorQueueRef = doc(db, "doctor_queues", selectedDoctor);
    const today = new Date().toLocaleDateString('en-CA'); // Format: YYYY-MM-DD

    try {
      await runTransaction(db, async (transaction) => {
        const queueSnap = await transaction.get(doctorQueueRef);
        if (!queueSnap.exists()) throw new Error('INIT_ERROR');
        
        const queueData = queueSnap.data();

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

        const newPatientRef = doc(collection(db, "patients"));
        transaction.set(newPatientRef, {
          full_name: patientName, phone_number: "+91" + phone, registration_type: "walk-in", last_updated: new Date()
        });

        const queueRef = doc(collection(db, "today_queue"));
        const secureTrackerId = queueRef.id;

        transaction.set(queueRef, {
          tracker_id: secureTrackerId, token_number: nextToken, patient_uid: newPatientRef.id,
          patient_name: patientName, department: selectedDept, doctor_id: selectedDoctor,
          doctor_name: activeDocProfile.name, appointment_date: today,
          session_block: sessionBlock, session_key: blockKey, 
          is_physically_present: true, 
          status: "arrived", 
          booking_type: "walk-in", penalty_count: 0
        });

        transaction.update(doctorQueueRef, { 
          daily_bookings: { ...dailyBookingsMap, [blockKey]: nextSessionState }
        });

        return { nextToken, secureTrackerId };
      }).then((result) => {
        const trackerUrl = `${window.location.origin}/tracker/${result.secureTrackerId}`;
        setGeneratedTracker({ 
          token: result.nextToken, 
          url: trackerUrl, 
          name: patientName 
        });
        
        setPatientName(''); setPhone('');
      });
      
    } catch (error) {
      if (error.message === 'CAPACITY_FULL') alert(`The ${sessionBlock} session for this doctor is fully booked!`);
      else alert("Registration failed. Ensure doctor is configured.");
    }
    setIsProcessing(false);
  };

  const copyToClipboard = () => {
    if (generatedTracker) {
      navigator.clipboard.writeText(generatedTracker.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header & Navigation Tabs */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <div className="bg-emerald-100 p-4 rounded-2xl text-emerald-600">
              <UserPlus size={32} />
            </div>
            <div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">Reception Desk</h1>
              <p className="text-slate-500 font-medium">Verify online arrivals & Register walk-ins</p>
            </div>
          </div>

          <div className="flex bg-white rounded-xl shadow-sm border border-slate-200 p-1 w-full md:w-auto">
            <button onClick={() => setActiveTab('today')} className={`flex-1 md:flex-none px-4 py-2 rounded-lg font-bold text-sm flex justify-center items-center gap-2 transition-colors ${activeTab === 'today' ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50'}`}>
              <CheckCircle size={16}/> Today's Check-In
            </button>
            <button onClick={() => setActiveTab('future')} className={`flex-1 md:flex-none px-4 py-2 rounded-lg font-bold text-sm flex justify-center items-center gap-2 transition-colors ${activeTab === 'future' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}>
              <CalendarDays size={16}/> Future Bookings
            </button>
            <button onClick={() => setActiveTab('walkin')} className={`flex-1 md:flex-none px-4 py-2 rounded-lg font-bold text-sm flex justify-center items-center gap-2 transition-colors ${activeTab === 'walkin' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-500 hover:bg-slate-50'}`}>
              <UserPlus size={16}/> Walk-In Registration
            </button>
          </div>
        </div>

        {/* TAB 1: TODAY'S ARRIVALS */}
        {activeTab === 'today' && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden max-w-3xl mx-auto">
            <div className="p-5 border-b border-slate-100 bg-slate-50/50">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Clock className="text-blue-500" size={20}/> Check-In Queue (Today)</h2>
            </div>
            {bookedPatients.length === 0 ? (
              <div className="p-10 text-center text-slate-400 font-bold flex flex-col items-center gap-2">
                <CheckCircle size={32} className="opacity-50"/> No pending arrivals right now.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 h-96 overflow-y-auto">
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
        )}

        {/* TAB 2: FUTURE BOOKINGS DIRECTORY */}
        {activeTab === 'future' && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden max-w-3xl mx-auto">
            <div className="p-5 border-b border-slate-100 bg-slate-50/50">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><CalendarDays className="text-indigo-500" size={20}/> Upcoming Appointments Directory</h2>
            </div>
            {futureBookings.length === 0 ? (
              <div className="p-10 text-center text-slate-400 font-bold">No future bookings found.</div>
            ) : (
              <div className="divide-y divide-slate-100 h-96 overflow-y-auto">
                {futureBookings.map(patient => (
                  <div key={patient.id} className="p-5 flex items-center justify-between hover:bg-slate-50">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-slate-100 text-slate-600 font-black px-2 py-0.5 rounded text-xs">{patient.appointment_date}</span>
                        <h3 className="font-bold text-slate-900">{patient.patient_name}</h3>
                      </div>
                      <p className="text-sm text-slate-500">Token #{patient.token_number} • {patient.doctor_name} ({patient.session_block})</p>
                    </div>
                    <span className="text-xs font-bold text-slate-400 uppercase bg-slate-100 px-2 py-1 rounded">Booked</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: WALK-IN REGISTRATION & QR HANDOFF */}
        {activeTab === 'walkin' && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden max-w-2xl mx-auto">
            
            {generatedTracker ? (
              <div className="p-10 text-center space-y-6">
                <div className="w-20 h-20 bg-emerald-100 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-2">
                  <CheckCircle size={40} />
                </div>
                <div>
                  <h2 className="text-2xl font-black text-slate-900">{generatedTracker.name} Registered</h2>
                  <p className="text-slate-500 font-medium">Session Token <span className="font-black text-emerald-600 text-lg">#{generatedTracker.token}</span></p>
                </div>
                
                <div className="flex justify-center p-6 bg-slate-50 rounded-2xl border border-slate-100">
                  <QRCodeSVG value={generatedTracker.url} size={200} level={"H"} />
                </div>
                <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Ask patient to scan for live ETA</p>

                <div className="flex gap-3 mt-6">
                  <button onClick={copyToClipboard} className="flex-1 flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl transition-colors">
                    {copied ? <Check size={18} className="text-emerald-500"/> : <Copy size={18}/>} {copied ? "Copied!" : "Copy Link"}
                  </button>
                  <button onClick={() => setGeneratedTracker(null)} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-colors">
                    Register Next
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleWalkIn} className="p-8 space-y-5">
                <div className="p-5 border-b border-slate-100 bg-slate-50/50 -mx-8 -mt-8 mb-6">
                  <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><UserPlus className="text-emerald-500" size={20}/> New Walk-In</h2>
                </div>
                
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
                    {/* BIND THE NEW HANDLER HERE */}
                    <select required value={selectedDept} onChange={handleDeptChange} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl font-medium text-slate-800">
                      {departments.map((dept, idx) => <option key={idx} value={dept}>{dept}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Assign Doctor</label>
                    {/* BIND THE NEW HANDLER HERE */}
                    <select required value={selectedDoctor} onChange={handleDoctorChange} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl font-medium text-slate-800">
                      {doctors.filter(d => d.department === selectedDept).map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Session Block</label>
                    {/* This dropdown safely displays only what is available, and obeys the state set by the handlers above */}
                    <select required value={sessionBlock} onChange={(e) => setSessionBlock(e.target.value)} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl font-medium text-slate-800">
                      {activeDocProfile?.op_schedule?.morning?.enabled && <option value="Morning">Morning Session</option>}
                      {activeDocProfile?.op_schedule?.evening?.enabled && <option value="Evening">Evening Session</option>}
                    </select>
                  </div>
                </div>

                <button type="submit" disabled={isProcessing} className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-4 rounded-xl flex justify-center items-center gap-2 transition-all mt-4">
                  <QrCode size={20} /> {isProcessing ? "Processing..." : "Generate Token & QR Tracker"}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}