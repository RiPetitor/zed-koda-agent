#!/usr/bin/env node
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

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help || !options.target) {
    console.log(`Usage: node scripts/package-agent.mjs --target <os-arch> [options]

Options:
  --target <os-arch>  Target triple (e.g. linux-x86_64, darwin-aarch64)
  --out <dir>         Output directory (default: dist/agent/<target>)
  --skip-install      Skip npm install (use if node_modules already present)
`);
    process.exit(options.help ? 0 : 1);
  }

  const repoRoot = process.cwd();
  const agentSource = path.join(repoRoot, "agent_server.mjs");
  const packageJson = path.join(repoRoot, "package.json");
  const lockFile = path.join(repoRoot, "package-lock.json");

  const distRoot = options.outDir
    ? path.resolve(options.outDir)
    : path.join(repoRoot, "dist", "agent", options.target);
  const packageDir = path.join(distRoot, "package");
  const archivePath = path.join(
    distRoot,
    `koda-agent-${options.target}.tar.gz`,
  );

  await fs.rm(packageDir, { recursive: true, force: true });
  await fs.mkdir(packageDir, { recursive: true });

  await fs.copyFile(agentSource, path.join(packageDir, "agent_server.mjs"));
  await fs.copyFile(packageJson, path.join(packageDir, "package.json"));
  try {
    await fs.copyFile(lockFile, path.join(packageDir, "package-lock.json"));
  } catch {
    // package-lock.json is optional
  }

  if (!options.skipInstall) {
    await run("npm", ["install", "--omit=dev"], { cwd: packageDir });
  }

  await fs.mkdir(distRoot, { recursive: true });
  await run("tar", ["-czf", archivePath, "-C", packageDir, "."]);

  console.log(`Archive written to ${archivePath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
