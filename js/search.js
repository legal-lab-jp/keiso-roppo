export function normalizeSearch(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function routeQuery(value) {
  const compact = normalizeSearch(value).replace(/[\s　]/g, "").replace(/^第/, "").replace(/条$/, "").replaceAll("の", "-");
  return /^\d+(?:-\d+)?$/.test(compact) ? compact : null;
}

function studyText(study) {
  if (!study) return "";
  return [
    study.title, study.topic, study.loadLabel, study.keywords, study.oneLine, study.trigger, study.overview,
    study.learning?.remember, study.learning?.understand, study.learning?.lookup,
    ...(study.provisions ?? []).flatMap((provision) => [
      provision.label, provision.studyTitle, provision.purpose,
      ...(provision.segments ?? []).flatMap((segment) => [segment.tag, segment.text])
    ])
  ].filter(Boolean).join(" ");
}

export function searchArticles(catalog, articles, query) {
  const normalized = normalizeSearch(query);
  if (!normalized) return [];
  const exactRoute = routeQuery(normalized);
  const terms = normalized.split(" ").filter(Boolean);

  return catalog.articles
    .map((meta) => {
      const current = articles.get(meta.routeNumber);
      const article = current?.statute?.article;
      const study = current?.study?.study;
      const title = normalizeSearch(`${meta.officialCaption ?? ""} ${meta.studyTitle}`);
      const keywords = normalizeSearch(study?.keywords ?? "");
      const text = normalizeSearch(`${article?.plainText ?? ""} ${studyText(study)}`);
      let score = 0;
      let matchedBy = "";
      if (exactRoute === meta.routeNumber) {
        score = 100;
        matchedBy = "条文番号";
      } else if (normalized === title) {
        score = 90;
        matchedBy = "条文タイトル";
      } else if (meta.routeNumber.startsWith(normalized) || title.startsWith(normalized)) {
        score = 80;
        matchedBy = "番号・タイトル";
      } else if (terms.length && terms.every((term) => keywords.includes(term))) {
        score = 60;
        matchedBy = "キーワード";
      } else if (terms.length && terms.every((term) => text.includes(term))) {
        score = 40;
        matchedBy = "本文・解説";
      }
      return score ? { ...meta, score, matchedBy } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, 30);
}
