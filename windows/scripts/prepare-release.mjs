// Verify the built installer against the shipped updater public key, then
// prepare the manifest/assets. Never reads or prints the private signing key.
// Minisign format: https://jedisct1.github.io/minisign/#signature-format
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash, createPublicKey, verify } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
const version = config.version;
const name = `Awuuu_${version}_x64-setup.exe`;
const installer = join(root, "target/release/bundle/nsis", name);
const bytes = readFileSync(installer);
const signatureFile = readFileSync(`${installer}.sig`, "utf8").trim();
const decodeText = value => value.startsWith("untrusted comment:") ? value : Buffer.from(value, "base64").toString("utf8");
const pubLines = decodeText(config.plugins.updater.pubkey).trim().split(/\r?\n/);
const sigLines = decodeText(signatureFile).trim().split(/\r?\n/);
const pub = Buffer.from(pubLines[1], "base64");
const sig = Buffer.from(sigLines[1], "base64");
if (pub.length !== 42 || sig.length !== 74 || !pub.subarray(2, 10).equals(sig.subarray(2, 10))) {
  throw new Error("Installer signature does not match the shipped updater key");
}
const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), pub.subarray(10)]), format: "der", type: "spki" });
const algorithm = sig.subarray(0, 2).toString("ascii");
if (algorithm !== "ED" && algorithm !== "Ed") throw new Error("Unsupported Minisign algorithm");
const data = algorithm === "ED" ? createHash("blake2b512").update(bytes).digest() : bytes;
if (!verify(null, data, key, sig.subarray(10))) throw new Error("Installer signature verification failed");
if (!sigLines[2]?.startsWith("trusted comment: ")) throw new Error("Missing trusted signature comment");
const comment = Buffer.from(sigLines[2].slice("trusted comment: ".length));
if (!verify(null, Buffer.concat([sig.subarray(10), comment]), key, Buffer.from(sigLines[3], "base64"))) {
  throw new Error("Trusted signature comment verification failed");
}
const out = join(root, "release");
mkdirSync(out, { recursive: true });
const notes = readFileSync(join(root, `../docs/releases/${version}.md`), "utf8");
writeFileSync(join(out, "latest.json"), JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms: {
  "windows-x86_64": { signature: signatureFile, url: `https://github.com/Thanawat-ONZro/Awuuu/releases/download/windows-v${version}/${name}` },
} }, null, 2) + "\n");
const sha256 = createHash("sha256").update(bytes).digest("hex");
writeFileSync(join(out, "SHA256SUMS.txt"), `${sha256}  ${name}\n`);
console.log(JSON.stringify({ version, installer, bytes: bytes.length, signatureVerified: true, trustedCommentVerified: true, sha256 }, null, 2));
