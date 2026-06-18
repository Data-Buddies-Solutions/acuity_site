import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const analyticsRoot = path.resolve(repoRoot, "../call-analytics");

const PRACTICE_NAME = "Abita Eye Group";
const DEMO_EMAIL = "demo@acuity.local";
const LIVE_LOCATIONS = [
  {
    label: "Crystal River",
    phoneNumber: "+13523202007",
  },
  {
    label: "Spring Hill",
    phoneNumber: "+17275919997",
  },
  {
    label: "Demo",
    phoneNumber: "+14843989071",
  },
];
const BACKFILL_DAYS = 14;

function readEnvFile(filePath) {
  const env = {};
  const raw = fs.readFileSync(filePath, "utf8");

  for (const line of raw.split(/\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function dollarsToMicros(dollars) {
  return Math.max(0, Math.round(dollars * 1_000_000));
}

function estimateCostLineItems(call) {
  const inputTokens = Math.max(0, Number(call.inputTokens ?? 0));
  const outputTokens = Math.max(0, Number(call.outputTokens ?? 0));
  const cachedTokens = Math.max(0, Number(call.cachedTokens ?? 0));
  const nonCachedInput = Math.max(0, inputTokens - cachedTokens);
  const ttsChars = Math.max(0, Number(call.ttsChars ?? 0));
  const durationSec = Math.max(0, Number(call.durationSec ?? 0));
  const minutes = durationSec / 60;
  const model = call.llmModel || null;

  return [
    {
      category: "TELEPHONY",
      provider: "livekit",
      model: null,
      quantity: minutes,
      unit: "minutes",
      costMicros: dollarsToMicros(minutes * 0.01),
    },
    {
      category: "TELEPHONY",
      provider: "telnyx",
      model: null,
      quantity: minutes,
      unit: "minutes",
      costMicros: dollarsToMicros(minutes * 0.0035),
    },
    {
      category: "LLM_INPUT",
      provider: "baseten",
      model,
      quantity: nonCachedInput,
      unit: "tokens",
      costMicros: dollarsToMicros((nonCachedInput / 1_000_000) * 0.6),
    },
    {
      category: "LLM_CACHED_INPUT",
      provider: "baseten",
      model,
      quantity: cachedTokens,
      unit: "tokens",
      costMicros: dollarsToMicros((cachedTokens / 1_000_000) * 0.12),
    },
    {
      category: "LLM_OUTPUT",
      provider: "baseten",
      model,
      quantity: outputTokens,
      unit: "tokens",
      costMicros: dollarsToMicros((outputTokens / 1_000_000) * 2.2),
    },
    {
      category: "TEXT_TO_SPEECH",
      provider: "cartesia",
      model: null,
      quantity: ttsChars,
      unit: "characters",
      costMicros: dollarsToMicros((ttsChars / 1_000_000) * 39),
    },
    {
      category: "SPEECH_TO_TEXT",
      provider: "assemblyai",
      model: null,
      quantity: minutes,
      unit: "minutes",
      costMicros: dollarsToMicros(minutes * 0.0075),
    },
  ].filter((item) => item.quantity > 0 || item.costMicros > 0);
}

function getToolActions(data) {
  const actions = {
    bookedAppointment: false,
    cancelledAppointment: false,
    confirmedAppointment: false,
    transferred: false,
  };

  for (const turn of data?.turns ?? []) {
    for (const tool of turn.toolCalls ?? []) {
      if (tool.isError) {
        continue;
      }

      if (tool.name === "book_appt") {
        actions.bookedAppointment = true;
      }

      if (tool.name === "cancel_appt") {
        actions.cancelledAppointment = true;
      }

      if (tool.name === "confirm_appt") {
        actions.confirmedAppointment = true;
      }

      if (tool.name === "transfer_call") {
        actions.transferred = true;
      }
    }
  }

  return actions;
}

function getReviewAverageScore(result) {
  const scores = result?.scores;

  if (!scores || typeof scores !== "object") {
    return null;
  }

  const values = Object.values(scores).filter((value) => typeof value === "number");

  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function callNeedsReview(call, reviewResult) {
  if (Number(call.toolErrors ?? 0) > 0 || call.reviewStatus === "failed") {
    return true;
  }

  if (!reviewResult || typeof reviewResult !== "object") {
    return false;
  }

  return Boolean(
    reviewResult.passed === false ||
    reviewResult.labels?.hallucination !== "none" ||
    reviewResult.labels?.toolPath === "incorrect" ||
    reviewResult.labels?.resolutionPath === "failed",
  );
}

async function getOrCreatePractice(targetPool) {
  const now = new Date();
  const existingPractice = await targetPool.query(
    `SELECT id FROM practice WHERE name = $1 ORDER BY "createdAt" ASC LIMIT 1`,
    [PRACTICE_NAME],
  );

  let practiceId = existingPractice.rows[0]?.id;

  if (!practiceId) {
    const created = await targetPool.query(
      `INSERT INTO practice (
        id,
        name,
        "onboardingStatus",
        "practiceType",
        "launchedAt",
        "createdAt",
        "updatedAt"
      )
      VALUES ($1, $2, 'LIVE', 'OPHTHALMOLOGY', $3, $3, $3)
      RETURNING id`,
      [randomUUID(), PRACTICE_NAME, now],
    );

    practiceId = created.rows[0].id;
  } else {
    await targetPool.query(
      `UPDATE practice
      SET
        "onboardingStatus" = 'LIVE',
        "practiceType" = 'OPHTHALMOLOGY',
        "launchedAt" = COALESCE("launchedAt", $2),
        "updatedAt" = $2
      WHERE id = $1`,
      [practiceId, now],
    );
  }

  return practiceId;
}

async function ensureDemoMembership(targetPool, practiceId) {
  const now = new Date();
  const existingUser = await targetPool.query(`SELECT id FROM "user" WHERE email = $1`, [
    DEMO_EMAIL,
  ]);
  let userId = existingUser.rows[0]?.id;

  if (!userId) {
    const created = await targetPool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES ($1, 'Demo Account', $2, true, $3, $3)
      RETURNING id`,
      [randomUUID(), DEMO_EMAIL, now],
    );

    userId = created.rows[0].id;
  }

  await targetPool.query(
    `INSERT INTO practice_membership (
      id,
      "practiceId",
      "userId",
      role,
      "isPrimary",
      "createdAt",
      "updatedAt"
    )
    VALUES ($1, $2, $3, 'OWNER', true, $4, $4)
    ON CONFLICT ("practiceId", "userId")
    DO UPDATE SET role = 'OWNER', "isPrimary" = true, "updatedAt" = EXCLUDED."updatedAt"`,
    [randomUUID(), practiceId, userId, now],
  );
}

async function ensureAgent(targetPool, practiceId) {
  const now = new Date();
  const existingAgent = await targetPool.query(
    `SELECT id FROM practice_agent WHERE "practiceId" = $1 ORDER BY "createdAt" ASC LIMIT 1`,
    [practiceId],
  );
  const name = "Abita Eye Group Voice Agent";

  if (existingAgent.rows[0]?.id) {
    await targetPool.query(
      `UPDATE practice_agent
      SET name = $2, status = 'ACTIVE', "updatedAt" = $3
      WHERE id = $1`,
      [existingAgent.rows[0].id, name, now],
    );

    return existingAgent.rows[0].id;
  }

  const created = await targetPool.query(
    `INSERT INTO practice_agent (id, "practiceId", name, status, "createdAt", "updatedAt")
    VALUES ($1, $2, $3, 'ACTIVE', $4, $4)
    RETURNING id`,
    [randomUUID(), practiceId, name, now],
  );

  return created.rows[0].id;
}

async function ensureLocations(targetPool, practiceId) {
  const now = new Date();
  const locationByPhone = new Map();

  for (const [index, location] of LIVE_LOCATIONS.entries()) {
    const existingLocation = await targetPool.query(
      `SELECT id FROM practice_location
      WHERE "practiceId" = $1 AND name = $2
      ORDER BY "createdAt" ASC
      LIMIT 1`,
      [practiceId, location.label],
    );
    let locationId = existingLocation.rows[0]?.id;

    if (!locationId) {
      const created = await targetPool.query(
        `INSERT INTO practice_location (
          id,
          "practiceId",
          name,
          phone,
          "isPrimary",
          "createdAt",
          "updatedAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $6)
        RETURNING id`,
        [
          randomUUID(),
          practiceId,
          location.label,
          location.phoneNumber,
          index === 0,
          now,
        ],
      );

      locationId = created.rows[0].id;
    } else {
      await targetPool.query(
        `UPDATE practice_location
        SET phone = $3, "isPrimary" = $4, "updatedAt" = $5
        WHERE id = $1 AND "practiceId" = $2`,
        [locationId, practiceId, location.phoneNumber, index === 0, now],
      );
    }

    await targetPool.query(
      `INSERT INTO practice_phone_number (
        id,
        "practiceId",
        "locationId",
        "phoneNumber",
        label,
        "isPrimary",
        "createdAt",
        "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
      ON CONFLICT ("phoneNumber")
      DO UPDATE SET
        "practiceId" = EXCLUDED."practiceId",
        "locationId" = EXCLUDED."locationId",
        label = EXCLUDED.label,
        "isPrimary" = EXCLUDED."isPrimary",
        "updatedAt" = EXCLUDED."updatedAt"`,
      [
        randomUUID(),
        practiceId,
        locationId,
        location.phoneNumber,
        location.label,
        index === 0,
        now,
      ],
    );

    locationByPhone.set(location.phoneNumber, locationId);
  }

  return locationByPhone;
}

async function fetchSourceCalls(sourcePool) {
  const since = new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000);
  const phones = LIVE_LOCATIONS.map((location) => location.phoneNumber);
  const result = await sourcePool.query(
    `SELECT
      c.id,
      c."callId",
      c."callerPhone",
      c."officePhone",
      c."llmModel",
      c."fallbackUsed",
      c."startedAt",
      c."endedAt",
      c."durationSec",
      c."totalTurns",
      c."toolCalls",
      c."toolErrors",
      c."inputTokens",
      c."outputTokens",
      c."cachedTokens",
      c."ttsChars",
      c."avgTtft",
      c."avgTtsttfb",
      c."cacheHitRate",
      c."peakContext",
      c."avgTokensPerSec",
      c."interruptionCount",
      c."latencyValues",
      c.data,
      r.status AS "reviewStatus",
      r.result AS "reviewResult"
    FROM "CallEvent" c
    LEFT JOIN "CallReview" r ON r."callEventId" = c.id
    WHERE c."officePhone" = ANY($1)
      AND c."startedAt" >= $2
    ORDER BY c."startedAt" ASC`,
    [phones, since],
  );

  return result.rows;
}

async function upsertCall(targetPool, call, practiceId, agentId, locationByPhone) {
  const now = new Date();
  const actions = getToolActions(call.data);
  const reviewAverageScore = getReviewAverageScore(call.reviewResult);
  const needsReview = callNeedsReview(call, call.reviewResult);
  const costItems = estimateCostLineItems(call);
  const estimatedCostMicros = costItems.reduce((sum, item) => sum + item.costMicros, 0);
  const status = actions.transferred ? "ESCALATED" : "COMPLETED";
  const locationId = locationByPhone.get(call.officePhone) ?? null;
  const dataPayload = {
    ...(call.data && typeof call.data === "object" ? call.data : {}),
    reviewResult: call.reviewResult ?? null,
  };

  const upserted = await targetPool.query(
    `INSERT INTO agent_call (
      id,
      "practiceId",
      "locationId",
      "agentId",
      "callId",
      "callerPhone",
      "officePhone",
      status,
      "startedAt",
      "endedAt",
      "durationSec",
      transferred,
      "bookedAppointment",
      "confirmedAppointment",
      "cancelledAppointment",
      "needsReview",
      "reviewStatus",
      "reviewAverageScore",
      "reviewResult",
      "llmModel",
      "fallbackUsed",
      "totalTurns",
      "inputTokens",
      "outputTokens",
      "cachedTokens",
      "ttsChars",
      "toolCalls",
      "toolErrors",
      "avgTtft",
      "avgTtsttfb",
      "cacheHitRate",
      "peakContext",
      "avgTokensPerSec",
      "interruptionCount",
      "estimatedCostMicros",
      "latencyValues",
      data,
      "createdAt",
      "updatedAt"
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20,
      $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
      $31, $32, $33, $34, $35, $36::jsonb, $37::jsonb, $38, $38
    )
    ON CONFLICT ("callId")
    DO UPDATE SET
      "practiceId" = EXCLUDED."practiceId",
      "locationId" = EXCLUDED."locationId",
      "agentId" = EXCLUDED."agentId",
      "callerPhone" = EXCLUDED."callerPhone",
      "officePhone" = EXCLUDED."officePhone",
      status = EXCLUDED.status,
      "startedAt" = EXCLUDED."startedAt",
      "endedAt" = EXCLUDED."endedAt",
      "durationSec" = EXCLUDED."durationSec",
      transferred = EXCLUDED.transferred,
      "bookedAppointment" = EXCLUDED."bookedAppointment",
      "confirmedAppointment" = EXCLUDED."confirmedAppointment",
      "cancelledAppointment" = EXCLUDED."cancelledAppointment",
      "needsReview" = EXCLUDED."needsReview",
      "reviewStatus" = EXCLUDED."reviewStatus",
      "reviewAverageScore" = EXCLUDED."reviewAverageScore",
      "reviewResult" = EXCLUDED."reviewResult",
      "llmModel" = EXCLUDED."llmModel",
      "fallbackUsed" = EXCLUDED."fallbackUsed",
      "totalTurns" = EXCLUDED."totalTurns",
      "inputTokens" = EXCLUDED."inputTokens",
      "outputTokens" = EXCLUDED."outputTokens",
      "cachedTokens" = EXCLUDED."cachedTokens",
      "ttsChars" = EXCLUDED."ttsChars",
      "toolCalls" = EXCLUDED."toolCalls",
      "toolErrors" = EXCLUDED."toolErrors",
      "avgTtft" = EXCLUDED."avgTtft",
      "avgTtsttfb" = EXCLUDED."avgTtsttfb",
      "cacheHitRate" = EXCLUDED."cacheHitRate",
      "peakContext" = EXCLUDED."peakContext",
      "avgTokensPerSec" = EXCLUDED."avgTokensPerSec",
      "interruptionCount" = EXCLUDED."interruptionCount",
      "estimatedCostMicros" = EXCLUDED."estimatedCostMicros",
      "latencyValues" = EXCLUDED."latencyValues",
      data = EXCLUDED.data,
      "updatedAt" = EXCLUDED."updatedAt"
    RETURNING id`,
    [
      randomUUID(),
      practiceId,
      locationId,
      agentId,
      call.callId,
      call.callerPhone ?? "",
      call.officePhone ?? "",
      status,
      call.startedAt,
      call.endedAt,
      Number(call.durationSec ?? 0),
      actions.transferred,
      actions.bookedAppointment,
      actions.confirmedAppointment,
      actions.cancelledAppointment,
      needsReview,
      call.reviewStatus ?? null,
      reviewAverageScore,
      JSON.stringify(call.reviewResult ?? null),
      call.llmModel ?? null,
      Boolean(call.fallbackUsed),
      Number(call.totalTurns ?? 0),
      Number(call.inputTokens ?? 0),
      Number(call.outputTokens ?? 0),
      Number(call.cachedTokens ?? 0),
      Number(call.ttsChars ?? 0),
      Number(call.toolCalls ?? 0),
      Number(call.toolErrors ?? 0),
      Number(call.avgTtft ?? 0),
      Number(call.avgTtsttfb ?? 0),
      Number(call.cacheHitRate ?? 0),
      Number(call.peakContext ?? 0),
      Number(call.avgTokensPerSec ?? 0),
      Number(call.interruptionCount ?? 0),
      estimatedCostMicros,
      JSON.stringify(call.latencyValues ?? {}),
      JSON.stringify(dataPayload),
      now,
    ],
  );
  const agentCallId = upserted.rows[0].id;

  await targetPool.query(
    `DELETE FROM usage_cost_line_item
    WHERE "agentCallId" = $1
      AND provider = ANY($2)`,
    [
      agentCallId,
      [
        "assemblyai",
        "baseten",
        "cartesia",
        "elevenlabs",
        "livekit",
        "telnyx",
        "estimated",
      ],
    ],
  );

  if (costItems.length > 0) {
    const values = [];
    const placeholders = costItems.map((item, index) => {
      const base = index * 11;
      values.push(
        randomUUID(),
        practiceId,
        agentCallId,
        item.category,
        item.provider,
        item.model,
        item.quantity,
        item.unit,
        item.costMicros,
        call.startedAt,
        now,
      );

      return `(
        $${base + 1},
        $${base + 2},
        $${base + 3},
        $${base + 4},
        $${base + 5},
        $${base + 6},
        $${base + 7},
        $${base + 8},
        $${base + 9},
        $${base + 10},
        $${base + 11}
      )`;
    });

    await targetPool.query(
      `INSERT INTO usage_cost_line_item (
        id,
        "practiceId",
        "agentCallId",
        category,
        provider,
        model,
        quantity,
        unit,
        "costMicros",
        "occurredAt",
        "createdAt"
      )
      VALUES ${placeholders.join(",")}`,
      values,
    );
  }

  return { estimatedCostMicros, needsReview };
}

async function main() {
  const portalEnv = readEnvFile(path.join(repoRoot, ".env.local"));
  const analyticsEnv = readEnvFile(path.join(analyticsRoot, ".env"));
  const targetPool = new Pool({ connectionString: portalEnv.DATABASE_URL });
  const sourcePool = new Pool({ connectionString: analyticsEnv.DATABASE_URL });

  try {
    const practiceId = await getOrCreatePractice(targetPool);
    await ensureDemoMembership(targetPool, practiceId);
    const agentId = await ensureAgent(targetPool, practiceId);
    const locationByPhone = await ensureLocations(targetPool, practiceId);
    const calls = await fetchSourceCalls(sourcePool);

    console.log(`Importing ${calls.length} calls for ${PRACTICE_NAME}...`);

    let totalCostMicros = 0;
    let reviewCount = 0;

    for (const [index, call] of calls.entries()) {
      const result = await upsertCall(
        targetPool,
        call,
        practiceId,
        agentId,
        locationByPhone,
      );
      totalCostMicros += result.estimatedCostMicros;
      if (result.needsReview) {
        reviewCount++;
      }

      if ((index + 1) % 50 === 0 || index + 1 === calls.length) {
        console.log(`Imported ${index + 1}/${calls.length}`);
      }
    }

    console.log(
      JSON.stringify(
        {
          agentId,
          backfillDays: BACKFILL_DAYS,
          callsImported: calls.length,
          demoEmail: DEMO_EMAIL,
          liveNumbers: LIVE_LOCATIONS.length,
          practiceId,
          reviewCount,
          totalEstimatedCostMicros: totalCostMicros,
        },
        null,
        2,
      ),
    );
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
