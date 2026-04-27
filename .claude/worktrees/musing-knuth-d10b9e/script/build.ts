import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  const sharedEsbuildOptions = {
    platform: "node" as const,
    bundle: true,
    format: "cjs" as const,
    define: { "process.env.NODE_ENV": '"production"' },
    minify: true,
    external: externals,
    logLevel: "info" as const,
  };

  await esbuild({
    ...sharedEsbuildOptions,
    entryPoints: ["server/index.ts"],
    outfile: "dist/index.cjs",
  });

  // Compile the enrichment script so it can be run as `node dist/enrich.cjs`
  // in production without needing tsx or the raw TypeScript source files.
  console.log("building enrichment worker...");
  await esbuild({
    ...sharedEsbuildOptions,
    entryPoints: ["scripts/enrich-facilities.ts"],
    outfile: "dist/enrich.cjs",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
