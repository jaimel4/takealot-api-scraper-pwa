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

  const urlParam = req.query?.url;
  const targetUrl = Array.isArray(urlParam) ? urlParam[0] : urlParam;

  if (!targetUrl) {
    res.status(400).json({ error: "Missing url" });
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    res.status(400).json({ error: "Invalid url" });
    return;
  }

  if (parsedUrl.protocol !== "https:") {
    res.status(400).json({ error: "Only https URLs are allowed" });
    return;
  }

  try {
    const response = await fetch(parsedUrl.toString(), {
      method: "GET",
      headers: {
        "user-agent": req.headers["user-agent"] || "Mozilla/5.0",
      },
    });

    const body = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type");
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.status(response.status).send(body);
  } catch {
    res.status(502).json({ error: "Image fetch failed" });
  }
}
