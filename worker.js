export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/log") {
      return new Response("Not found", { status: 404, headers: corsHeaders(request) });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders(request) });
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return new Response("Bad JSON", { status: 400, headers: corsHeaders(request) });
    }

    // Minimal validation
    const mode = data.mode;
    const moves = data.moves;
    const depth = data.depth;

    const allowedModes = new Set(["HvAI", "AIvH", "HvH"]);
    if (!allowedModes.has(mode)) {
      return new Response("Invalid mode", { status: 400, headers: corsHeaders(request) });
    }
    if (typeof moves !== "string" || moves.length < 1 || moves.length > 20000) {
      return new Response("Invalid moves", { status: 400, headers: corsHeaders(request) });
    }
    if (mode === "HvH") {
      // depth should be null/undefined
    } else {
      if (!Number.isInteger(depth) || depth < 1 || depth > 50) {
        return new Response("Invalid depth", { status: 400, headers: corsHeaders(request) });
      }
    }

    // Create an ID
    const id = crypto.randomUUID();
    const record = {
      id,
      ts: Date.now(),
      mode,
      depth: mode === "HvH" ? null : depth,
      moves,
      plies: data.plies ?? null,
      finalStore0: data.finalStore0 ?? null,
      finalStore1: data.finalStore1 ?? null,
    };

    // Store it
    await env.GAMES.put(id, JSON.stringify(record));

    return new Response("ok", { status: 200, headers: corsHeaders(request) });
  },
};

function corsHeaders(request) {
  // Lock this down to your real domain once you're happy:
  // e.g. "https://mancala.stephenlasinis.com"
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}