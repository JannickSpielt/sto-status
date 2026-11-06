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
  const list = Array.isArray(data) ? data : data.news || data.data || data.items || [];

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
