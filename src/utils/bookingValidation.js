export async function validateBookingRequest(db, doctorId, docProfile, dateString, sessionBlock) {
  const now = new Date(); 
  
  const [year, month, day] = dateString.split('-').map(Number);
  const selectedDate = new Date(year, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // 1. Past Date Check
  if (selectedDate < today) {
    return { valid: false, error: "Booking blocked: Please select a future or current date." };
  }

  // 2. Doctor Availability Check
  const selectedDayOfWeek = selectedDate.getDay();
  if (!docProfile.available_days?.includes(selectedDayOfWeek)) {
    return { valid: false, error: `No slots available: Doctor does not consult on this day of the week.` };
  }

  // 3. Session Cutoff Check (Same-Day Bookings)
  const scheduleConfig = sessionBlock === 'Morning' ? docProfile.op_schedule.morning : docProfile.op_schedule.evening;
  if (!scheduleConfig?.enabled) {
    return { valid: false, error: `${sessionBlock} session is not available for this doctor.` };
  }

  if (selectedDate.getTime() === today.getTime()) {
    const [endHour, endMin] = scheduleConfig.endTime.split(':').map(Number);
    const sessionEndTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), endHour, endMin);
    
    // Stop taking new tokens 15 minutes before the session ends
    const cutoffTime = new Date(sessionEndTime.getTime() - (15 * 60000));
    if (now > cutoffTime) {
      return { valid: false, error: `${sessionBlock} session has ended or is past the registration cutoff.` };
    }
  }

  return { valid: true, error: null };
}