const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "GET") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: corsHeaders },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const apiKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !apiKey) {
    return Response.json(
      { status: "error", message: "Supabase is not configured" },
      { status: 503, headers: corsHeaders },
    );
  }

  try {
    const authHealth = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/auth/v1/health`,
      {
        headers: { apikey: apiKey },
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!authHealth.ok) {
      return Response.json(
        { status: "error", supabase: "unreachable" },
        { status: 503, headers: corsHeaders },
      );
    }

    return Response.json(
      { status: "ok", supabase: "connected" },
      { headers: corsHeaders },
    );
  } catch {
    return Response.json(
      { status: "error", supabase: "unreachable" },
      { status: 503, headers: corsHeaders },
    );
  }
});