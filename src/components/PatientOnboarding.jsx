import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { doc, getDoc, collection, runTransaction, onSnapshot, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { User, CalendarPlus, ArrowRight, ShieldCheck, Activity, Calendar, Stethoscope, Clock } from 'lucide-react';

export default function PatientOnboarding() {
  const navigate = useNavigate();
  
  // UI Steps: 1 = Phone Input, 2 = OTP Verification, 3 = Complete Profile & Book
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

  // Dynamic Database States (Zero Hardcoding)
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);

  // 1. Initialize reCAPTCHA & Set Default Date
  useEffect(() => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible'
      });
    }
    const today = new Date().toISOString().split('T')[0];
    setBookingDate(today);
  }, []);

  // 2. Fetch Live Organization Data from Admin Dashboard
  useEffect(() => {
    const unsubDepts = onSnapshot(collection(db, "departments"), (snap) => {
      const depts = snap.docs.map(doc => doc.data().name);
      setDepartments(depts);
      // Auto-select first department if none is selected
      if (depts.length > 0 && !selectedDept) setSelectedDept(depts[0]);
    });

    const unsubDocs = onSnapshot(collection(db, "doctors"), (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setDoctors(docs);
    });

    return () => { unsubDepts(); unsubDocs(); };
  }, []);

  // 3. Auto-update Doctor selection when Department changes
  useEffect(() => {
    const availableDocs = doctors.filter(d => d.department === selectedDept);
    if (availableDocs.length > 0) {
      setSelectedDoctor(availableDocs[0].id);
    } else {
      setSelectedDoctor('');
    }
  }, [selectedDept, doctors]);

  // Handle Phone Submit
  const requestOTP = async (e) => {
    e.preventDefault();
    if (phone.length !== 10) return alert("Enter a valid 10-digit number");
    setIsProcessing(true);

    try {
      const phoneNumber = "+91" + phone;
      const appVerifier = window.recaptchaVerifier;
      const confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);
      window.confirmationResult = confirmationResult;
      setStep(2); 
    } catch (error) {
      console.error("SMS Error:", error);
      alert("Failed to send OTP. (Check if test numbers are configured in Firebase)");
    }
    setIsProcessing(false);
  };

  // Handle OTP Verification
  const verifyOTP = async (e) => {
    e.preventDefault();
    if (otp.length !== 6) return alert("Enter 6-digit OTP");
    setIsProcessing(true);

    try {
      const result = await window.confirmationResult.confirm(otp);
      const user = result.user;

        setUid(user.uid);

      // Check if they are a returning patient to auto-fill details
      const patientRef = doc(db, "patients", user.uid);
      const patientSnap = await getDoc(patientRef);

      if (patientSnap.exists()) {
        setPatientName(patientSnap.data().full_name);
        setAge(patientSnap.data().age);
        setGender(patientSnap.data().gender);
      }
      setStep(3); 
    } catch (error) {
      console.error("Auth Error:", error);
      alert("Incorrect OTP.");
    }
    setIsProcessing(false);
  };

  // Handle Dynamic Booking Transaction
  const handleBooking = async (e) => {
    e.preventDefault();
    if (!patientName || !age || !bookingDate) return alert("Please fill all details");
    if (!selectedDoctor) return alert("No doctor available in this department.");
    
    setIsProcessing(true);
    const fullPhoneNumber = "+91" + phone;
    
    // Dynamically find the desk ID assigned to this specific doctor by the Admin
    const targetDoctor = doctors.find(d => d.id === selectedDoctor);
    const targetDeskId = targetDoctor ? targetDoctor.desk_id : 'op_desk_1';
    
    const clinicStatusRef = doc(db, "clinic_status", targetDeskId);

    try {
      await runTransaction(db, async (transaction) => {
        const clinicSnap = await transaction.get(clinicStatusRef);
        if (!clinicSnap.exists()) throw `Clinic desk ${targetDeskId} not initialized by admin!`;
        
        const nextToken = clinicSnap.data().last_issued_token + 1;

        // A. Save Profile in 'patients' collection using the Array Lock
        const patientRef = doc(db, "patients", uid);
        transaction.set(patientRef, {
          full_name: patientName,
          age: Number(age),
          gender: gender,
          phone_number: fullPhoneNumber,
          last_updated: new Date(),
          // arrayUnion safely appends the doctor's ID to the list, preventing duplicates
          active_bookings: arrayUnion(selectedDoctor) 
        }, { merge: true });

        // B. Append to 'today_queue'
        const queueRef = doc(collection(db, "today_queue")); 
        const secureTrackerId = queueRef.id;

        transaction.set(queueRef, {
          tracker_id: secureTrackerId, // Save the secure ID inside the document
          token_number: nextToken,     // The public display number (e.g., 15)
          patient_uid: uid,
          patient_name: patientName,
          department: selectedDept,
          doctor_id: selectedDoctor,
          doctor_name: targetDoctor.name,
          appointment_date: bookingDate,
          session_block: sessionBlock,
          is_physically_present: false, 
          status: "waiting",
          booking_type: "app",
          penalty_count: 0
        });

        // C. Increment the specific doctor's counter
        transaction.update(clinicStatusRef, { last_issued_token: nextToken });

        // D. Route to the SECURE personal tracker URL
        navigate(`/tracker/${secureTrackerId}`); // Now it routes to /tracker/aB3xY9Pq...
      });
    } catch (error) {
      console.error("Booking Transaction Failed:", error);
      alert("Booking failed. Please ensure Admin has fully configured this doctor.");
    }
    setIsProcessing(false);
  };

  return (
    <div className="min-h-screen bg-blue-50 p-6 flex flex-col items-center justify-center font-sans">
      <div id="recaptcha-container"></div>
      
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-xl border border-gray-100 p-8">
        
        {/* Header Block */}
        <div className="text-center mb-8">
          <div className="bg-blue-100 w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 text-blue-600">
             <Activity size={28} />
          </div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">City Hospital OP</h1>
          <p className="text-gray-500 font-medium text-sm mt-0.5">Unified Booking Portal</p>
        </div>

        {/* STEP 1: PHONE VERIFICATION */}
        {step === 1 && (
          <form onSubmit={requestOTP} className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-2 tracking-wide">Mobile Number</label>
              <div className="relative flex items-center">
                <span className="absolute left-4 font-bold text-gray-500">+91</span>
                <input 
                  type="tel" required maxLength="10"
                  placeholder="Enter 10-digit number"
                  value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                  className="w-full pl-14 pr-4 py-4 bg-gray-50 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold text-lg text-gray-800"
                />
              </div>
            </div>
            <button type="submit" disabled={isProcessing} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl flex justify-center gap-2 transition-all shadow-lg shadow-blue-200">
              {isProcessing ? "Sending OTP..." : "Send Verification SMS"} <ArrowRight size={20} />
            </button>
          </form>
        )}

        {/* STEP 2: OTP MATCH */}
        {step === 2 && (
          <form onSubmit={verifyOTP} className="space-y-5">
             <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl flex gap-3 text-emerald-800 text-sm font-medium">
                <ShieldCheck size={20} className="shrink-0 text-emerald-600" />
                <p>Security token sent to +91 {phone}</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-2 tracking-wide">Enter 6-Digit Code</label>
              <input 
                type="text" required maxLength="6" placeholder="••••••"
                value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                className="w-full px-4 py-4 bg-gray-50 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500 font-bold text-2xl tracking-[0.5em] text-center text-gray-900"
              />
            </div>
            <button type="submit" disabled={isProcessing} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 rounded-2xl flex justify-center gap-2 transition-all shadow-lg shadow-emerald-200">
              {isProcessing ? "Verifying..." : "Confirm Verification"}
            </button>
          </form>
        )}

        {/* STEP 3: INTEGRATED SCHEDULE & PRACTITIONER SELECTION */}
        {step === 3 && (
          <form onSubmit={handleBooking} className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
            
            {/* Core Profile */}
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 space-y-3">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">1. Patient Information</h3>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 text-gray-400" size={16} />
                  <input 
                    type="text" required placeholder="As per ID details"
                    value={patientName} onChange={(e) => setPatientName(e.target.value)}
                    className="w-full pl-10 pr-3 py-2 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium text-sm text-gray-800"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Age</label>
                  <input 
                    type="number" required placeholder="Years"
                    value={age} onChange={(e) => setAge(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium text-sm text-gray-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Gender</label>
                  <select 
                    value={gender} onChange={(e) => setGender(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium text-sm text-gray-700"
                  >
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Practitioner Filtering */}
            <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100/50 space-y-3">
              <h3 className="text-xs font-bold text-blue-500 uppercase tracking-wider mb-1">2. Practitioner Selection</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="flex text-xs font-semibold text-gray-600 mb-1 items-center gap-1">
                    <Stethoscope size={14} className="text-blue-500" /> Department
                  </label>
                  <select 
                    required
                    value={selectedDept} 
                    onChange={(e) => setSelectedDept(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium text-sm text-gray-700"
                  >
                    {departments.length === 0 && <option value="">No Departments setup</option>}
                    {departments.map((dept, idx) => (
                      <option key={idx} value={dept}>{dept}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Assign Practitioner</label>
                  <select 
                    required
                    value={selectedDoctor} 
                    onChange={(e) => setSelectedDoctor(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium text-sm text-gray-700"
                  >
                    {doctors.filter(d => d.department === selectedDept).length === 0 && (
                       <option value="">No Doctors available</option>
                    )}
                    {doctors
                      .filter(doc => doc.department === selectedDept)
                      .map((doc) => (
                        <option key={doc.id} value={doc.id}>{doc.name}</option>
                      ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Calendar & Blocks */}
            <div className="bg-indigo-50/40 p-4 rounded-2xl border border-indigo-100/40 space-y-3">
              <h3 className="text-xs font-bold text-indigo-500 uppercase tracking-wider mb-1">3. Schedule Stream</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="flex text-xs font-semibold text-gray-600 mb-1 items-center gap-1">
                    <Calendar size={14} className="text-indigo-500" /> Choose Date
                  </label>
                  <input 
                    type="date" required
                    value={bookingDate} onChange={(e) => setBookingDate(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium text-sm text-gray-800"
                  />
                </div>

                <div>
                  <label className="flex text-xs font-semibold text-gray-600 mb-1 items-center gap-1">
                    <Clock size={14} className="text-indigo-500" /> Session Block
                  </label>
                  <select 
                    value={sessionBlock} onChange={(e) => setSessionBlock(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium text-sm text-gray-700"
                  >
                    <option value="Morning">Morning Session</option>
                    <option value="Evening">Evening Session</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Submission Action */}
            <button 
              type="submit" disabled={isProcessing} 
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl flex justify-center gap-2 transition-all shadow-lg shadow-indigo-100 mt-4"
            >
              <CalendarPlus size={20} /> {isProcessing ? "Securing Token..." : "Confirm Booking & Generate ETA"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}