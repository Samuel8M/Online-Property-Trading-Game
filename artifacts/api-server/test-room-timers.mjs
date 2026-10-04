import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Bundle workspace TS entrypoints; native Node cannot resolve their imports.
const dir = await mkdtemp(join(tmpdir(), "room-timer-tests-"));
try {
  const tests = ["room-timers.test"];
  if (process.env.GAME_API_TEST === "1") tests.push("lifecycle-api.integration.test");
  const outfiles = await Promise.all(tests.map(async name => {
    const outfile = join(dir, `${name}.cjs`);
    await build({
      entryPoints: [fileURLToPath(new URL(`./src/lib/${name}.ts`, import.meta.url))],
      outfile, bundle: true, platform: "node", format: "cjs", external: ["pg-native"],
    });
    return outfile;
  }));
  const result = spawnSync(process.execPath, ["--test", ...outfiles], {
    stdio: "inherit", env: { ...process.env, NODE_ENV: "production" },
  });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}