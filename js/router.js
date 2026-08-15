function normalizedHash(hash = window.location.hash) {
  return hash || "#/article/320";
}

export function parseRoute(hash = window.location.hash) {
  const value = normalizedHash(hash);
  const article = value.match(/^#\/article\/(\d+(?:-\d+)?)$/);
  if (article) return { kind: "article", routeNumber: article[1] };
  if (value === "#/articles") return { kind: "articles" };
  if (value === "#/bookmarks") return { kind: "bookmarks" };
  if (value === "#/settings") return { kind: "settings" };
  if (value === "#/sources") return { kind: "sources" };
  const search = value.match(/^#\/search(?:\?(.*))?$/);
  if (search) return { kind: "search", query: new URLSearchParams(search[1] ?? "").get("q") ?? "" };
  return { kind: "unknown" };
}

export function routeNumber(hash = window.location.hash) {
  const route = parseRoute(hash);
  return route.kind === "article" ? route.routeNumber : null;
}

export function goToArticle(routeNumber, { replace = false } = {}) {
  if (!/^\d+(?:-\d+)?$/.test(String(routeNumber))) return false;
  const nextHash = `#/article/${routeNumber}`;
  if (window.location.hash === nextHash) return true;
  if (replace) {
    window.history.replaceState(null, "", nextHash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = nextHash;
  }
  return true;
}

export function goToView(kind, { query = "", replace = false } = {}) {
  const nextHash = kind === "search" ? `#/search${query ? `?q=${encodeURIComponent(query)}` : ""}` : `#/${kind}`;
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
  const handler = () => callback(parseRoute());
  window.addEventListener("hashchange", handler);
  return () => window.removeEventListener("hashchange", handler);
}
