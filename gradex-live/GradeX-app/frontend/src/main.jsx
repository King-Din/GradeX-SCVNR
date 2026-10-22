import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { EditionBanner } from "./components/ui.jsx";
import { watchInstall } from "./components/AppSetup.jsx";
import "./styles.css";

// Catch the browser's one-time "install" offer before anything renders.
watchInstall();

// Needed for phone notifications and "Add to Home Screen".
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <EditionBanner />
    <App />
  </StrictMode>
);
