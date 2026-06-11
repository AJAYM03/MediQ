import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { doc, getDoc, collection, runTransaction, onSnapshot, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { User, CalendarPlus, ArrowRight, ShieldCheck, Activity, Calendar, Stethoscope, Clock, AlertCircle } from 'lucide-react';
import { createSessionState, getSessionConfig, getSessionKey } from '../utils/queueSession';

export default function PatientOnboarding() {
  const navigate = useNavigate();
  
  const [step, setStep] = useState(1); 
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Form States
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [uid, setUid] = useState(null);
  
  // Booking States
  const [patientName, setPatientName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('Male');
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedDoctor, setSelectedDoctor] = useState('');
  const [bookingDate, setBookingDate] = useState('');
  const [sessionBlock, setSessionBlock] = useState('Morning');

  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [activeDocProfile, setActiveDocProfile] = useState(null);

  // 1. Initialize Recaptcha & Default Date
  useEffect(() => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
    }
    const today = new Date().toISOString().split('T')[0];
    setBookingDate(today);
  }, []);

  // 2. Fetch Organizations & Initial Sync
  useEffect(() => {
    const unsubDepts = onSnapshot(collection(db, "departments"), (snap) => {
      const depts = snap.docs.map(doc => doc.data().name);
      setDepartments(depts);
      if (depts.length > 0 && !selectedDept) setSelectedDept(depts[0]);
    });
    
    const unsubDocs = onSnapshot(collection(db, "doctors"), (snap) => {
      const docsList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setDoctors(docsList);
    });
    
    return () => { unsubDepts(); unsubDocs(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3. Initial Load: Auto-select first available doctor when data arrives
  useEffect(() => {
    if (!selectedDoctor && doctors.length > 0 && selectedDept) {
      const availableDocs = doctors.filter(d => d.department === selectedDept);
      if (availableDocs.length > 0) {
        const firstDoc = availableDocs[0];
        setSelectedDoctor(firstDoc.id);
        setActiveDocProfile(firstDoc);
        
        const hasMorning = firstDoc.op_schedule?.morning?.enabled;
        const hasEvening = firstDoc.op_schedule?.evening?.enabled;
        if (!hasMorning && hasEvening) setSessionBlock('Evening');
      }
    }
  }, [doctors, selectedDept, selectedDoctor]);

  // --- EXPLICIT UI EVENT HANDLERS (Replaces buggy useEffects) ---

  const handleDeptChange = (e) => {
    const newDept = e.target.value;
    setSelectedDept(newDept);
    
    const availableDocs = doctors.filter(d => d.department === newDept);
    if (availableDocs.length > 0) {
      const firstDoc = availableDocs[0];
      setSelectedDoctor(firstDoc.id);
      setActiveDocProfile(firstDoc);
      
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
    
    if (docProfile) {
      const hasMorning = docProfile.op_schedule?.morning?.enabled;
      const hasEvening = docProfile.op_schedule?.evening?.enabled;
      if (!hasMorning && hasEvening) setSessionBlock('Evening');
      else if (hasMorning && !hasEvening) setSessionBlock('Morning');
    }
  };

  // --- AUTH & BOOKING ACTIONS ---

  const formatAvailableDays = (daysArray) => {
    if (!daysArray || daysArray.length === 0) return "Not Scheduled";
    if (daysArray.length === 7) return "Everyday";
    const dayMap = {0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat'};
    return daysArray.sort().map(d => dayMap[d]).join(', ');
  };

  const requestOTP = async (e) => {
    e.preventDefault();
    if (phone.length !== 10) return alert("Enter a valid 10-digit number");
    setIsProcessing(true);
    try {
      const confirmationResult = await signInWithPhoneNumber(auth, "+91" + phone, window.recaptchaVerifier);
      window.confirmationResult = confirmationResult;
      setStep(2); 
    } catch (error) { alert("Failed to send OTP."); }
    setIsProcessing(false);
  };

  const verifyOTP = async (e) => {
    e.preventDefault();
    if (otp.length !== 6) return alert("Enter 6-digit OTP");
    setIsProcessing(true);
    try {
      const result = await window.confirmationResult.confirm(otp);
      setUid(result.user.uid);
      const patientSnap = await getDoc(doc(db, "patients", result.user.uid));
      if (patientSnap.exists()) {
        setPatientName(patientSnap.data().full_name);
        setAge(patientSnap.data().age);
        setGender(patientSnap.data().gender);
      }
      setStep(3); 
    } catch (error) { alert("Incorrect OTP."); }
    setIsProcessing(false);
  };

  const handleBooking = async (e) => {
    e.preventDefault();
    if (!patientName || !age || !bookingDate || !activeDocProfile) return alert("Please fill all details");
    
    setIsProcessing(true);

    const [year, month, day] = bookingDate.split('-');
    const selectedDateObj = new Date(year, month - 1, day);
    const dayOfWeek = selectedDateObj.getDay();

    if (!activeDocProfile.available_days?.includes(dayOfWeek)) {
      alert(`Dr. ${activeDocProfile.name} does not consult on ${selectedDateObj.toLocaleDateString('en-US', {weekday: 'long'})}s.\nAvailable: ${formatAvailableDays(activeDocProfile.available_days)}`);
      setIsProcessing(false);
      return;
    }

    const doctorQueueRef = doc(db, "doctor_queues", selectedDoctor);

    try {
      const generatedTrackerId = await runTransaction(db, async (transaction) => {
        const queueSnap = await transaction.get(doctorQueueRef);
        if (!queueSnap.exists()) throw new Error('INIT_ERROR');
        
        const queueData = queueSnap.data();
        
        const sessionConfig = getSessionConfig(activeDocProfile, sessionBlock);
        const maxCapacity = sessionConfig?.capacity || 20; 
        
        const blockKey = getSessionKey(bookingDate, sessionBlock); 
        const dailyBookingsMap = queueData.daily_bookings || {};
        const sessionState = createSessionState(dailyBookingsMap[blockKey], maxCapacity);
        const blockCount = sessionState.last_token;

        if (blockCount >= maxCapacity) {
          throw new Error('CAPACITY_FULL');
        }

        const nextToken = sessionState.last_token + 1;
        const nextSessionState = {
          ...sessionState,
          last_token: nextToken,
          capacity: maxCapacity
        };

        // Save Profile
        transaction.set(doc(db, "patients", uid), {
          full_name: patientName, age: Number(age), gender: gender, phone_number: "+91" + phone,
          last_updated: new Date(), active_bookings: arrayUnion(`${selectedDoctor}_${blockKey}`) 
        }, { merge: true });

        // Generate Ticket
        const queueRef = doc(collection(db, "today_queue")); 
        const secureTrackerId = queueRef.id;

        transaction.set(queueRef, {
          tracker_id: secureTrackerId, token_number: nextToken, patient_uid: uid,
          patient_name: patientName, department: selectedDept, doctor_id: selectedDoctor,
          doctor_name: activeDocProfile.name, appointment_date: bookingDate,
          session_block: sessionBlock, session_key: blockKey, is_physically_present: false, 
          status: "booked", booking_type: "app", penalty_count: 0
        });

        // Increment only this doctor/date/session counter.
        transaction.update(doctorQueueRef, { 
          daily_bookings: { ...dailyBookingsMap, [blockKey]: nextSessionState }
        });

        return secureTrackerId;
      });

      navigate(`/tracker/${generatedTrackerId}`);
      
    } catch (error) {
      console.error("Booking Failed:", error);
      if (error.message === 'CAPACITY_FULL') {
        const sessionConfig = sessionBlock === 'Morning' 
            ? activeDocProfile?.op_schedule?.morning 
            : activeDocProfile?.op_schedule?.evening;
        const capacityMsg = sessionConfig?.capacity || 20;
        
        alert(`The ${sessionBlock} session is fully booked (Max ${capacityMsg} patients). Please select another date or session.`);
      } else {
        alert("Booking failed. Please ensure Admin has fully configured this doctor.");
      }
    }
    setIsProcessing(false);
  };

  return (
    <div className="min-h-screen bg-blue-50 p-6 flex flex-col items-center justify-center font-sans">
      <div id="recaptcha-container"></div>
      
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-xl border border-gray-100 p-8">
        
        <div className="text-center mb-8">
          <div className="bg-blue-100 w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 text-blue-600">
             <Activity size={28} />
          </div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">MediQ Outpatient</h1>
          <p className="text-gray-500 font-medium text-sm mt-0.5">Unified Booking Portal</p>
        </div>

        {step === 1 && (
          <form onSubmit={requestOTP} className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-2 tracking-wide">Mobile Number</label>
              <div className="relative flex items-center">
                <span className="absolute left-4 font-bold text-gray-500">+91</span>
                <input type="tel" required maxLength="10" placeholder="Enter 10-digit number" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} className="w-full pl-14 pr-4 py-4 bg-gray-50 border border-gray-200 rounded-2xl font-bold text-lg text-gray-800" />
              </div>
            </div>
            <button type="submit" disabled={isProcessing} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl flex justify-center gap-2">
              {isProcessing ? "Sending OTP..." : "Send Verification SMS"} <ArrowRight size={20} />
            </button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={verifyOTP} className="space-y-5">
             <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl flex gap-3 text-emerald-800 text-sm font-medium">
                <ShieldCheck size={20} className="shrink-0 text-emerald-600" /> <p>Security token sent to +91 {phone}</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-2 tracking-wide">Enter 6-Digit Code</label>
              <input type="text" required maxLength="6" placeholder="••••••" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} className="w-full px-4 py-4 bg-gray-50 border border-gray-200 rounded-2xl font-bold text-2xl tracking-[0.5em] text-center text-gray-900" />
            </div>
            <button type="submit" disabled={isProcessing} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 rounded-2xl flex justify-center gap-2">
              {isProcessing ? "Verifying..." : "Confirm Verification"}
            </button>
          </form>
        )}

        {step === 3 && (
          <form onSubmit={handleBooking} className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
            
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 space-y-3">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">1. Patient Information</h3>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 text-gray-400" size={16} />
                  <input type="text" required placeholder="As per ID details" value={patientName} onChange={(e) => setPatientName(e.target.value)} className="w-full pl-10 pr-3 py-2 bg-white border border-gray-200 rounded-xl font-medium text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Age</label>
                  <input type="number" required placeholder="Years" value={age} onChange={(e) => setAge(e.target.value)} className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Gender</label>
                  <select value={gender} onChange={(e) => setGender(e.target.value)} className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium text-sm">
                    <option>Male</option><option>Female</option><option>Other</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100/50 space-y-3">
              <h3 className="text-xs font-bold text-blue-500 uppercase tracking-wider mb-1">2. Practitioner Selection</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="flex text-xs font-semibold text-gray-600 mb-1 items-center gap-1"><Stethoscope size={14} className="text-blue-500" /> Department</label>
                  {/* EXPLICIT HANDLER ATTACHED */}
                  <select required value={selectedDept} onChange={handleDeptChange} className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium text-sm">
                    {departments.length === 0 && <option value="">No Departments setup</option>}
                    {departments.map((dept, idx) => <option key={idx} value={dept}>{dept}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Assign Practitioner</label>
                  {/* EXPLICIT HANDLER ATTACHED */}
                  <select required value={selectedDoctor} onChange={handleDoctorChange} className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium text-sm">
                    {doctors.filter(d => d.department === selectedDept).length === 0 && <option value="">No Doctors</option>}
                    {doctors.filter(doc => doc.department === selectedDept).map((doc) => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
                  </select>
                </div>
              </div>
              
              {activeDocProfile && (
                <div className="mt-2 text-xs font-bold text-blue-600 flex items-center gap-1.5 bg-blue-100/50 p-2 rounded-lg border border-blue-200">
                  <AlertCircle size={14} /> Available: {formatAvailableDays(activeDocProfile.available_days)}
                </div>
              )}
            </div>

            <div className="bg-indigo-50/40 p-4 rounded-2xl border border-indigo-100/40 space-y-3">
              <h3 className="text-xs font-bold text-indigo-500 uppercase tracking-wider mb-1">3. Schedule Stream</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="flex text-xs font-semibold text-gray-600 mb-1 items-center gap-1"><Calendar size={14} className="text-indigo-500" /> Choose Date</label>
                  <input type="date" required min={new Date().toISOString().split('T')[0]} value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium text-sm" />
                </div>
                <div>
                  <label className="flex text-xs font-semibold text-gray-600 mb-1 items-center gap-1"><Clock size={14} className="text-indigo-500" /> Session Block</label>
                  <select value={sessionBlock} onChange={(e) => setSessionBlock(e.target.value)} className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-medium text-sm">
                    {/* DYNAMICALLY HIDE DISABLED SESSIONS */}
                    {activeDocProfile?.op_schedule?.morning?.enabled && <option value="Morning">Morning Session</option>}
                    {activeDocProfile?.op_schedule?.evening?.enabled && <option value="Evening">Evening Session</option>}
                  </select>
                </div>
              </div>
            </div>

            <button type="submit" disabled={isProcessing} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl flex justify-center gap-2">
              <CalendarPlus size={20} /> {isProcessing ? "Securing Token..." : "Confirm Booking & Generate ETA"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}