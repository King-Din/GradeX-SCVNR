// GradeX service worker: shows phone notifications ("due soon", "scored").
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "GradeX", body: event.data?.text() };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "GradeX", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/badge-96.png", // Android draws only its transparency, in the status bar
      data: { url: data.url || "/" }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin);
  // Only ever open pages of this site.
  const url = target.origin === self.location.origin ? target.href : self.location.origin + "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      for (const client of windows) {
        if (!("focus" in client)) continue;
        // Only move an open window when the notification points somewhere
        // specific; "/" just brings GradeX to the front without a reload.
        const specific = target.pathname + target.hash !== "/";
        if (specific && "navigate" in client && client.url !== url) {
          try { await client.navigate(url); } catch { /* uncontrolled window: just focus it */ }
        }
        return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
