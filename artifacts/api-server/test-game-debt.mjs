import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Keep shared workspace TypeScript bundled for native Node execution.
const dir = await mkdtemp(join(tmpdir(), "game-debt-tests-"));
try {
  const files = await Promise.all(["game-debt.test", "game-engine.test"].map(async name => {
    const outfile = join(dir, `${name}.cjs`);
    await build({
      entryPoints: [fileURLToPath(new URL(`./src/lib/${name}.ts`, import.meta.url))],
      outfile, bundle: true, platform: "node", format: "cjs", external: ["pg-native"],
    });
    return outfile;
  }));
  const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}