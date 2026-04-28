import { spawnSync } from "node:child_process";

const PRETTIER_FILE_PATTERN =
  /\.(css|html|js|jsx|json|jsonc|md|mjs|cjs|ts|tsx|yaml|yml)$/i;

function run(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function git(args) {
  const result = run("git", args);

  if (result.status !== 0) {
    return null;
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function isZeroSha(value) {
  return Boolean(value) && /^0+$/.test(value);
}

function changedFiles() {
  const base = process.env.PRETTIER_BASE_SHA;
  const head = process.env.PRETTIER_HEAD_SHA || "HEAD";

  if (base && !isZeroSha(base)) {
    return (
      git(["diff", "--name-only", "--diff-filter=ACMR", `${base}...${head}`]) ||
      git(["diff", "--name-only", "--diff-filter=ACMR", base, head]) ||
      []
    );
  }

  if (head && head !== "HEAD") {
    return git(["diff-tree", "--no-commit-id", "--name-only", "-r", head]) || [];
  }

  const tracked = git(["diff", "--name-only", "--diff-filter=ACMR"]) || [];
  const untracked = git(["ls-files", "--others", "--exclude-standard"]) || [];

  return [...new Set([...tracked, ...untracked])];
}

const files = changedFiles().filter((file) => PRETTIER_FILE_PATTERN.test(file));

if (!files.length) {
  console.log("No changed files need Prettier checks.");
  process.exit(0);
}

console.log(`Checking Prettier formatting for ${files.length} changed file(s).`);

const result = spawnSync("prettier", ["--check", ...files], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
