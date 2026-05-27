import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const distDir = path.resolve("dist");
const forbiddenStrings = [
  "Mira Frontend",
  "Noah Reviewer",
  "Browser smoke",
  "VITE_SLAVEY_E2E",
  "smoke-fixture",
];

const assetExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".map",
  ".svg",
  ".txt",
]);

const matches = [];

try {
  for await (const filePath of walk(distDir)) {
    if (!assetExtensions.has(path.extname(filePath))) {
      continue;
    }
    const contents = await readFile(filePath, "utf8");
    for (const forbidden of forbiddenStrings) {
      if (contents.includes(forbidden)) {
        matches.push(`${path.relative(process.cwd(), filePath)}: ${forbidden}`);
      }
    }
  }
} catch (error) {
  console.error(`Production bundle guard could not read dist/: ${error.message}`);
  process.exit(1);
}

if (matches.length > 0) {
  console.error("Production bundle includes E2E-only fixture strings:");
  for (const match of matches) {
    console.error(`- ${match}`);
  }
  process.exit(1);
}

console.log("Production bundle guard passed.");

async function* walk(dir) {
  for (const entry of await readdir(dir)) {
    const filePath = path.join(dir, entry);
    const info = await stat(filePath);
    if (info.isDirectory()) {
      yield* walk(filePath);
    } else if (info.isFile()) {
      yield filePath;
    }
  }
}
