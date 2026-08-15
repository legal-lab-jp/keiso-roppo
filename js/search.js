export function normalizeSearch(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function numberQuery(value) {
  const normalized = normalizeSearch(value).replace(/[\s　]/g, "");
  const match = normalized.match(/^第?(320|321|322)条?$/);
  return match?.[1] ?? null;
}

export function searchArticles(catalog, query) {
  const normalized = normalizeSearch(query);
  if (!normalized) return [];
  const exactNumber = numberQuery(normalized);
  const terms = normalized.split(" ").filter(Boolean);

  return catalog.articles
    .map((article) => {
      const title = normalizeSearch(article.title);
      const keywords = normalizeSearch(article.keywords);
      const body = normalizeSearch(article.searchText);
      let score = 0;
      let matchedBy = "";
      if (exactNumber === article.number) {
        score = 100;
        matchedBy = "条文番号";
      } else if (normalized === title) {
        score = 90;
        matchedBy = "条文タイトル";
      } else if (article.number.startsWith(normalized) || title.startsWith(normalized)) {
        score = 80;
        matchedBy = "番号・タイトル";
      } else if (terms.length > 0 && terms.every((term) => keywords.includes(term))) {
        score = 60;
        matchedBy = "キーワード";
      } else if (terms.length > 0 && terms.every((term) => body.includes(term))) {
        score = 40;
        matchedBy = "本文・解説";
      }
      return score ? { ...article, score, matchedBy } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || Number(left.number) - Number(right.number))
    .slice(0, 20);
}
