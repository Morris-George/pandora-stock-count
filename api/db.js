// Tiny shared database for Pandora Stock Count.
// Stores documents in Upstash Redis (Vercel Marketplace). No other dependencies.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(cmds) {
  const r = await fetch(URL_.replace(/\/$/, "") + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "content-type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error("storage error " + r.status);
  const j = await r.json();
  return j.map((x) => {
    if (x && x.error) throw new Error(x.error);
    return x.result;
  });
}

const okPath = (p) => typeof p === "string" && p.length < 220 && /^[A-Za-z0-9_\-.]+(\/[A-Za-z0-9_\-.]+)*$/.test(p);
const parentOf = (p) => p.slice(0, p.lastIndexOf("/"));
const idOf = (p) => p.slice(p.lastIndexOf("/") + 1);
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };

async function writeDoc(path, data) {
  const t = Date.now();
  await redis([
    ["SET", "d:" + path, JSON.stringify({ t, d: data })],
    ["ZADD", "z:" + parentOf(path), t, idOf(path)],
    ["INCR", "ver"],
  ]);
  return t;
}

async function readColl(path, since) {
  const [ids] = await redis([["ZRANGEBYSCORE", "z:" + path, since, "+inf"]]);
  if (!ids || !ids.length) return [];
  const vals = await redis([["MGET", ...ids.map((i) => "d:" + path + "/" + i)]]);
  return ids.map((id, k) => {
    const o = parse(vals[0][k]);
    return o ? { id, t: o.t, d: o.d } : null;
  }).filter(Boolean);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!URL_ || !TOKEN) return res.status(503).json({ error: "storage not configured" });
  const need = process.env.ACCESS_CODE;
  if (need && req.headers["x-access"] !== need) return res.status(401).json({ error: "access code needed" });
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};
  try {
    switch (b.op) {
      case "ping":
        await redis([["GET", "ver"]]);
        return res.json({ ok: true });
      case "get": {
        if (!okPath(b.path)) return res.status(400).json({ error: "bad path" });
        const [v] = await redis([["GET", "d:" + b.path]]);
        const o = parse(v);
        return res.json({ exists: !!o, d: o ? o.d : null, t: o ? o.t : 0 });
      }
      case "set": {
        if (!okPath(b.path)) return res.status(400).json({ error: "bad path" });
        if (JSON.stringify(b.data || {}).length > 900000) return res.status(413).json({ error: "too large" });
        return res.json({ t: await writeDoc(b.path, b.data || {}) });
      }
      case "update": {
        if (!okPath(b.path)) return res.status(400).json({ error: "bad path" });
        const [v] = await redis([["GET", "d:" + b.path]]);
        const cur = (parse(v) || {}).d || {};
        return res.json({ t: await writeDoc(b.path, Object.assign({}, cur, b.data || {})) });
      }
      case "list": {
        if (!okPath(b.path)) return res.status(400).json({ error: "bad path" });
        return res.json({ docs: await readColl(b.path, 0) });
      }
      case "sync": {
        const subs = Array.isArray(b.subs) ? b.subs.slice(0, 12) : [];
        const [ver] = await redis([["GET", "ver"]]);
        if (String(ver || 0) === String(b.ver)) return res.json({ same: true, ver: ver || 0 });
        const out = [];
        for (const s of subs) {
          if (!okPath(s.path)) { out.push({}); continue; }
          if (s.k === "d") {
            const [v] = await redis([["GET", "d:" + s.path]]);
            const o = parse(v);
            out.push({ doc: o ? { t: o.t, d: o.d } : null });
          } else {
            out.push({ docs: await readColl(s.path, Number(s.since) || 0) });
          }
        }
        return res.json({ ver: ver || 0, res: out });
      }
      default:
        return res.status(400).json({ error: "unknown op" });
    }
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
