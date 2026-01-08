#!/usr/bin/env node
/**
 * Package KODA Agent for distribution
 * Creates a tar.gz archive with all necessary files
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const options = {
    target: "",
    outDir: "",
    skipInstall: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target" && argv[i + 1]) {
      options.target = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--out" && argv[i + 1]) {
      options.outDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--skip-install") {
      options.skipInstall = true;
      continue;
    }
    if (arg === "--help") {
      return { help: true };
    }
  }

  return options;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      ...options,
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

/**
 * Recursively copy directory
 */
async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Skip test files and mocks
    if (
      entry.name.endsWith(".test.js") ||
      entry.name === "__mocks__" ||
      entry.name === "coverage"
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help || !options.target) {
    console.log(`Usage: node scripts/package-agent.mjs --target <os-arch> [options]

Options:
  --target <os-arch>  Target triple (e.g. linux-x86_64, darwin-aarch64)
  --out <dir>         Output directory (default: dist/agent/<target>)
  --skip-install      Skip npm install (use if node_modules already present)

Examples:
  node scripts/package-agent.mjs --target linux-x86_64
  node scripts/package-agent.mjs --target darwin-aarch64 --out ./release
`);
    process.exit(options.help ? 0 : 1);
  }

  const repoRoot = process.cwd();
  const srcDir = path.join(repoRoot, "src");
  const packageJson = path.join(repoRoot, "package.json");
  const lockFile = path.join(repoRoot, "package-lock.json");

  const distRoot = options.outDir
    ? path.resolve(options.outDir)
    : path.join(repoRoot, "dist", "agent", options.target);
  const packageDir = path.join(distRoot, "package");
  const archivePath = path.join(
    distRoot,
    `koda-agent-${options.target}.tar.gz`
  );

  console.log(`Packaging KODA Agent for ${options.target}...`);

  // Clean and create package directory
  await fs.rm(packageDir, { recursive: true, force: true });
  await fs.mkdir(packageDir, { recursive: true });

  // Copy source files (excluding tests)
  console.log("Copying source files...");
  await copyDir(srcDir, path.join(packageDir, "src"));

  // Copy package files
  await fs.copyFile(packageJson, path.join(packageDir, "package.json"));

  try {
    await fs.copyFile(lockFile, path.join(packageDir, "package-lock.json"));
  } catch {
    // package-lock.json is optional
  }

  // Copy legacy entry point for backwards compatibility
  const legacyEntry = path.join(repoRoot, "agent_server.mjs");
  try {
    await fs.copyFile(legacyEntry, path.join(packageDir, "agent_server.mjs"));
  } catch {
    // Create a simple entry point if legacy file doesn't exist
    await fs.writeFile(
      path.join(packageDir, "agent_server.mjs"),
      '#!/usr/bin/env node\nimport "./src/index.js";\n'
    );
  }

  // Install production dependencies
  if (!options.skipInstall) {
    console.log("Installing production dependencies...");
    await run("npm", ["install", "--omit=dev"], { cwd: packageDir });
  }

  // Create archive
  console.log("Creating archive...");
  await fs.mkdir(distRoot, { recursive: true });
  await run("tar", ["-czf", archivePath, "-C", packageDir, "."]);

  // Get archive size
  const stats = await fs.stat(archivePath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

  console.log(`\nArchive created: ${archivePath}`);
  console.log(`Size: ${sizeMB} MB`);
}

main().catch((error) => {
  console.error("Error:", error.message || error);
  process.exit(1);
});
