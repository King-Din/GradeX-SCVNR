// The improved version only loads googleapis in Google Sheets mode, which
// the demo never uses. This keeps the 80 MB library out of the bundle.
export const google = new Proxy({}, { get() { throw new Error("Google APIs are not available in the demo"); } });
