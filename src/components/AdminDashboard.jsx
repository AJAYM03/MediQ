import { useState, useEffect } from 'react';
import { collection, addDoc, updateDoc, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Building2, PlusCircle, CalendarDays, Clock, Users, Search, Edit2, X, Activity, User, Phone } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('config'); // 'config' or 'patients'

  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [patients, setPatients] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const [newDept, setNewDept] = useState('');
  
  const [editingDocId, setEditingDocId] = useState(null); // Tracks if we are editing vs creating

  const defaultDocState = { 
    name: '', 
    department: '', 
    roomName: '',
    availableDays: [1, 2, 3, 4, 5],
    morningOP: { enabled: true, startTime: '09:00', endTime: '13:00', capacity: 20 },
    eveningOP: { enabled: true, startTime: '17:00', endTime: '20:00', capacity: 20 }
  };

  const [newDoc, setNewDoc] = useState(defaultDocState);

  const DAYS_OF_WEEK = [
    { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, 
    { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' }, 
    { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, 
    { value: 0, label: 'Sun' }
  ];

  // 1. Data Subscriptions
  useEffect(() => {
    const unsubDepts = onSnapshot(collection(db, "departments"), (snap) => setDepartments(snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
    const unsubDocs = onSnapshot(collection(db, "doctors"), (snap) => setDoctors(snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
    const unsubPatients = onSnapshot(collection(db, "patients"), (snap) => setPatients(snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
    return () => { unsubDepts(); unsubDocs(); unsubPatients(); };
  }, []);

  // --- ACTIONS ---

  const handleAddDept = async (e) => {
    e.preventDefault();
    if (!newDept) return;
    setIsProcessing(true);
    try { 
      await addDoc(collection(db, "departments"), { name: newDept, active: true }); 
      setNewDept(''); 
      toast.success("Department added successfully!"); 
    } catch (error) { 
      console.error(error);
      toast.error("Failed to add department."); 
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleDay = (dayValue) => {
    setNewDoc(prev => {
      const days = prev.availableDays.includes(dayValue) ? prev.availableDays.filter(d => d !== dayValue) : [...prev.availableDays, dayValue];
      return { ...prev, availableDays: days };
    });
  };

  const handleEditClick = (doctor) => {
    setEditingDocId(doctor.id);
    setNewDoc({
      name: doctor.name || '',
      department: doctor.department || '',
      roomName: doctor.current_room || '',
      availableDays: doctor.available_days || [],
      morningOP: doctor.op_schedule?.morning || defaultDocState.morningOP,
      eveningOP: doctor.op_schedule?.evening || defaultDocState.eveningOP
    });
    toast.success(`Editing ${doctor.name}`, { icon: '✏️' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingDocId(null);
    setNewDoc(defaultDocState);
  };

  const handleSaveDoctor = async (e) => {
    e.preventDefault();
    
    if (!newDoc.name || !newDoc.department) return toast.error("Fill all required doctor details");
    if (newDoc.availableDays.length === 0) return toast.error("Select at least one working day");
    if (!newDoc.morningOP.enabled && !newDoc.eveningOP.enabled) return toast.error("You must enable at least one OP session");
    
    if (newDoc.morningOP.enabled && newDoc.morningOP.startTime >= newDoc.morningOP.endTime) {
      return toast.error("Morning OP End Time must be after the Start Time");
    }
    if (newDoc.eveningOP.enabled && newDoc.eveningOP.startTime >= newDoc.eveningOP.endTime) {
      return toast.error("Evening OP End Time must be after the Start Time");
    }
    
    setIsProcessing(true);
    
    try {
      const docData = {
        name: newDoc.name,
        department: newDoc.department,
        current_room: newDoc.roomName || "Please ask reception",
        active: true,
        available_days: newDoc.availableDays,
        op_schedule: {
          morning: newDoc.morningOP,
          evening: newDoc.eveningOP
        }
      };

      if (editingDocId) {
        // UPDATE EXISTING DOCTOR
        await updateDoc(doc(db, "doctors", editingDocId), docData);
        toast.success("Doctor updated successfully!");
      } else {
        // CREATE NEW DOCTOR
        const docRef = await addDoc(collection(db, "doctors"), docData);
        await setDoc(doc(db, "doctor_queues", docRef.id), {
          baseline_average: 5,
          daily_bookings: {}
        });
        toast.success("Doctor configured successfully!");
      }

      handleCancelEdit(); // Reset form
      
    } catch (error) {
      console.error("Error saving doctor:", error);
      toast.error("Failed to save doctor. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  // --- FILTERING ---
  const filteredPatients = patients.filter(p => 
    p.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.phone_number?.includes(searchTerm)
  );

  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* HEADER & TABS */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <div className="bg-slate-900 p-4 rounded-2xl text-white">
              <Building2 size={32} />
            </div>
            <div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">Enterprise Admin</h1>
              <p className="text-slate-500 font-medium">Hospital Configuration & Directory</p>
            </div>
          </div>

          <div className="flex bg-white rounded-xl shadow-sm border border-slate-200 p-1 w-full md:w-auto">
            <button onClick={() => setActiveTab('config')} className={`flex-1 md:flex-none px-4 py-2 rounded-lg font-bold text-sm flex justify-center items-center gap-2 transition-colors ${activeTab === 'config' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
              <PlusCircle size={16}/> Organizations
            </button>
            <button onClick={() => setActiveTab('patients')} className={`flex-1 md:flex-none px-4 py-2 rounded-lg font-bold text-sm flex justify-center items-center gap-2 transition-colors ${activeTab === 'patients' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
              <Users size={16}/> Patient Directory
            </button>
          </div>
        </div>

        {/* TAB 1: CONFIGURATION */}
        {activeTab === 'config' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* LEFT COLUMN: FORMS */}
            <div className="lg:col-span-7 space-y-6">
              
              {/* Department Form */}
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-4"><Building2 className="text-slate-400" size={20}/> Add Department</h2>
                <form onSubmit={handleAddDept} className="flex gap-3">
                  <input type="text" required placeholder="e.g. Pediatrics" value={newDept} onChange={(e) => setNewDept(e.target.value)} className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:ring-2 focus:ring-slate-900 outline-none" />
                  <button type="submit" disabled={isProcessing} className="bg-slate-900 text-white font-bold py-3 px-6 rounded-xl hover:bg-slate-800 transition-colors">Add</button>
                </form>
              </div>

              {/* Doctor Add/Edit Form */}
              <div className={`bg-white p-6 rounded-3xl shadow-sm border transition-colors ${editingDocId ? 'border-amber-400 ring-4 ring-amber-50' : 'border-slate-200'}`}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    {editingDocId ? <Edit2 className="text-amber-500" size={20}/> : <PlusCircle className="text-slate-400" size={20}/>} 
                    {editingDocId ? 'Edit Doctor Profile' : 'Configure New Doctor'}
                  </h2>
                  {editingDocId && (
                    <button onClick={handleCancelEdit} className="text-slate-400 hover:text-slate-700 font-bold text-sm flex items-center gap-1 bg-slate-100 px-3 py-1 rounded-lg">
                      <X size={14}/> Cancel Edit
                    </button>
                  )}
                </div>

                <form onSubmit={handleSaveDoctor} className="space-y-4">
                  <input type="text" required placeholder="Doctor's Full Name" value={newDoc.name} onChange={(e) => setNewDoc({...newDoc, name: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:ring-2 focus:ring-slate-900 outline-none" />
                  
                  <div className="grid grid-cols-2 gap-3">
                    <select required value={newDoc.department} onChange={(e) => setNewDoc({...newDoc, department: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 outline-none focus:ring-2 focus:ring-slate-900">
                      <option value="">Select Dept...</option>
                      {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                    </select>
                    <input type="text" placeholder="Room (Optional)" value={newDoc.roomName} onChange={(e) => setNewDoc({...newDoc, roomName: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:ring-2 focus:ring-slate-900 outline-none" />
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
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="text-xs font-semibold text-blue-700 mb-1 flex items-center gap-1"><Clock size={12}/> Start</label>
                            <input type="time" required value={newDoc.morningOP.startTime} onChange={(e) => setNewDoc({...newDoc, morningOP: {...newDoc.morningOP, startTime: e.target.value}})} className="w-full px-3 py-2 bg-white border border-blue-200 rounded-lg text-sm font-bold outline-none"/>
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-blue-700 mb-1 flex items-center gap-1"><Clock size={12}/> End</label>
                            <input type="time" required value={newDoc.morningOP.endTime} onChange={(e) => setNewDoc({...newDoc, morningOP: {...newDoc.morningOP, endTime: e.target.value}})} className="w-full px-3 py-2 bg-white border border-blue-200 rounded-lg text-sm font-bold outline-none"/>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-blue-700 mb-1">Capacity</label>
                            <input type="number" required min="1" value={newDoc.morningOP.capacity} onChange={(e) => setNewDoc({...newDoc, morningOP: {...newDoc.morningOP, capacity: Number(e.target.value)}})} className="w-full px-3 py-2 bg-white border border-blue-200 rounded-lg text-sm font-bold outline-none"/>
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
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="text-xs font-semibold text-orange-700 mb-1 flex items-center gap-1"><Clock size={12}/> Start</label>
                            <input type="time" required value={newDoc.eveningOP.startTime} onChange={(e) => setNewDoc({...newDoc, eveningOP: {...newDoc.eveningOP, startTime: e.target.value}})} className="w-full px-3 py-2 bg-white border border-orange-200 rounded-lg text-sm font-bold outline-none"/>
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-orange-700 mb-1 flex items-center gap-1"><Clock size={12}/> End</label>
                            <input type="time" required value={newDoc.eveningOP.endTime} onChange={(e) => setNewDoc({...newDoc, eveningOP: {...newDoc.eveningOP, endTime: e.target.value}})} className="w-full px-3 py-2 bg-white border border-orange-200 rounded-lg text-sm font-bold outline-none"/>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-orange-700 mb-1">Capacity</label>
                            <input type="number" required min="1" value={newDoc.eveningOP.capacity} onChange={(e) => setNewDoc({...newDoc, eveningOP: {...newDoc.eveningOP, capacity: Number(e.target.value)}})} className="w-full px-3 py-2 bg-white border border-orange-200 rounded-lg text-sm font-bold outline-none"/>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <button type="submit" disabled={isProcessing} className={`w-full text-white font-bold py-4 rounded-xl transition-colors ${editingDocId ? 'bg-amber-500 hover:bg-amber-600' : 'bg-slate-900 hover:bg-slate-800'}`}>
                    {editingDocId ? 'Update Doctor Profile' : 'Save New Doctor'}
                  </button>
                </form>
              </div>

            </div>

            {/* RIGHT COLUMN: DOCTOR LIST */}
            <div className="lg:col-span-5">
               <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden h-full flex flex-col">
                  <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Activity className="text-emerald-500" size={20}/> Active Doctors</h2>
                    <span className="bg-slate-200 text-slate-700 text-xs font-black px-2 py-1 rounded-lg">{doctors.length}</span>
                  </div>
                  <div className="p-2 overflow-y-auto flex-1 divide-y divide-slate-100 max-h-[800px]">
                     {doctors.length === 0 && <div className="p-8 text-center text-slate-400 font-bold">No doctors configured yet.</div>}
                     {doctors.map(doc => (
                       <div key={doc.id} className="p-4 flex items-center justify-between hover:bg-slate-50 rounded-xl transition-colors group">
                          <div>
                             <h3 className="font-bold text-slate-900 text-sm">{doc.name}</h3>
                             <p className="text-xs font-medium text-slate-500 mt-0.5">{doc.department} • {doc.current_room}</p>
                          </div>
                          <button onClick={() => handleEditClick(doc)} className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors">
                             <Edit2 size={16}/>
                          </button>
                       </div>
                     ))}
                  </div>
               </div>
            </div>

          </div>
        )}

        {/* TAB 2: PATIENT DIRECTORY */}
        {activeTab === 'patients' && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Users className="text-indigo-500" size={24}/> Patient Database</h2>
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
                <input 
                  type="text" 
                  placeholder="Search name or phone..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl font-medium text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-xs uppercase tracking-wider text-slate-500 font-bold">
                    <th className="p-4 pl-6">Patient Info</th>
                    <th className="p-4">Contact</th>
                    <th className="p-4">Demographics</th>
                    <th className="p-4 text-right pr-6">History</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPatients.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="p-10 text-center text-slate-400 font-bold">
                        {searchTerm ? 'No patients match your search.' : 'No patients registered yet.'}
                      </td>
                    </tr>
                  ) : (
                    filteredPatients.map(patient => (
                      <tr key={patient.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="p-4 pl-6">
                          <div className="flex items-center gap-3">
                            <div className="bg-indigo-100 text-indigo-600 p-2 rounded-full hidden sm:block">
                              <User size={16}/>
                            </div>
                            <div>
                              <p className="font-bold text-slate-900 text-sm">{patient.full_name}</p>
                              <p className="text-xs font-medium text-slate-400">UID: {patient.id.slice(0,8)}...</p>
                            </div>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-1.5 text-sm font-medium text-slate-600">
                            <Phone size={14} className="text-slate-400"/> {patient.phone_number || "Walk-In"}
                          </div>
                        </td>
                        <td className="p-4 text-sm font-medium text-slate-600">
                           {patient.age ? `${patient.age} yrs` : '-'} • {patient.gender || '-'}
                        </td>
                        <td className="p-4 pr-6 text-right">
                           <div className="flex flex-col items-end gap-1">
                             {patient.active_bookings?.length > 0 ? (
                                <span className="bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase px-2 py-0.5 rounded tracking-wide">
                                  {patient.active_bookings.length} Active Booking{patient.active_bookings.length > 1 ? 's' : ''}
                                </span>
                             ) : (
                                <span className="text-xs font-bold text-slate-400">No active bookings</span>
                             )}
                             {patient.last_updated && (
                                <span className="text-xs font-medium text-slate-400">
                                  Last: {patient.last_updated?.toDate().toLocaleDateString()}
                                </span>
                             )}
                           </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}