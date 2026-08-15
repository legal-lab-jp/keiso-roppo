const validNumbers = new Set(["320", "321", "322"]);

export function routeNumber(hash = window.location.hash) {
  const match = hash.match(/^#\/article\/(320|321|322)$/);
  return match ? match[1] : null;
}

export function isKnownRoute(hash = window.location.hash) {
  return Boolean(routeNumber(hash));
}

export function goToArticle(number, { replace = false } = {}) {
  if (!validNumbers.has(String(number))) return false;
  const nextHash = `#/article/${number}`;
  if (window.location.hash === nextHash) return true;
  if (replace) {
    window.history.replaceState(null, "", nextHash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = nextHash;
  }
  return true;
}

export function onRouteChange(callback) {
  const handler = () => callback(routeNumber());
  window.addEventListener("hashchange", handler);
  return () => window.removeEventListener("hashchange", handler);
}
