const ALLOWED_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function withCors(headers) {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "*");
  return headers;
}

export async function GET({ url, request }) {
  const targetUrl = url.searchParams.get("url");
  if (!targetUrl) {
    return new Response(JSON.stringify({ error: "Missing url" }), {
      status: 400,
      headers: withCors(new Headers({ "Content-Type": "application/json" })),
    });
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid url" }), {
      status: 400,
      headers: withCors(new Headers({ "Content-Type": "application/json" })),
    });
  }

  if (parsed.protocol !== "https:") {
    return new Response(JSON.stringify({ error: "Only https URLs are allowed" }), {
      status: 400,
      headers: withCors(new Headers({ "Content-Type": "application/json" })),
    });
  }

  try {
    const response = await fetch(parsed.toString(), {
      method: "GET",
      headers: {
        "user-agent": request.headers.get("user-agent") || "Mozilla/5.0",
      },
    });

    const body = await response.arrayBuffer();
    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.set("Cache-Control", "public, max-age=86400");
    return new Response(body, {
      status: response.status,
      headers: withCors(headers),
    });
  } catch {
    return new Response(JSON.stringify({ error: "Image fetch failed" }), {
      status: 502,
      headers: withCors(new Headers({ "Content-Type": "application/json" })),
    });
  }
}

export async function HEAD(event) {
  return GET(event);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: withCors(new Headers()),
  });
}

export async function POST() {
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: withCors(new Headers({ "Content-Type": "application/json" })),
  });
}

export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
