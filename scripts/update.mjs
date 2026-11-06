// Holt Serverstatus und News von Star Trek Online und schreibt sie nach data/*.json.
// Läuft per GitHub Action alle ~5 Minuten. Benötigt Node 18+ (eingebautes fetch).
import { readFile, writeFile, mkdir } from "node:fs/promises";

const STATUS_URL = "http://launcher.startrekonline.com/launcher_server_status";
const NEWS_URL =
  "https://api.arcgames.com/v1.0/games/sto/news?limit=40&field[]=images.img_microsite_thumbnail";
const HISTORY_MAX = 288; // 24 Stunden bei 5-Minuten-Takt

const now = new Date().toISOString();

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function fetchWithTimeout(url, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "sto-status-pwa (GitHub Action)" },
    });
  } finally {
    clearTimeout(t);
  }
}

// Wandelt die Antwort des Launchers in online / maintenance / offline um.
function interpret(text) {
  let value = text.trim();
  let message = "";
  try {
    const json = JSON.parse(text);
    const key = Object.keys(json).find((k) => /status/i.test(k));
    value = String(key ? json[key] : JSON.stringify(json));
    message = String(json.message || json.msg || json.reason || "");
  } catch {
    /* kein JSON, Text direkt auswerten */
  }
  const v = value.toLowerCase();
  if (/(^|\W)(up|online|open|ok)(\W|$)/.test(v)) return { state: "online", value, message };
  if (/maint|wartung/.test(v)) return { state: "maintenance", value, message };
  if (/(^|\W)(down|offline|closed)(\W|$)/.test(v)) return { state: "maintenance", value, message };
  return { state: "unknown", value, message };
}

async function updateStatus() {
  const prev = await readJson("data/status.json", { history: [] });
  let result;
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(STATUS_URL);
    const text = await res.text();
    result = res.ok
      ? interpret(text)
      : { state: "offline", value: `HTTP ${res.status}`, message: "" };
    result.raw = text.slice(0, 300);
  } catch (err) {
    result = { state: "offline", value: "nicht erreichbar", message: String(err.message || err), raw: "" };
  }
  result.latencyMs = Date.now() - started;

  const changed = prev.state !== result.state;
  const history = [...(prev.history || []), { t: now, s: result.state }].slice(-HISTORY_MAX);
  const out = {
    ...result,
    checkedAt: now,
    since: changed || !prev.since ? now : prev.since,
    history,
  };
  await writeFile("data/status.json", JSON.stringify(out, null, 1));
  console.log("Status:", out.state, out.value);
}

function kindOf(tags) {
  if (tags.includes("sto-patch-notes") || tags.includes("patch-notes")) return "Patch-Notes";
  if (tags.includes("sto-dev-blog") || tags.includes("dev-blog")) return "Dev-Blog";
  if (tags.some((t) => /xbox|playstation/.test(t)) && !tags.includes("sto-launcher")) return "Konsole";
  return "News";
}

async function updateNews() {
  const prev = await readJson("data/news.json", { items: [] });
  const firstSeen = Object.fromEntries((prev.items || []).map((i) => [i.id, i.firstSeen]));
  const isFirstRun = !prev.items || prev.items.length === 0;

  const res = await fetchWithTimeout(NEWS_URL);
  if (!res.ok) throw new Error(`News HTTP ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : data.data || data.items || [];

  const items = list.map((n) => {
    const tags = n.tags || [];
    const de = (n.translations || []).find((t) => t.language === "de");
    const id = String(n.id);
    return {
      id,
      title: n.title,
      summary: n.summary || "",
      image: n.images?.img_microsite_thumbnail?.url || "",
      kind: kindOf(tags),
      url: `https://www.playstartrekonline.com/en/news/article/${id}`,
      urlDe: de ? `https://www.playstartrekonline.com/de/news/article/${de.id}` : "",
      // Die API liefert kein Datum: wir merken uns, wann wir den Artikel zuerst gesehen haben.
      firstSeen: id in firstSeen ? firstSeen[id] : isFirstRun ? null : now,
    };
  });

  await writeFile("data/news.json", JSON.stringify({ updatedAt: now, items }, null, 1));
  console.log("News:", items.length);
}

await mkdir("data", { recursive: true });
const results = await Promise.allSettled([updateStatus(), updateNews()]);
results.forEach((r) => r.status === "rejected" && console.error(r.reason));
