// Holt Serverstatus und News von Star Trek Online und schreibt sie nach data/*.json.
// Läuft per GitHub Action alle ~5 Minuten. Benötigt Node 18+ (eingebautes fetch).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import net from "node:net";

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

// Dienste von Star Trek Online. Geprüft wird, ob der jeweilige Server Verbindungen annimmt.
const SERVICES = [
  { id: "account", name: "Account-Server", host: "accounts.crypticstudios.com", port: 7004, core: true },
  { id: "game", name: "Spielserver (Controller)", host: "controllertracker.crypticstudios.com", port: 7399, core: true },
  { id: "launcher", name: "Launcher", url: "http://launcher.startrekonline.com/" },
  { id: "web", name: "Offizielle Website", url: "https://www.playstartrekonline.com/" },
  { id: "error", name: "Fehlerdienst", host: "errortracker.crypticstudios.com", port: 7224 },
];

function tcpCheck(host, port, ms = 6000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const s = net.connect({ host, port });
    const done = (ok) => { s.destroy(); resolve({ ok, ms: Date.now() - started }); };
    s.setTimeout(ms, () => done(false));
    s.on("connect", () => done(true));
    s.on("error", () => done(false));
  });
}

async function httpCheck(url) {
  const started = Date.now();
  try {
    // Jede Antwort unter 500 zählt als erreichbar (der Launcher antwortet z. B. mit 403)
    const res = await fetchWithTimeout(url, 10000);
    return { ok: res.status < 500, ms: Date.now() - started };
  } catch {
    return { ok: false, ms: Date.now() - started };
  }
}

async function checkService(svc) {
  // Zweiter Versuch, damit ein einzelner Aussetzer nicht gleich als Ausfall zählt
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = svc.url ? await httpCheck(svc.url) : await tcpCheck(svc.host, svc.port);
    if (r.ok || attempt === 1) return { id: svc.id, name: svc.name, core: !!svc.core, ...r };
  }
}

async function updateStatus() {
  const prev = await readJson("data/status.json", { history: [] });
  const services = await Promise.all(SERVICES.map(checkService));
  const core = services.filter((s) => s.core);
  const coreUp = core.filter((s) => s.ok).length;
  const allUp = services.every((s) => s.ok);

  let state;
  if (coreUp === 0) state = "offline";
  else if (coreUp < core.length || !allUp) state = "degraded";
  else state = "online";

  const changed = prev.state !== state;
  const history = [...(prev.history || []), { t: now, s: state }].slice(-HISTORY_MAX);
  const out = {
    state,
    message: "",
    services,
    latencyMs: Math.round(core.reduce((a, s) => a + s.ms, 0) / core.length),
    checkedAt: now,
    since: changed || !prev.since ? now : prev.since,
    history,
  };
  await writeFile("data/status.json", JSON.stringify(out, null, 1));
  console.log("Status:", state, services.map((s) => `${s.id}=${s.ok}`).join(" "));
}

// Plattformen aus den Schlagwörtern: PC (Launcher) und/oder Konsole
function platformsOf(tags) {
  const konsole = tags.some((t) => /xbox|playstation/.test(t));
  const pc = tags.includes("sto-launcher") || tags.includes("sto-patch-notes") ? true : !konsole;
  return [...(pc ? ["PC"] : []), ...(konsole ? ["Konsole"] : [])];
}

function decode(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
}

function meta(html, names) {
  for (const n of names) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']*)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${n}["']`, "i");
    const m = html.match(re1) || html.match(re2);
    if (m && m[1].trim()) return decode(m[1]);
  }
  return "";
}

// Deutschen Titel und Kurztext von der deutschen Artikelseite holen
async function fetchGerman(url) {
  try {
    const res = await fetchWithTimeout(url, 12000);
    if (!res.ok) return null;
    const html = await res.text();
    let title = meta(html, ["og:title", "twitter:title"]);
    if (!title) title = decode((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "");
    title = title.replace(/\s*[|–-]\s*Star Trek Online.*$/i, "").trim();
    const summary = meta(html, ["og:description", "description", "twitter:description"]);
    if (!title || /^star trek online$/i.test(title)) return null;
    return { title, summary };
  } catch {
    return null;
  }
}

async function updateNews() {
  const prev = await readJson("data/news.json", { items: [] });
  const firstSeen = Object.fromEntries((prev.items || []).map((i) => [i.id, i.firstSeen]));
  const german = Object.fromEntries((prev.items || []).filter((i) => i.de).map((i) => [i.id, i.de]));
  const isFirstRun = !prev.items || prev.items.length === 0;

  const res = await fetchWithTimeout(NEWS_URL);
  if (!res.ok) throw new Error(`News HTTP ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : data.news || data.data || data.items || [];

  const items = list.map((n) => {
    const tags = n.tags || [];
    const deEntry = (n.translations || []).find((t) => t.language === "de");
    const id = String(n.id);
    return {
      id,
      title: n.title,
      summary: n.summary || "",
      image: n.images?.img_microsite_thumbnail?.url || "",
      platforms: platformsOf(tags),
      patch: tags.includes("sto-patch-notes") || tags.includes("patch-notes"),
      url: `https://www.playstartrekonline.com/en/news/article/${id}`,
      urlDe: deEntry ? `https://www.playstartrekonline.com/de/news/article/${deEntry.id}` : "",
      de: german[id] || null,
      // Die API liefert kein Datum: wir merken uns, wann wir den Artikel zuerst gesehen haben.
      firstSeen: id in firstSeen ? firstSeen[id] : isFirstRun ? null : now,
    };
  });

  // Fehlende deutsche Texte nachladen (höchstens 15 pro Lauf, je 5 gleichzeitig)
  const todo = items.filter((i) => !i.de && i.urlDe).slice(0, 15);
  for (let k = 0; k < todo.length; k += 5) {
    await Promise.all(todo.slice(k, k + 5).map(async (i) => { i.de = await fetchGerman(i.urlDe); }));
  }

  await writeFile("data/news.json", JSON.stringify({ updatedAt: now, items }, null, 1));
  console.log("News:", items.length);
}

await mkdir("data", { recursive: true });
const results = await Promise.allSettled([updateStatus(), updateNews()]);
results.forEach((r) => r.status === "rejected" && console.error(r.reason));
