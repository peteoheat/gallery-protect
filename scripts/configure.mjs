import fs from "node:fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rl = readline.createInterface({ input, output });

const ask = async (question, fallback = "") => {
  const answer = (await rl.question(`${question}${fallback ? ` [${fallback}]` : ""}: `)).trim();
  return answer || fallback;
};

try {
  console.log("\nGallery Protect Wrangler configuration\n");
  console.log("This creates wrangler.jsonc from the safe example template.\n");

  const bucket = await ask("R2 bucket name (GALLERY_BUCKET)");
  const domainList = await ask("Custom domains, comma-separated");

  if (!bucket) {
    throw new Error("An R2 bucket name is required.");
  }

  const domains = domainList.split(",").map((d) => d.trim()).filter(Boolean);
  if (!domains.length) {
    throw new Error("At least one domain is required (it populates DOMAIN_NAMES).");
  }

  const routes = domains.map((domain) => ({ pattern: domain, custom_domain: true }));

  const config = {
    $schema: "./node_modules/wrangler/config-schema.json",
    name: "gallery-protect",
    main: "./src/index.js",
    compatibility_date: "2026-10-08",
    secrets: { required: ["AUTH_SECRET"] },
    vars: { DOMAIN_NAMES: domains.join(",") },
    r2_buckets: [{ binding: "GALLERY_BUCKET", bucket_name: bucket }],
    routes
  };

  fs.writeFileSync(
    "wrangler.jsonc",
    JSON.stringify(config, null, 2) + "\n",
    "utf8"
  );

  console.log("\nCreated wrangler.jsonc");
  console.log("This file is intentionally gitignored because it contains your deployment-specific configuration.");
  console.log("Next: npm run deploy:dry-run, then npx wrangler secret put AUTH_SECRET, then npm run deploy.\n");
} finally {
  rl.close();
}
