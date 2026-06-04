import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CALL_REVIEW_JUDGE_VERSION,
  CALL_REVIEW_RESPONSE_SCHEMA,
  isJudgeResult,
  type JudgeResult,
  type NormalizedReviewInput,
} from "@/lib/call-review/types";

const DEFAULT_MODEL = process.env.CALL_REVIEW_MODEL || "gpt-5.5";
const CODEX_BIN = process.env.CALL_REVIEW_CODEX_BIN || "codex";
const DEFAULT_TIMEOUT_MS = parsePositiveInt(
  process.env.CALL_REVIEW_TIMEOUT_MS,
  5 * 60 * 1000,
);
const REPO_ROOT = join(/* turbopackIgnore: true */ process.cwd(), ".");

const SYSTEM_PROMPT = `You are reviewing a completed real production phone call handled by a medical scheduling voice agent.

This is Harness 3. Your job is to judge hallucinations, tool call reliability, and workflow quality using only the provided redacted call evidence.

Use only:
- transcript turns
- tool events and sanitized tool execution records
- caller context and preloaded context
- runtime/state signals
- deterministic findings

Do not invent facts.
Do not assume a tool was called unless it appears in the input.
Do not assume a factual claim is grounded unless it is backed by caller context, tool output, knowledge lookup result, state signals, or the caller's own words.
Preloaded caller context counts as grounding. If preloaded appointment details match what the agent said, do not require confirm_appt solely for those details.
Known office context counts as grounding for the opening practice identity.
Routine scripted self-identification is not a hallucination by itself.
General voicemail or callback guidance is not a hallucination by itself unless contradicted by the transcript or tool output.

Treat deterministic findings as high-signal hints. Verify them against the call evidence before making them findings.

Tool use labels:
- correct: the right tool was used at the right time with reasonable arguments
- questionable: plausible but inefficient, delayed, redundant, or slightly off
- incorrect: a required tool was skipped, the wrong tool was used, or tool use materially conflicted with caller intent or known data

Resolution path labels:
- optimal
- acceptable
- inefficient
- failed

Set passed=false if any of these are true:
- there is a major unsupported factual claim
- a required tool was skipped and that changed what the agent told the caller
- the agent claimed booking, cancellation, reschedule, confirmation, or insurance success without grounded tool/context support
- the caller's core intent was not handled and should reasonably have been handled with the available tools/context
- runtime or observability evidence shows the call result is unreliable

Do not fail a call for minor phrasing oddities alone. Prioritize factual grounding, tool correctness, and whether the caller's goal was handled reasonably.

Return only valid JSON matching the schema.`;

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function buildPrompt(input: NormalizedReviewInput) {
  return `${SYSTEM_PROMPT}

Review this completed call.

CALL DATA:
${JSON.stringify(input, null, 2)}`;
}

export async function runCodexCallReview(input: NormalizedReviewInput): Promise<{
  judgeModel: string;
  judgeVersion: string;
  result: JudgeResult;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), "agent-call-review-"));
  const schemaPath = join(tempDir, "schema.json");
  const outputPath = join(tempDir, "result.json");

  try {
    await writeFile(
      schemaPath,
      JSON.stringify(CALL_REVIEW_RESPONSE_SCHEMA, null, 2),
      "utf8",
    );

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        CODEX_BIN,
        [
          "exec",
          "-",
          "--model",
          DEFAULT_MODEL,
          "--sandbox",
          "read-only",
          "--skip-git-repo-check",
          "--ephemeral",
          "--color",
          "never",
          "--output-schema",
          schemaPath,
          "--output-last-message",
          outputPath,
        ],
        {
          cwd: REPO_ROOT,
          env: { ...process.env, NO_COLOR: "1" },
          stdio: ["pipe", "ignore", "pipe"],
        },
      );

      let stderr = "";
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5000).unref();
      }, DEFAULT_TIMEOUT_MS);

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        if (timedOut) {
          reject(new Error(`codex timed out after ${DEFAULT_TIMEOUT_MS}ms`));
          return;
        }

        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`codex exited with code ${code}: ${stderr.trim()}`));
      });

      child.stdin.end(buildPrompt(input));
    });

    const outputText = await readFile(outputPath, "utf8");
    const parsed = JSON.parse(outputText) as unknown;

    if (!isJudgeResult(parsed)) {
      throw new Error("Codex review returned JSON that did not match JudgeResult");
    }

    return {
      judgeModel: DEFAULT_MODEL,
      judgeVersion: CALL_REVIEW_JUDGE_VERSION,
      result: parsed,
    };
  } catch (error) {
    throw new Error(
      `Codex call review failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
