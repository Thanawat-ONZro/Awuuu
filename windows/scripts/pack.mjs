// Copies the installer Tauri buries in target/release/bundle/nsis/ into
// windows/release/, with the name it ships under. Used by `npm run pack` and by
// the release workflow, so both produce exactly the same file names.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// `--build` runs `tauri build` first. With the updater key at hand (env or
// %USERPROFILE%/.tauri/awuuu-updater.key) the installer is signed for
// self-update; without it (CI, another machine) signing is switched off so the
// build still works — such an installer just can't be published as an update.
if (process.argv.includes("--build")) {
  const keyFile = join(homedir(), ".tauri", "awuuu-updater.key");
  const env = { ...process.env };
  const args = ["tauri", "build"];
  // AWUUU_UNSIGNED=1 forces an unsigned build even where the key exists.
  if (env.AWUUU_UNSIGNED === "1") delete env.TAURI_SIGNING_PRIVATE_KEY;
  else if (!env.TAURI_SIGNING_PRIVATE_KEY && existsSync(keyFile)) {
    env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyFile, "utf8");
    env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";
  }
  if (!env.TAURI_SIGNING_PRIVATE_KEY) {
    console.log("  No updater key — building unsigned (fine for testing, not for release).");
    // Passed as a file: cmd.exe would mangle inline JSON.
    const override = join(root, "target", "no-updater.conf.json");
    mkdirSync(dirname(override), { recursive: true });
    writeFileSync(override, JSON.stringify({ bundle: { createUpdaterArtifacts: false } }));
    args.push("--config", override);
  }
  execFileSync("npx", args, { cwd: root, stdio: "inherit", env, shell: process.platform === "win32" });
}
const bundleDir = join(root, "target", "release", "bundle", "nsis");
const outDir = join(root, "release");

const { version } = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));

let installers = [];
try {
  installers = readdirSync(bundleDir).filter((f) => f.endsWith("-setup.exe"));
} catch {
  console.error(`No installer in ${bundleDir} — run \`npm run tauri build\` first.`);
  process.exit(1);
}
if (installers.length === 0) {
  console.error(`No installer in ${bundleDir} — run \`npm run tauri build\` first.`);
  process.exit(1);
}

// Newest wins, in case an older build is still lying around.
const built = installers
  .map((f) => join(bundleDir, f))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];

mkdirSync(outDir, { recursive: true });
const versioned = join(outDir, `Awuuu-Windows-${version}-setup.exe`);
const rolling = join(outDir, "Awuuu-Windows-setup.exe");
copyFileSync(built, versioned);
copyFileSync(built, rolling);

const mb = (statSync(versioned).size / 1024 / 1024).toFixed(2);
console.log(`\n  Installer ready — ${mb} MB\n`);
console.log(`  ${versioned}`);
console.log(`  ${rolling}\n`);
