// The club is in India: dates people read (messages, file names) use IST,
// whatever time zone the server runs in.
const ZONE = "Asia/Kolkata";

// "31 Oct, 17:00"
export function istWhen(value) {
  const date = new Date(value);
  const day = date.toLocaleDateString("en-GB", { timeZone: ZONE, day: "numeric", month: "short" });
  const time = date.toLocaleTimeString("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day}, ${time}`;
}

// "2026-10-22"
export function istDate(value = Date.now()) {
  return new Date(value).toLocaleDateString("en-CA", { timeZone: ZONE });
}
