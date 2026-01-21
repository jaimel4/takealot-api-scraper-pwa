const ALLOWED_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (!ALLOWED_METHODS.has(req.method)) {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const rawPath = req.query?.path;
  const pathSegments = Array.isArray(rawPath)
    ? rawPath
    : rawPath
    ? [rawPath]
    : [];

  if (pathSegments.length === 0) {
    res.status(400).json({ error: "Missing API path" });
    return;
  }

  const apiUrl = new URL(
    `https://api.takealot.com/rest/${pathSegments.join("/")}`
  );

  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === "path" || value === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((v) => apiUrl.searchParams.append(key, v));
    } else {
      apiUrl.searchParams.append(key, value);
    }
  }

  try {
    const response = await fetch(apiUrl.toString(), {
      method: "GET",
      headers: {
        "user-agent": req.headers["user-agent"] || "Mozilla/5.0",
        accept: req.headers.accept || "application/json",
      },
    });

    const body = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type");
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }
    res.status(response.status).send(body);
  } catch (err) {
    res.status(502).json({ error: "Upstream fetch failed" });
  }
}
