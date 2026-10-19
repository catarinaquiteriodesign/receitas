// Leitor do Instagram para o Caderno de Receitas
// Corre na Cloudflare (Workers). Recebe o link de um reel ou publicação pública e devolve:
//   caption   a legenda
//   image     a imagem de capa
//   video     o endereço do vídeo, quando o Instagram o mostra
//   transcript o que é dito no vídeo (Whisper da Cloudflare), quando pedido
//
// Pontos de entrada:
//   GET /info?url=<link do instagram>&transcribe=1
//   GET /media?u=<endereço de imagem ou vídeo do instagram>   (para a app poder usar a imagem e o vídeo)
//   POST /transcribe   (corpo: o vídeo guardado no telemóvel) devolve { text } com o que é dito

// Sites que podem usar este leitor. Junta aqui o endereço da tua app se mudar.
const ALLOWED_ORIGINS = [
  "https://catarinaquiteriodesign.github.io",
  "http://localhost:8765",
];
const MEDIA_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
// Pedido interno que a página do Instagram usa para mostrar uma publicação. O Instagram muda-o de vez em quando:
// se deixar de funcionar, dá para trocar o número no Worker em Settings, Variables, com o nome DOC_ID.
const DEFAULT_DOC_ID = "8845758582119845";
const IG_APP_ID = "936619743392459";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: "origem não autorizada" }, 403, cors);

    const url = new URL(request.url);
    try {
      if (url.pathname === "/info") return await info(url, env, cors);
      if (url.pathname === "/media") return await media(url, cors);
      if (url.pathname === "/transcribe" && request.method === "POST") return await transcribe(request, env, cors);
      return json({ ok: true, uso: "/info?url=<link do instagram>" }, 200, cors);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 502, cors);
    }
  },
};

async function info(url, env, cors) {
  const link = url.searchParams.get("url") || "";
  const m = link.match(/instagram\.com\/(?:[^/]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  if (!m) return json({ error: "link do instagram inválido" }, 400, cors);
  const code = m[2];
  const out = { code, caption: "", image: "", video: "", transcript: "", sources: [] };

  // 1. Página de incorporação com legenda: costuma trazer a legenda completa e a imagem
  try {
    const html = await getText(`https://www.instagram.com/p/${code}/embed/captioned/`, BROWSER_UA);
    const cap = embedCaption(html);
    if (cap) { out.caption = cap; out.sources.push("embed"); }
    const img = attr(html, /class="EmbeddedMediaImage"[^>]*src="([^"]+)"/i) || attr(html, /<img[^>]+class="[^"]*EmbeddedMediaImage[^"]*"[^>]+src="([^"]+)"/i);
    if (img) out.image = decode(img);
    const vi = html.indexOf("video_url");
    if (vi >= 0) {
      const chunk = html.slice(vi, vi + 3000);
      const h = chunk.indexOf("https:");
      if (h >= 0) {
        const raw = chunk.slice(h).split(/\\*"/)[0];
        out.video = unescapeJson(raw);
      }
    }
  } catch (e) { out.sources.push("embed falhou"); }

  // 2. Pedido interno do Instagram: costuma trazer o vídeo, a legenda completa e a capa
  try {
    const g = await graphql(code, env);
    if (g) {
      if (g.video && !out.video) out.video = g.video;
      if (g.caption && g.caption.length > out.caption.length) out.caption = g.caption;
      if (g.image && !out.image) out.image = g.image;
      out.sources.push("graphql");
    }
  } catch (e) { out.sources.push("graphql falhou"); }

  // 3. Página da publicação, como a vê um leitor de pré-visualizações: imagem de capa e descrição
  try {
    const html = await getText(`https://www.instagram.com/p/${code}/`, CRAWLER_UA);
    const ogImage = meta(html, "og:image");
    const ogVideo = meta(html, "og:video") || meta(html, "og:video:secure_url");
    const ogDesc = meta(html, "og:description");
    if (ogImage) out.image = ogImage; // a capa escolhida no reel
    if (ogVideo && !out.video) out.video = ogVideo;
    const fromDesc = captionFromDescription(ogDesc);
    if (fromDesc.length > out.caption.length) { out.caption = fromDesc; out.sources.push("og"); }
  } catch (e) { out.sources.push("og falhou"); }

  // 4. Transcrição do áudio
  if (url.searchParams.get("transcribe") === "1" && out.video && env.AI) {
    try {
      const res = await fetch(out.video, { headers: { "User-Agent": BROWSER_UA } });
      const len = Number(res.headers.get("content-length") || 0);
      if (res.ok && (!len || len <= MAX_VIDEO_BYTES)) {
        const buf = await res.arrayBuffer();
        if (buf.byteLength <= MAX_VIDEO_BYTES) {
          const r = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: toBase64(buf) });
          out.transcript = (r && r.text) || "";
        }
      }
    } catch (e) { out.sources.push("transcrição falhou"); }
  }

  if (!out.caption && !out.image && !out.video) return json({ error: "o instagram não mostrou esta publicação", ...out }, 404, cors);
  return json(out, 200, cors);
}

async function graphql(code, env) {
  const lsd = "AVq" + Math.random().toString(36).slice(2, 10);
  const body = new URLSearchParams({
    av: "0", __d: "www", __user: "0", __a: "1", __req: "3", lsd,
    variables: JSON.stringify({ shortcode: code, fetch_tagged_user_count: null, hoisted_comment_id: null, hoisted_reply_id: null }),
    doc_id: (env && env.DOC_ID) || DEFAULT_DOC_ID,
  });
  const res = await fetch("https://www.instagram.com/graphql/query", {
    method: "POST",
    headers: {
      "User-Agent": BROWSER_UA, "Content-Type": "application/x-www-form-urlencoded",
      "X-IG-App-ID": IG_APP_ID, "X-FB-LSD": lsd, "X-ASBD-ID": "129477",
      "Origin": "https://www.instagram.com", "Referer": `https://www.instagram.com/reel/${code}/`,
      "Sec-Fetch-Site": "same-origin", "Accept": "*/*",
    },
    body,
  });
  if (!res.ok) throw new Error("http " + res.status);
  const data = await res.json();
  const m = data && data.data && (data.data.xdt_shortcode_media || data.data.shortcode_media);
  if (!m) return null;
  const capEdge = m.edge_media_to_caption && m.edge_media_to_caption.edges && m.edge_media_to_caption.edges[0];
  return {
    video: m.video_url || "",
    image: m.display_url || m.thumbnail_src || "",
    caption: (capEdge && capEdge.node && capEdge.node.text) || "",
  };
}

async function transcribe(request, env, cors) {
  if (!env.AI) return json({ error: "a ligação Workers AI (AI) não está configurada" }, 500, cors);
  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX_VIDEO_BYTES) return json({ error: "vídeo demasiado grande (máximo 25 MB)" }, 413, cors);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return json({ error: "sem vídeo" }, 400, cors);
  if (buf.byteLength > MAX_VIDEO_BYTES) return json({ error: "vídeo demasiado grande (máximo 25 MB)" }, 413, cors);
  const r = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: toBase64(buf) });
  return json({ text: (r && r.text) || "" }, 200, cors);
}

async function media(url, cors) {
  const u = url.searchParams.get("u") || "";
  let target;
  try { target = new URL(u); } catch { return json({ error: "endereço inválido" }, 400, cors); }
  if (target.protocol !== "https:" || !MEDIA_HOST.test(target.hostname)) return json({ error: "só imagens e vídeos do instagram" }, 400, cors);
  const res = await fetch(target.toString(), { headers: { "User-Agent": BROWSER_UA } });
  const headers = new Headers(cors);
  headers.set("Content-Type", res.headers.get("Content-Type") || "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=86400");
  return new Response(res.body, { status: res.status, headers });
}

/* ---------- ajudas ---------- */
function corsHeaders(origin) {
  const h = { "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" };
  if (ALLOWED_ORIGINS.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}
function json(data, status, cors) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
}
async function getText(u, ua) {
  const res = await fetch(u, { headers: { "User-Agent": ua, "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8", "Accept": "text/html" }, redirect: "follow" });
  if (!res.ok) throw new Error("http " + res.status);
  return await res.text();
}
function attr(html, re) { const m = html.match(re); return m ? m[1] : ""; }
function meta(html, prop) {
  const re1 = new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${prop}["']`, "i");
  return decode(attr(html, re1) || attr(html, re2));
}
function embedCaption(html) {
  const start = html.indexOf('class="Caption"');
  if (start < 0) return "";
  const end = html.indexOf('class="CaptionComments"', start);
  let block = html.slice(start, end > 0 ? html.lastIndexOf("<", end) : start + 20000);
  block = block.replace(/^[^>]*>/, "");
  block = block.replace(/<a[^>]*class="CaptionUsername"[^>]*>.*?<\/a>/i, "");
  block = block.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
  return decode(block).replace(/\n{3,}/g, "\n\n").trim();
}
function captionFromDescription(desc) {
  if (!desc) return "";
  const m = desc.match(/:\s*["“](.*)["”]\s*\.?$/s);
  return (m ? m[1] : desc).trim();
}
function decode(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}
function unescapeJson(s) {
  return s.replace(/\\+\//g, "/").replace(/\\+u0026/g, "&").replace(/\\+u003d/gi, "=");
}
function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}
