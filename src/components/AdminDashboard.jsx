import { useState, useEffect } from 'react';
import { collection, addDoc, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Building2, Stethoscope, Users, Activity, PlusCircle, CalendarDays, Clock } from 'lucide-react';

export default function AdminDashboard() {
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [queueCount, setQueueCount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const [newDept, setNewDept] = useState('');
  
  // The Upgraded Enterprise Schedule State
  const [newDoc, setNewDoc] = useState({ 
    name: '', 
    department: '', 
    roomName: '',
    availableDays: [1, 2, 3, 4, 5],
    morningOP: { enabled: true, startTime: '09:00', capacity: 20 },
    eveningOP: { enabled: true, startTime: '17:00', capacity: 20 }
  });

  const DAYS_OF_WEEK = [
    { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, 
    { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' }, 
    { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, 
    { value: 0, label: 'Sun' }
  ];

  useEffect(() => {
    const unsubDepts = onSnapshot(collection(db, "departments"), (snap) => setDepartments(snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
    const unsubDocs = onSnapshot(collection(db, "doctors"), (snap) => setDoctors(snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
    const unsubQueue = onSnapshot(collection(db, "today_queue"), (snap) => setQueueCount(snap.docs.length));
    return () => { unsubDepts(); unsubDocs(); unsubQueue(); };
  }, []);

  const handleAddDept = async (e) => {
    e.preventDefault();
    if (!newDept) return;
    setIsProcessing(true);
    try { await addDoc(collection(db, "departments"), { name: newDept, active: true }); setNewDept(''); } catch (error) { console.error(error); }
    setIsProcessing(false);
  };

  const toggleDay = (dayValue) => {
    setNewDoc(prev => {
      const days = prev.availableDays.includes(dayValue) ? prev.availableDays.filter(d => d !== dayValue) : [...prev.availableDays, dayValue];
      return { ...prev, availableDays: days };
    });
  };

  const handleAddDoctor = async (e) => {
    e.preventDefault();
    if (!newDoc.name || !newDoc.department) return alert("Fill all required doctor details");
    if (newDoc.availableDays.length === 0) return alert("Select at least one working day");
    if (!newDoc.morningOP.enabled && !newDoc.eveningOP.enabled) return alert("You must enable at least one OP session (Morning or Evening)");
    
    setIsProcessing(true);
    
    try {
      // 1. Create the Doctor Profile with Exact OP Timings
      const docRef = await addDoc(collection(db, "doctors"), {
        name: newDoc.name,
        department: newDoc.department,
        current_room: newDoc.roomName || "Please ask reception",
        active: true,
        available_days: newDoc.availableDays,
        // Save the dynamic OP configurations
        op_schedule: {
          morning: newDoc.morningOP,
          evening: newDoc.eveningOP
        }
      });

      // 2. Initialize Queue Engine
      await setDoc(doc(db, "doctor_queues", docRef.id), {
        daily_bookings: {}
      });

      setNewDoc({ 
        name: '', department: departments[0]?.name || '', roomName: '', 
        availableDays: [1, 2, 3, 4, 5], 
        morningOP: { enabled: true, startTime: '09:00', capacity: 20 }, 
        eveningOP: { enabled: true, startTime: '17:00', capacity: 20 } 
      });
      alert("Doctor configured with specific OP times!");
    } catch (error) {
      console.error("Error adding doctor:", error);
    }
    setIsProcessing(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        
        <div className="flex justify-between items-end mb-8">
          <div>
            <h1 className="text-3xl font-black text-slate-900">Hospital Administration</h1>
            <p className="text-slate-500 font-medium">Enterprise Configuration</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 h-fit">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-4"><Building2 size={20}/> Add Department</h2>
            <form onSubmit={handleAddDept} className="flex gap-3">
              <input type="text" required placeholder="e.g. Pediatrics" value={newDept} onChange={(e) => setNewDept(e.target.value)} className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium" />
              <button type="submit" disabled={isProcessing} className="bg-slate-900 text-white font-bold py-3 px-6 rounded-xl">Add</button>
            </form>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-4"><PlusCircle size={20}/> Configure Doctor OP</h2>
            <form onSubmit={handleAddDoctor} className="space-y-4">
              <input type="text" required placeholder="Doctor's Full Name" value={newDoc.name} onChange={(e) => setNewDoc({...newDoc, name: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium" />
              
              <div className="grid grid-cols-2 gap-3">
                <select required value={newDoc.department} onChange={(e) => setNewDoc({...newDoc, department: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700">
                  <option value="">Select Dept...</option>
                  {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                </select>
                <input type="text" placeholder="Room (Optional)" value={newDoc.roomName} onChange={(e) => setNewDoc({...newDoc, roomName: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium" />
              </div>

              {/* Working Days */}
              <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl">
                <div className="flex items-center gap-2 text-indigo-700 font-bold text-sm mb-3"><CalendarDays size={16} /> Working Days</div>
                <div className="flex flex-wrap gap-2">
                  {DAYS_OF_WEEK.map(day => (
                    <button key={day.value} type="button" onClick={() => toggleDay(day.value)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${newDoc.availableDays.includes(day.value) ? 'bg-indigo-600 text-white' : 'bg-white border border-indigo-200 text-indigo-400'}`}>
                      {day.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dynamic OP Timings Engine */}
              <div className="space-y-3">
                {/* Morning Config */}
                <div className={`p-4 border rounded-xl transition-colors ${newDoc.morningOP.enabled ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <label className="flex items-center gap-2 font-bold text-sm text-blue-900 cursor-pointer">
                      <input type="checkbox" checked={newDoc.morningOP.enabled} onChange={(e) => setNewDoc({...newDoc, morningOP: {...newDoc.morningOP, enabled: e.target.checked}})} className="w-4 h-4 rounded text-blue-600"/>
                      Morning OP Session
                    </label>
                  </div>
                  {newDoc.morningOP.enabled && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-semibold text-blue-700 mb-1 flex items-center gap-1"><Clock size={12}/> Start Time</label>
                        <input type="time" required value={newDoc.morningOP.startTime} onChange={(e) => setNewDoc({...newDoc, morningOP: {...newDoc.morningOP, startTime: e.target.value}})} className="w-full px-3 py-2 bg-white border border-blue-200 rounded-lg text-sm font-bold"/>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-blue-700 mb-1">Max Capacity</label>
                        <input type="number" required min="1" value={newDoc.morningOP.capacity} onChange={(e) => setNewDoc({...newDoc, morningOP: {...newDoc.morningOP, capacity: Number(e.target.value)}})} className="w-full px-3 py-2 bg-white border border-blue-200 rounded-lg text-sm font-bold"/>
                      </div>
                    </div>
                  )}
                </div>

                {/* Evening Config */}
                <div className={`p-4 border rounded-xl transition-colors ${newDoc.eveningOP.enabled ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <label className="flex items-center gap-2 font-bold text-sm text-orange-900 cursor-pointer">
                      <input type="checkbox" checked={newDoc.eveningOP.enabled} onChange={(e) => setNewDoc({...newDoc, eveningOP: {...newDoc.eveningOP, enabled: e.target.checked}})} className="w-4 h-4 rounded text-orange-600"/>
                      Evening OP Session
                    </label>
                  </div>
                  {newDoc.eveningOP.enabled && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-semibold text-orange-700 mb-1 flex items-center gap-1"><Clock size={12}/> Start Time</label>
                        <input type="time" required value={newDoc.eveningOP.startTime} onChange={(e) => setNewDoc({...newDoc, eveningOP: {...newDoc.eveningOP, startTime: e.target.value}})} className="w-full px-3 py-2 bg-white border border-orange-200 rounded-lg text-sm font-bold"/>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-orange-700 mb-1">Max Capacity</label>
                        <input type="number" required min="1" value={newDoc.eveningOP.capacity} onChange={(e) => setNewDoc({...newDoc, eveningOP: {...newDoc.eveningOP, capacity: Number(e.target.value)}})} className="w-full px-3 py-2 bg-white border border-orange-200 rounded-lg text-sm font-bold"/>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <button type="submit" disabled={isProcessing} className="w-full bg-slate-900 hover:bg-black text-white font-bold py-4 rounded-xl transition-colors">
                Save Doctor & OP Schedule
              </button>
            </form>
          </div>

        </div>
      </div>
    </div>
  );
}
