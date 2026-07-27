/**
 * Depot Copilot — Cloudflare Worker proxy
 * =========================================
 * Purpose: MDM is a static single-file PWA with no server. An Anthropic API
 * key can never live in that client code — anyone can view-source it and
 * drain your account. This Worker is the thin server MDM was missing: it
 * holds the key as a secret, does basic abuse control, forwards the request
 * to Claude, and returns only the reply text.
 *
 * MODEL ROUTING:
 *   mode: 'chat'          -> Sonnet 5   (cheap, fast, fine for lookups/Q&A)
 *   mode: 'reconciliation' -> Fable 5   (expensive, but earns it on the
 *                             long-horizon, self-checking, multi-week
 *                             stock/shift reconciliation job)
 *
 * DEPLOY (one-time):
 *   1. Install wrangler:      npm install -g wrangler
 *   2. wrangler login
 *   3. wrangler kv namespace create COPILOT_KV      (for daily usage caps)
 *   4. Put the returned id into wrangler.toml (see bottom of this file)
 *   5. wrangler secret put ANTHROPIC_API_KEY
 *   6. wrangler secret put ALLOWED_ORIGIN            (e.g. https://mydepotmaster.github.io)
 *   7. wrangler deploy
 *   8. Copy the resulting *.workers.dev URL into COPILOT_ENDPOINT in index.html
 */

const MODEL_CHAT = 'claude-sonnet-5';
const MODEL_RECONCILE = 'claude-fable-5';

// Hard, server-side daily cap per depot — independent of the client's soft
// cap, which a modified client could ignore. This is the real backstop.
const DAILY_CAP_CHAT = 60;
const DAILY_CAP_RECONCILE = 10;

const SYSTEM_PROMPT_CHAT = `You are Depot Copilot, an assistant embedded in My Depot Master (MDM), a
depot/warehouse management app used by small businesses in Zambia. You are
given a JSON snapshot of one depot's recent data (staff counts, stock
movements, commodity list, low-stock flags, clock-in logs). Answer the
user's question using ONLY that data. If the data doesn't contain the
answer, say so plainly instead of guessing. Keep answers short and concrete
— numbers and specific item/staff names, not vague summaries. Amounts are
in the depot's local currency shown in the context. Do not invent figures.`;

const SYSTEM_PROMPT_RECONCILE = `You are Depot Copilot running a full end-of-day/period reconciliation for
My Depot Master, a depot management app used in Zambia. You are given a
JSON snapshot covering roughly the last 30 days: stock received, stock
issued, commodities, and staff clock-in/out logs. Your job:
1. Cross-check received vs issued quantities per item for anything that
   looks like an unexplained shortage or surplus.
2. Cross-reference discrepancies against clock-in logs where possible
   (e.g. a shortage on a day/shift with no logged staff, or an unusually
   short-staffed shift).
3. Flag anything genuinely anomalous — don't flag ordinary rounding.
4. Output a short prioritized list: item/date, what's off, likely cause if
   inferable, and confidence (low/medium/high). If nothing looks wrong,
   say so clearly rather than manufacturing findings.
Do not invent data not present in the context. Be concise — this is read
on a phone screen.`;

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return handleCors(env);
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, env);

    const origin = request.headers.get('Origin') || '';
    if (env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN) {
      return json({ error: 'Origin not allowed' }, 403, env);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400, env); }

    const { mode, depotId, question, context } = body;
    if (!depotId) return json({ error: 'Missing depotId' }, 400, env);
    if (mode !== 'chat' && mode !== 'reconciliation') return json({ error: 'Bad mode' }, 400, env);

    // ── Server-side daily cap (the real one) via Workers KV ──────────────────
    const today = new Date().toISOString().slice(0, 10);
    const usageKey = `usage:${depotId}:${mode}:${today}`;
    const used = parseInt((await env.COPILOT_KV.get(usageKey)) || '0', 10);
    const cap = mode === 'reconciliation' ? DAILY_CAP_RECONCILE : DAILY_CAP_CHAT;
    if (used >= cap) {
      return json({ error: `Daily ${mode} limit reached for this depot` }, 429, env);
    }

    const model = mode === 'reconciliation' ? MODEL_RECONCILE : MODEL_CHAT;
    const system = mode === 'reconciliation' ? SYSTEM_PROMPT_RECONCILE : SYSTEM_PROMPT_CHAT;
    const userContent = mode === 'reconciliation'
      ? `Depot data snapshot:\n${JSON.stringify(context)}\n\nRun the reconciliation.`
      : `Depot data snapshot:\n${JSON.stringify(context)}\n\nQuestion: ${question}`;

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: mode === 'reconciliation' ? 2000 : 700, // cap output — this is the main cost lever
          system,
          messages: [{ role: 'user', content: userContent }]
        })
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return json({ error: `Claude API error ${resp.status}: ${errText.slice(0, 300)}` }, 502, env);
      }

      const data = await resp.json();

      // stop_reason "refusal" comes back as a normal 200 on Fable 5/Sonnet —
      // surface it plainly rather than showing an empty reply.
      if (data.stop_reason === 'refusal') {
        return json({ reply: "Copilot declined to answer that one — try rephrasing, or ask something else about the depot data." }, 200, env);
      }

      const textBlock = (data.content || []).find(b => b.type === 'text');
      const reply = textBlock ? textBlock.text : '(no text in response)';

      // Only bump usage on a successful, billed call.
      await env.COPILOT_KV.put(usageKey, String(used + 1), { expirationTtl: 60 * 60 * 26 });

      return json({ reply }, 200, env);
    } catch (e) {
      return json({ error: 'Worker error: ' + (e.message || String(e)) }, 500, env);
    }
  }
};

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Firebase-AppCheck'
  };
}
function handleCors(env) { return new Response(null, { headers: corsHeaders(env) }); }
function json(obj, status, env) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) }
  });
}

/* ── wrangler.toml ─────────────────────────────────────────────────────────
name = "depot-copilot"
main = "depot-copilot-worker.js"
compatibility_date = "2026-01-01"

kv_namespaces = [
  { binding = "COPILOT_KV", id = "PASTE_YOUR_KV_NAMESPACE_ID_HERE" }
]

# Secrets (set via `wrangler secret put NAME`, do NOT put them in this file):
#   ANTHROPIC_API_KEY
#   ALLOWED_ORIGIN   e.g. https://mydepotmaster.github.io
──────────────────────────────────────────────────────────────────────────── */
