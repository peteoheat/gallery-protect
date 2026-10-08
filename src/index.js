const PBKDF2_ITERATIONS = 100000;
const PBKDF2_HASH = "SHA-256";
const SESSION_LIFETIME = 7 * 24 * 60 * 60;

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error("gallery-protect exception:", error);
      return new Response(`Gallery Worker error\n\n${error?.message || String(error)}`, {
        status: 500,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
  },
};

async function handleRequest(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  if (!env.AUTH_SECRET) {
    return new Response("Gallery Worker configuration error: AUTH_SECRET is not configured.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const url = new URL(request.url);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  const allowedHosts = (env.DOMAIN_NAMES || "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^www\./, ""))
    .filter(Boolean);
  if (!allowedHosts.includes(host)) {
    return new Response("Unknown gallery domain.", { status: 400 });
  }

  const bucket = env.GALLERY_BUCKET;
  if (!bucket) {
    return new Response("Gallery Worker configuration error: R2 bucket binding is missing.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  if (!pathname.startsWith("/")) pathname = `/${pathname}`;

  const pathParts = pathname.split("/");
  if (pathParts.includes("..")) return new Response("Bad Request", { status: 400 });

  if (pathname === "/") return serveObject(bucket, "index.html", request);

  const relativePath = pathname.replace(/^\/+/, "");

  // Never expose secret files, including a root-level .secrets object.
  if (relativePath === ".secrets" || relativePath.endsWith("/.secrets")) {
    return new Response("Not Found", { status: 404 });
  }

  // Root-level files (favicon, CSS, JS, etc.) are public.
  if (!relativePath.includes("/")) {
    return serveObject(bucket, relativePath, request);
  }

  const firstSlash = relativePath.indexOf("/");
  const eventName = relativePath.substring(0, firstSlash);
  let requestedFile = relativePath.substring(firstSlash + 1);

  if (!eventName) return new Response("Bad Request", { status: 400 });
  if (!requestedFile) requestedFile = "gallery.html";

  const secretsKey = `${eventName}/.secrets`;
  const secretObject = await bucket.get(secretsKey);

  if (!secretObject) return new Response("Event not found.", { status: 404 });

  const storedSecret = (await secretObject.text()).trim();
  if (!storedSecret) return new Response("Event configuration error.", { status: 500 });

  const cookieHeader = request.headers.get("Cookie");
  const sessionToken = getCookie(cookieHeader, "eventAuth");
  let authenticated = sessionToken
    ? await verifySession(sessionToken, eventName, env.AUTH_SECRET)
    : false;

  const suppliedKey = url.searchParams.get("key");

  if (!authenticated && suppliedKey !== null) {
    if (!isPasswordHash(storedSecret)) {
      if (constantTimeEqual(suppliedKey, storedSecret)) {
        const newHash = await createPasswordHash(suppliedKey);
        await bucket.put(secretsKey, newHash, {
          httpMetadata: { contentType: "text/plain" },
        });
        authenticated = true;
      }
    } else {
      authenticated = await verifyPassword(suppliedKey, storedSecret);
    }

    if (authenticated) {
      const session = await createSession(eventName, env.AUTH_SECRET);
      const cleanUrl = new URL(url);
      cleanUrl.searchParams.delete("key");

      const headers = new Headers();
      headers.set("Set-Cookie", buildSessionCookie("eventAuth", session, eventName));
      headers.set("Location", cleanUrl.toString());
      headers.set("Cache-Control", "no-store, no-cache, must-revalidate");

      return new Response(null, { status: 302, headers });
    }
  }

  if (!authenticated) return passwordPage(eventName);

  return serveObject(bucket, `${eventName}/${requestedFile}`, request);
}

async function createPasswordHash(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    keyMaterial,
    256
  );

  return [
    "PBKDF2",
    PBKDF2_ITERATIONS,
    base64UrlEncode(salt),
    base64UrlEncode(new Uint8Array(derivedBits)),
  ].join("$");
}

async function verifyPassword(password, storedHash) {
  try {
    const parts = storedHash.split("$");
    if (parts.length !== 4 || parts[0] !== "PBKDF2") return false;

    const iterations = Number(parts[1]);
    const salt = base64UrlDecode(parts[2]);
    const expectedHash = base64UrlDecode(parts[3]);

    if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS) return false;

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const derivedBits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: PBKDF2_HASH },
      keyMaterial,
      expectedHash.length * 8
    );

    return constantTimeEqualBytes(new Uint8Array(derivedBits), expectedHash);
  } catch (error) {
    console.error("Password verification failed:", error);
    return false;
  }
}

function isPasswordHash(value) {
  const parts = value.split("$");
  if (parts.length !== 4 || parts[0] !== "PBKDF2") return false;
  const iterations = Number(parts[1]);
  return Number.isInteger(iterations) && iterations > 0;
}

async function createSession(eventName, secret) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    event: eventName,
    iat: now,
    exp: now + SESSION_LIFETIME,
    nonce: crypto.randomUUID(),
  };

  const payloadEncoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacSign(payloadEncoded, secret);
  return `${payloadEncoded}.${signature}`;
}

async function verifySession(token, eventName, secret) {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return false;

    const payloadEncoded = parts[0];
    const suppliedSignature = parts[1];
    const expectedSignature = await hmacSign(payloadEncoded, secret);

    if (!constantTimeEqual(suppliedSignature, expectedSignature)) return false;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadEncoded)));
    const now = Math.floor(Date.now() / 1000);

    return payload.event === eventName && typeof payload.exp === "number" && payload.exp > now;
  } catch {
    return false;
  }
}

async function hmacSign(data, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return base64UrlEncode(new Uint8Array(signature));
}

function buildSessionCookie(name, value, eventName) {
  return [
    `${name}=${value}`,
    `Path=/${encodeURIComponent(eventName)}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${SESSION_LIFETIME}`,
  ].join("; ");
}

function getCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const cookie of cookieHeader.split(";")) {
    const [key, ...valueParts] = cookie.trim().split("=");
    if (key === name) return valueParts.join("=");
  }
  return null;
}

async function serveObject(bucket, key, request) {
  const object = await bucket.get(key);
  if (!object) {
    return new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  headers.set("X-Robots-Tag", "noindex, nofollow");

  if (!headers.has("Content-Type")) headers.set("Content-Type", getContentType(key));

  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(object.body, { status: 200, headers });
}

function passwordPage(eventName) {
  const safeEventName = escapeHtml(eventName);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Gallery Password</title>
<style>
body{font-family:Arial,sans-serif;background:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.container{background:#fff;padding:40px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.15);width:min(90%,400px);text-align:center}
input{width:100%;box-sizing:border-box;padding:12px;margin:20px 0;font-size:18px}
button{padding:12px 24px;font-size:16px;cursor:pointer}
</style>
</head>
<body>
<div class="container">
<h1>Private Gallery</h1>
<p>Please enter the gallery password.</p>
<form method="GET">
<input type="password" name="key" autocomplete="current-password" required autofocus>
<button type="submit">Enter Gallery</button>
</form>
</div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function getContentType(key) {
  const lower = key.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".ico")) return "image/x-icon";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  let base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const maxLength = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let i = 0; i < maxLength; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    difference |= ca ^ cb;
  }
  return difference === 0;
}

function constantTimeEqualBytes(a, b) {
  const maxLength = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let i = 0; i < maxLength; i++) {
    const ca = i < a.length ? a[i] : 0;
    const cb = i < b.length ? b[i] : 0;
    difference |= ca ^ cb;
  }
  return difference === 0;
}

function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
