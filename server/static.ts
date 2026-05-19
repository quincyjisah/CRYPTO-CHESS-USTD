import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 3000);
const root = join(process.cwd(), "dist");
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = createServer((request, response) => {
  if (request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "app" }));
    return;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  const normalized = normalize(url.pathname).replace(/^[\\/]+/, "");
  const safePath = normalized.includes("..") ? "index.html" : normalized;
  const requestedPath = safePath === "" ? "index.html" : safePath;
  const filePath = join(root, requestedPath);
  const fallbackPath = join(root, "index.html");
  const finalPath = existsSync(filePath) ? filePath : fallbackPath;
  const extension = extname(finalPath);

  response.writeHead(200, {
    "content-type": contentTypes[extension] ?? "application/octet-stream",
    "cache-control":
      extension === ".html"
        ? "no-store"
        : "public, max-age=31536000, immutable",
  });
  createReadStream(finalPath).pipe(response);
});

server.listen(PORT, () => {
  console.warn(`Crypto Chess app serving dist on ${PORT}`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
