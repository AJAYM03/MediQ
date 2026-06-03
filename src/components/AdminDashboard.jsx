import { useState, useEffect } from 'react';
import { collection, addDoc, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Building2, Stethoscope, Users, Activity, PlusCircle } from 'lucide-react';

export default function AdminDashboard() {
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [queueCount, setQueueCount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  // Forms State
  const [newDept, setNewDept] = useState('');
  const [newDoc, setNewDoc] = useState({ name: '', department: '', roomName: '' });

  // Fetch Live Data
  useEffect(() => {
    const unsubDepts = onSnapshot(collection(db, "departments"), (snap) => {
      setDepartments(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    const unsubDocs = onSnapshot(collection(db, "doctors"), (snap) => {
      setDoctors(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    const unsubQueue = onSnapshot(collection(db, "today_queue"), (snap) => {
      setQueueCount(snap.docs.length);
    });

    return () => { unsubDepts(); unsubDocs(); unsubQueue(); };
  }, []);

  // Add Department
  const handleAddDept = async (e) => {
    e.preventDefault();
    if (!newDept) return;
    setIsProcessing(true);
    try {
      await addDoc(collection(db, "departments"), { name: newDept, active: true });
      setNewDept('');
      alert("Department added!");
    } catch (error) {
      console.error(error);
    }
    setIsProcessing(false);
  };

  // Add Doctor & Initialize their Queue Engine
  const handleAddDoctor = async (e) => {
    e.preventDefault();
    if (!newDoc.name || !newDoc.department) return alert("Fill all required doctor details");
    setIsProcessing(true);
    
    try {
      // 1. Create the Doctor Profile with the Room (The "Digital Concierge" feature)
      const docRef = await addDoc(collection(db, "doctors"), {
        name: newDoc.name,
        department: newDoc.department,
        current_room: newDoc.roomName || "Please ask reception", // Productively Lazy fallback
        active: true
      });

      // 2. Initialize their personal Queue Engine immediately
      // We use docRef.id so the queue ID exactly matches the Doctor ID
      await setDoc(doc(db, "doctor_queues", docRef.id), {
        last_issued_token: 0,
        current_serving_token: 0,
        baseline_average: 5,
        rolling_average: 5,
        recent_durations: [],
        session_active: false,
        is_paused: false
      });

      setNewDoc({ name: '', department: departments[0]?.name || '', roomName: '' });
      alert("Doctor onboarded and Queue Engine initialized!");
    } catch (error) {
      console.error("Error adding doctor:", error);
    }
    setIsProcessing(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header & Analytics */}
        <div className="flex justify-between items-end mb-8">
          <div>
            <h1 className="text-3xl font-black text-slate-900">Hospital Administration</h1>
            <p className="text-slate-500 font-medium">System Configuration & Analytics</p>
          </div>
        </div>

        {/* Top Analytics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-4">
            <div className="bg-blue-100 p-4 rounded-xl text-blue-600"><Users size={24} /></div>
            <div>
              <p className="text-sm font-bold text-slate-400 uppercase">Today's Total Patients</p>
              <p className="text-3xl font-black text-slate-800">{queueCount}</p>
            </div>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-4">
            <div className="bg-indigo-100 p-4 rounded-xl text-indigo-600"><Stethoscope size={24} /></div>
            <div>
              <p className="text-sm font-bold text-slate-400 uppercase">Active Doctors</p>
              <p className="text-3xl font-black text-slate-800">{doctors.length}</p>
            </div>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-4">
            <div className="bg-emerald-100 p-4 rounded-xl text-emerald-600"><Activity size={24} /></div>
            <div>
              <p className="text-sm font-bold text-slate-400 uppercase">System Status</p>
              <p className="text-xl font-black text-emerald-600">All Systems Nominal</p>
            </div>
          </div>
        </div>

        {/* Configuration Forms */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Add Department */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-4"><Building2 size={20}/> Add Department</h2>
            <form onSubmit={handleAddDept} className="flex gap-3">
              <input 
                type="text" required placeholder="e.g. Pediatrics"
                value={newDept} onChange={(e) => setNewDept(e.target.value)}
                className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 font-medium"
              />
              <button type="submit" disabled={isProcessing} className="bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 px-6 rounded-xl transition-colors">
                Add
              </button>
            </form>
            <div className="mt-4 flex flex-wrap gap-2">
              {departments.map(d => <span key={d.id} className="bg-slate-100 text-slate-600 px-3 py-1 rounded-lg text-sm font-bold">{d.name}</span>)}
            </div>
          </div>

          {/* Add Doctor */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-4"><PlusCircle size={20}/> Onboard Doctor</h2>
            <form onSubmit={handleAddDoctor} className="space-y-4">
              <input 
                type="text" required placeholder="Doctor's Full Name"
                value={newDoc.name} onChange={(e) => setNewDoc({...newDoc, name: e.target.value})}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium"
              />
              <div className="grid grid-cols-2 gap-3">
                <select 
                  required value={newDoc.department} onChange={(e) => setNewDoc({...newDoc, department: e.target.value})}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700"
                >
                  <option value="">Select Dept...</option>
                  {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                </select>
                <input 
                  type="text" placeholder="Current Room (Optional)"
                  value={newDoc.roomName} onChange={(e) => setNewDoc({...newDoc, roomName: e.target.value})}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                />
              </div>
              <button type="submit" disabled={isProcessing} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors">
                Create Doctor Profile
              </button>
            </form>
          </div>

        </div>
      </div>
    </div>
  );
}