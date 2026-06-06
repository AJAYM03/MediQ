export const getSessionKey = (date, block) => `${date}_${block}`;

export const createSessionState = (existing = {}, capacity = 20) => ({
  last_token: existing.last_token || 0,
  current_serving_token: existing.current_serving_token || 0,
  baseline_average: existing.baseline_average || 5,
  rolling_average: existing.rolling_average || existing.baseline_average || 5,
  recent_durations: existing.recent_durations || [],
  session_active: existing.session_active || false,
  is_paused: existing.is_paused || false,
  capacity: existing.capacity || capacity,
  last_consultation_start_time: existing.last_consultation_start_time || null
});

export const getSessionConfig = (doctor, block) => (
  block === 'Morning' ? doctor?.op_schedule?.morning : doctor?.op_schedule?.evening
);
