export function getISTDateString() {
  // Forces the output to be YYYY-MM-DD strictly in Indian Standard Time
  const formatter = new Intl.DateTimeFormat('en-CA', { 
    timeZone: 'Asia/Kolkata', 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit' 
  });
  return formatter.format(new Date());
}