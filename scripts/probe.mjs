// Einmaliger Suchlauf: welche Star-Trek-Online-Server und -Adressen antworten?
import net from "node:net";
import dns from "node:dns/promises";
import { writeFile } from "node:fs/promises";

const hosts = [
  "launcher.startrekonline.com", "patchserver.crypticstudios.com", "accounts.crypticstudios.com",
  "accountserver.crypticstudios.com", "controllertracker.crypticstudios.com", "controllertracker0.crypticstudios.com",
  "controllertracker1.crypticstudios.com", "errortracker.crypticstudios.com", "login.startrekonline.com",
  "auth.crypticstudios.com", "www.playstartrekonline.com", "www.arcgames.com", "api.arcgames.com",
];
const tcp = (host, port, ms = 2500) => new Promise((r) => {
  const s = net.connect({ host, port });
  const done = (ok) => { s.destroy(); r(ok); };
  s.setTimeout(ms, () => done(false)); s.on("connect", () => done(true)); s.on("error", () => done(false));
});
const out = { dns: {}, open: {}, http: {}, news: null };
for (const h of hosts) {
  try { out.dns[h] = await dns.resolve4(h); } catch (e) { out.dns[h] = String(e.code); }
}
const ports = [80, 443, ...Array.from({ length: 501 }, (_, i) => 7000 + i)];
for (const h of hosts.filter((h) => Array.isArray(out.dns[h]))) {
  const res = await Promise.all(ports.map(async (p) => ((await tcp(h, p)) ? p : null)));
  out.open[h] = res.filter(Boolean);
}
const urls = [
  "http://launcher.startrekonline.com/", "https://launcher.startrekonline.com/",
  "http://launcher.startrekonline.com/launcher_server_status", "https://launcher.startrekonline.com/launcher_server_status",
  "http://launcher.startrekonline.com/launcher_server_status_json", "http://launcher.startrekonline.com/static/st/launcher_server_status",
  "https://api.arcgames.com/v1.0/games/sto/status", "https://api.arcgames.com/v1.0/games/sto/server_status",
  "https://api.arcgames.com/v1.0/games/sto", "http://patchserver.crypticstudios.com/",
];
for (const u of urls) {
  try {
    const r = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(10000) });
    out.http[u] = { status: r.status, loc: r.headers.get("location"), type: r.headers.get("content-type"), body: (await r.text()).slice(0, 600) };
  } catch (e) { out.http[u] = String(e.cause?.code || e.message); }
}
try {
  const r = await fetch("https://api.arcgames.com/v1.0/games/sto/news?limit=2&field[]=images.img_microsite_thumbnail");
  out.news = { status: r.status, type: r.headers.get("content-type"), cors: r.headers.get("access-control-allow-origin"), body: (await r.text()).slice(0, 1500) };
} catch (e) { out.news = String(e.message); }
await writeFile("data/probe.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
