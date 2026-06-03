import { useState, useEffect } from 'react';
import { collection, doc, runTransaction, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { UserPlus, User, Activity, Stethoscope } from 'lucide-react';

export default function ReceptionDesk() {
  // Form States
  const [patientName, setPatientName] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedDoctor, setSelectedDoctor] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Dynamic Database States
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);

  // 1. Fetch Live Organization Data
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
  }, []);

  // 2. Auto-update Doctor selection based on Department
  useEffect(() => {
    const availableDocs = doctors.filter(d => d.department === selectedDept);
    if (availableDocs.length > 0) {
      setSelectedDoctor(availableDocs[0].id);
    } else {
      setSelectedDoctor('');
    }
  }, [selectedDept, doctors]);

  // 3. Handle Secure Walk-In Registration
  const handleWalkIn = async (e) => {
    e.preventDefault();
    if (!patientName || phone.length !== 10 || !selectedDoctor) return alert("Fill all required fields correctly.");
    setIsProcessing(true);

    const doctorQueueRef = doc(db, "doctor_queues", selectedDoctor);
    const fullPhoneNumber = "+91" + phone;

    try {
      await runTransaction(db, async (transaction) => {
        const clinicSnap = await transaction.get(doctorQueueRef);
        if (!clinicSnap.exists()) throw `Doctor queue ${selectedDoctor} not initialized!`;
        
        const nextToken = clinicSnap.data().last_issued_token + 1;

        // A. Update the 'patients' collection using an Auto-ID for Walk-Ins
        // We let Firestore generate a secure random ID instead of using the phone number
        const newPatientRef = doc(collection(db, "patients"));
        
        transaction.set(newPatientRef, {
          full_name: patientName,
          phone_number: fullPhoneNumber,
          registration_type: "walk-in",
          last_updated: new Date()
        });

        // B. Generate SECURE AUTO-ID for the queue
        const queueRef = doc(collection(db, "today_queue"));
        const secureTrackerId = queueRef.id;

        transaction.set(queueRef, {
          tracker_id: secureTrackerId,
          token_number: nextToken,
          patient_uid: newPatientRef.id, // For walk-ins, we can use the phone number as a reference in the queue
          patient_name: patientName,
          department: selectedDept,
          doctor_id: selectedDoctor,
          doctor_name: targetDoctor.name,
          appointment_date: new Date().toISOString().split('T')[0], // Automatically set to today
          session_block: "Walk-In", // Distinguishes from morning/evening app bookings
          is_physically_present: true, // They are already at the desk!
          status: "waiting",
          booking_type: "walk-in",
          penalty_count: 0
        });

        // C. Increment Doctor Counter
        transaction.update(doctorQueueRef, { last_issued_token: nextToken });

        // Pass the generated data back to the UI
        return { nextToken, secureTrackerId };
      }).then((result) => {
        alert(`Success! Patient Token is #${result.nextToken}.\nTracker Link generated.`);
        setPatientName('');
        setPhone('');
      });
      
    } catch (error) {
      console.error("Booking Failed:", error);
      alert("Failed to register walk-in. Make sure the Admin has fully configured this doctor.");
    }
    setIsProcessing(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <div className="bg-emerald-100 p-4 rounded-2xl text-emerald-600">
            <UserPlus size={32} />
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">Reception Desk</h1>
            <p className="text-slate-500 font-medium">Walk-in Registration & Queue Assignment</p>
          </div>
        </div>

        {/* Walk-In Form Container */}
        <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 bg-emerald-600 text-white flex items-center gap-2">
            <Activity size={20} />
            <h2 className="text-lg font-bold">New Walk-In Patient</h2>
          </div>

          <form onSubmit={handleWalkIn} className="p-8 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Patient Details */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Patient Name</label>
                  <div className="relative">
                    <User className="absolute left-4 top-3.5 text-slate-400" size={18} />
                    <input 
                      type="text" required placeholder="Full Name"
                      value={patientName} onChange={(e) => setPatientName(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 font-medium text-slate-800"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Mobile Number</label>
                  <div className="relative flex items-center">
                    <span className="absolute left-4 font-bold text-slate-400">+91</span>
                    <input 
                      type="tel" required maxLength="10" placeholder="10-digit number"
                      value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                      className="w-full pl-14 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 font-bold text-slate-800"
                    />
                  </div>
                </div>
              </div>

              {/* Assignment Details */}
              <div className="space-y-4">
                <div>
                  <label className="flex text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 items-center gap-1">
                    <Stethoscope size={14} className="text-emerald-500"/> Assign Department
                  </label>
                  <select 
                    required value={selectedDept} onChange={(e) => setSelectedDept(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 font-medium text-slate-800"
                  >
                    {departments.length === 0 && <option value="">No Departments setup</option>}
                    {departments.map((dept, idx) => (
                      <option key={idx} value={dept}>{dept}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Assign Doctor</label>
                  <select 
                    required value={selectedDoctor} onChange={(e) => setSelectedDoctor(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 font-medium text-slate-800"
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

            <button 
              type="submit" disabled={isProcessing}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-4 rounded-xl flex justify-center items-center gap-2 transition-all mt-4"
            >
              <UserPlus size={20} /> {isProcessing ? "Processing..." : "Register Walk-In & Generate Token"}
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}