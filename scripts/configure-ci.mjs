import fs from "node:fs";

const bucket = process.env.R2_BUCKET;
const domains = (process.env.DOMAIN_NAMES || "")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean);

if (!bucket) throw new Error("GALLERY_R2_BUCKET repository variable is required");
if (!domains.length) throw new Error("GALLERY_DOMAIN_NAMES repository variable is required (comma-separated list)");

const config = {
  $schema: "./node_modules/wrangler/config-schema.json",
  name: "gallery-protect",
  main: "./src/index.js",
  compatibility_date: "2026-10-08",
  secrets: { required: ["AUTH_SECRET"] },
  vars: { DOMAIN_NAMES: domains.join(",") },
  r2_buckets: [{ binding: "GALLERY_BUCKET", bucket_name: bucket }],
  routes: domains.map((pattern) => ({ pattern, custom_domain: true }))
};

fs.writeFileSync("wrangler.jsonc", JSON.stringify(config, null, 2) + "\n");
