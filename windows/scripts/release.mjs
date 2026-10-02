// Publishes a new Awuuu version that every installed copy can update to.
//
//   npm run release -- 0.2.0 "What changed, one line or a few"
//
// 1. Refuses to run on a dirty tree, or with a version that isn't newer.
// 2. Bumps the version everywhere it lives, commits and pushes that commit.
// 3. Builds the installer signed with the updater key (never in the repo:
//    %USERPROFILE%\.tauri\awuuu-updater.key, or TAURI_SIGNING_PRIVATE_KEY).
// 4. Writes latest.json and creates the GitHub release `windows-v<version>`
//    with the installer, its signature and latest.json. Installed apps read
//    releases/latest/download/latest.json, so publishing is what ships it.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "Thanawat-ONZro/Awuuu";

const [version, ...noteWords] = process.argv.slice(2);
const notes = noteWords.join(" ").trim() || `Awuuu ${version}`;

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

// git, gh and node are real executables, so arguments (release notes with
// spaces) pass through untouched. Only npx is a .cmd and needs the shell.
function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });
}

function out(cmd, args) {
  return execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const parse = (v) => v.split(".").map(Number);
const newer = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

// ── Checks ────────────────────────────────────────────────────────────────────

if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  fail('Usage: npm run release -- <major.minor.patch> "release notes"');
}

const confPath = join(root, "src-tauri", "tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf8"));
if (!newer(version, conf.version)) fail(`${version} is not newer than the current ${conf.version}.`);

if (out("git", ["status", "--porcelain"])) fail("Commit or stash your changes first — the release commit must only bump versions.");

const keyFile = join(homedir(), ".tauri", "awuuu-updater.key");
const key = process.env.TAURI_SIGNING_PRIVATE_KEY ?? (existsSync(keyFile) ? readFileSync(keyFile, "utf8") : null);
if (!key) fail(`No signing key: expected ${keyFile} or TAURI_SIGNING_PRIVATE_KEY.`);

try {
  out("gh", ["auth", "status"]);
} catch {
  fail("GitHub CLI isn't logged in — run `gh auth login` first.");
}

const tag = `windows-v${version}`;
try {
  out("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`]);
  fail(`Tag ${tag} already exists.`);
} catch {
  // Not found — good.
}

// ── Bump ──────────────────────────────────────────────────────────────────────

console.log(`\n  Awuuu ${conf.version} → ${version}\n`);

conf.version = version;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");

for (const file of ["package.json", "package-lock.json"]) {
  const p = join(root, file);
  const json = JSON.parse(readFileSync(p, "utf8"));
  json.version = version;
  if (json.packages?.[""]) json.packages[""].version = version;
  writeFileSync(p, JSON.stringify(json, null, 2) + "\n");
}

const cargoPath = join(root, "Cargo.toml");
const cargo = readFileSync(cargoPath, "utf8");
const bumped = cargo.replace(/^version = "[^"]+"/m, `version = "${version}"`);
if (bumped === cargo) fail("Couldn't find the workspace version in Cargo.toml.");
writeFileSync(cargoPath, bumped);

// ── Build, signed ─────────────────────────────────────────────────────────────

// A signature left over from an earlier build must never ship with this one.
const bundleDir = join(root, "target", "release", "bundle", "nsis");
const installerName = `Awuuu_${version}_x64-setup.exe`;
const installer = join(bundleDir, installerName);
const sigFile = `${installer}.sig`;
rmSync(sigFile, { force: true });

run("npx", ["tauri", "build"], {
  shell: process.platform === "win32",
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: key,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
  },
});
run("node", ["scripts/pack.mjs"]); // copy out under the shipping name (no rebuild)

if (!existsSync(installer) || !existsSync(sigFile)) fail(`Expected ${installerName} and its .sig in ${bundleDir}.`);

const outDir = join(root, "release");
mkdirSync(outDir, { recursive: true });
const manifest = join(outDir, "latest.json");
writeFileSync(
  manifest,
  JSON.stringify(
    {
      version,
      notes,
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": {
          signature: readFileSync(sigFile, "utf8").trim(),
          url: `https://github.com/${REPO}/releases/download/${tag}/${installerName}`,
        },
      },
    },
    null,
    2,
  ) + "\n",
);

// ── Commit, push, publish ─────────────────────────────────────────────────────

// Lockfile may have picked up the new version too.
run("git", ["add", "Cargo.toml", "Cargo.lock", "package.json", "package-lock.json", "src-tauri/tauri.conf.json"]);
run("git", ["commit", "-m", `Release Awuuu ${version}`]);
run("git", ["push", "origin", "HEAD"]);

const head = out("git", ["rev-parse", "HEAD"]);
run("gh", [
  "release", "create", tag,
  installer, sigFile, manifest,
  "--repo", REPO,
  "--target", head,
  "--title", `Awuuu ${version}`,
  "--notes", notes,
  "--latest",
]);

console.log(`\n  ✓ Awuuu ${version} is out. Installed copies will offer it on their next check.\n`);
