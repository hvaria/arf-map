/**
 * Generates PNG icons from icon.svg using the Canvas API (via node-canvas if installed,
 * otherwise falls back to writing SVG copies named as PNG — replace with actual PNGs for production).
 *
 * Run:  node script/generate-icons.mjs
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.resolve(__dirname, "../client/public/icons");
const svgPath = path.join(iconsDir, "icon.svg");
const svgContent = readFileSync(svgPath, "utf8");

// Try to use @resvg/resvg-js for high-quality PNG generation
let generated = false;
try {
  const { Resvg } = await import("@resvg/resvg-js");
  const sizes = [
    { name: "icon-192.png", size: 192 },
    { name: "icon-512.png", size: 512 },
    { name: "apple-touch-icon.png", size: 180 },
  ];
  for (const { name, size }) {
    const resvg = new Resvg(svgContent, {
      fitTo: { mode: "width", value: size },
    });
    const png = resvg.render().asPng();
    writeFileSync(path.join(iconsDir, name), png);
    console.log(`✓ Generated ${name} (${size}×${size})`);
  }
  generated = true;
} catch {
  // @resvg/resvg-js not installed — copy SVG with PNG extension as fallback
  console.warn("@resvg/resvg-js not found. Installing it for proper PNG generation:");
  console.warn("  npm install --save-dev @resvg/resvg-js");
  console.warn("\nFallback: copying SVG as PNG placeholder (replace with real PNGs before publishing).");
  for (const name of ["icon-192.png", "icon-512.png", "apple-touch-icon.png"]) {
    writeFileSync(path.join(iconsDir, name), svgContent, "utf8");
  }
}

if (generated) {
  console.log("\n✅ Icons generated in client/public/icons/");
} else {
  console.log("\n⚠️  SVG placeholders written. Run after installing @resvg/resvg-js for proper PNGs.");
}
