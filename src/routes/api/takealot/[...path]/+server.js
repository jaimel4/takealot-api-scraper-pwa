const ALLOWED_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function withCors(headers) {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "*");
  return headers;
}

export async function GET({ params, url, request }) {
  const pathParam = params.path || "";
  const trimmed = pathParam.replace(/^\/+/, "");

  if (!trimmed) {
    return new Response(JSON.stringify({ error: "Missing API path" }), {
      status: 400,
      headers: withCors(new Headers({ "Content-Type": "application/json" })),
    });
  }

  const target = new URL(`https://api.takealot.com/rest/${trimmed}`);
  url.searchParams.forEach((value, key) => {
    target.searchParams.append(key, value);
  });

  try {
    const response = await fetch(target.toString(), {
      method: "GET",
      headers: {
        "user-agent": request.headers.get("user-agent") || "Mozilla/5.0",
        accept: request.headers.get("accept") || "application/json",
      },
    });

    const body = await response.arrayBuffer();
    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response(body, {
      status: response.status,
      headers: withCors(headers),
    });
  } catch {
    return new Response(JSON.stringify({ error: "Upstream fetch failed" }), {
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
