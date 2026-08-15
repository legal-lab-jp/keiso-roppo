export async function registerPwa({ onState, onUpdate }) {
  if (!("serviceWorker" in navigator)) {
    onState({ supported: false, ready: false });
    return { applyUpdate: () => {} };
  }

  let registration;
  try {
    const wasControlled = Boolean(navigator.serviceWorker.controller);
    registration = await navigator.serviceWorker.register("./sw.js");
    const report = async () => {
      const controlled = Boolean(navigator.serviceWorker.controller);
      const ready = controlled && Boolean(await caches.match("./data/catalog.json", { ignoreSearch: true }));
      onState({ supported: true, ready });
    };
    await report();
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());
    if (wasControlled && registration.waiting) onUpdate();
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && wasControlled) onUpdate();
      });
    });
    if (navigator.onLine) registration.update().catch(() => {});
    return {
      applyUpdate() {
        if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }
    };
  } catch {
    onState({ supported: true, ready: false });
    return { applyUpdate: () => {} };
  }
}
