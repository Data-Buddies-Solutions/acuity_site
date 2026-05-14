import { randomUUID } from "node:crypto";

import { config } from "dotenv";
import { Pool } from "pg";

import {
  ABITA_HOLLYWOOD_SWEETWATER_INSURANCE_RULES,
  ABITA_NEW_OFFICES,
} from "../lib/abita-office-data.ts";

config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

const PRACTICE_NAME = "Abita Eye Group";
const officeConfigs = ABITA_NEW_OFFICES;
const sharedInsuranceRules = ABITA_HOLLYWOOD_SWEETWATER_INSURANCE_RULES;

function parseSeatConfig() {
  const raw = process.env.ABITA_NEW_OFFICE_CALL_CENTER_SEATS_JSON;

  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("ABITA_NEW_OFFICE_CALL_CENTER_SEATS_JSON must be an object.");
  }

  return parsed;
}

function rulesForOffice(office) {
  return {
    ...sharedInsuranceRules,
    aliasRules: sharedInsuranceRules.aliasRules.map((rule) => ({
      ...rule,
      aliases: [...rule.aliases],
    })),
    acceptedPlans: [...sharedInsuranceRules.acceptedPlans],
    notAcceptedPlans: [...sharedInsuranceRules.notAcceptedPlans],
    officeLabel: office.name,
  };
}

function stableJsonStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

async function getPractice(pool) {
  const result = await pool.query(
    `SELECT id, name FROM practice WHERE name = $1 ORDER BY "createdAt" ASC LIMIT 1`,
    [PRACTICE_NAME],
  );

  const practice = result.rows[0];

  if (!practice) {
    throw new Error(`No practice found named ${PRACTICE_NAME}.`);
  }

  return practice;
}

async function upsertLocation(client, practiceId, office) {
  const now = new Date();
  const existing = await client.query(
    `
      SELECT id
      FROM practice_location
      WHERE "practiceId" = $1 AND LOWER(name) = LOWER($2)
      ORDER BY "createdAt" ASC
      LIMIT 1
    `,
    [practiceId, office.name],
  );
  const existingId = existing.rows[0]?.id;

  if (existingId) {
    const updated = await client.query(
      `
        UPDATE practice_location
        SET
          address = $3,
          email = $4,
          "hoursSummary" = $5,
          phone = $6,
          "updatedAt" = $7
        WHERE id = $1 AND "practiceId" = $2
        RETURNING id, name
      `,
      [
        existingId,
        practiceId,
        office.address,
        office.email,
        office.hoursSummary,
        office.primaryPhone,
        now,
      ],
    );
    return updated.rows[0];
  }

  const created = await client.query(
    `
      INSERT INTO practice_location (
        id,
        "practiceId",
        name,
        address,
        phone,
        email,
        "hoursSummary",
        "isPrimary",
        "createdAt",
        "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $8)
      RETURNING id, name
    `,
    [
      randomUUID(),
      practiceId,
      office.name,
      office.address,
      office.primaryPhone,
      office.email,
      office.hoursSummary,
      now,
    ],
  );

  return created.rows[0];
}

async function upsertPhoneNumbers(client, practiceId, locationId, office) {
  const now = new Date();

  for (const phone of office.phones) {
    await client.query(
      `
        INSERT INTO practice_phone_number (
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
          "updatedAt" = EXCLUDED."updatedAt"
      `,
      [
        randomUUID(),
        practiceId,
        locationId,
        phone.phoneNumber,
        phone.label,
        phone.isPrimary,
        now,
      ],
    );
  }
}

async function ensurePublishedKnowledgeRevision(client, documentId, markdown) {
  const latest = await client.query(
    `
      SELECT markdown
      FROM practice_knowledge_document_revision
      WHERE "documentId" = $1 AND status = 'PUBLISHED'
      ORDER BY "createdAt" DESC
      LIMIT 1
    `,
    [documentId],
  );

  if (latest.rows[0]?.markdown?.trim() === markdown.trim()) {
    return false;
  }

  await client.query(
    `
      INSERT INTO practice_knowledge_document_revision (
        id,
        "documentId",
        markdown,
        source,
        status,
        "createdAt",
        "publishedAt"
      )
      VALUES ($1, $2, $3, 'IMPORT', 'PUBLISHED', NOW(), NOW())
    `,
    [randomUUID(), documentId, markdown],
  );

  return true;
}

async function upsertKnowledgeDocument(client, practiceId, locationId, office) {
  const result = await client.query(
    `
      INSERT INTO practice_knowledge_document (
        id,
        "practiceId",
        "locationId",
        title,
        slug,
        "documentType",
        status,
        "createdAt",
        "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, 'KNOWLEDGE_BASE', 'ACTIVE', NOW(), NOW())
      ON CONFLICT ("practiceId", slug)
      DO UPDATE SET
        "locationId" = EXCLUDED."locationId",
        title = EXCLUDED.title,
        status = 'ACTIVE',
        "updatedAt" = NOW()
      RETURNING id
    `,
    [randomUUID(), practiceId, locationId, office.knowledgeTitle, office.documentSlug],
  );

  const revisionCreated = await ensurePublishedKnowledgeRevision(
    client,
    result.rows[0].id,
    office.knowledgeMarkdown,
  );

  return {
    revisionCreated,
    slug: office.documentSlug,
  };
}

async function ensurePublishedInsuranceRevision(client, ruleSetId, rules) {
  const rulesJson = JSON.stringify(rules);
  const stableRulesJson = stableJsonStringify(rules);
  const latest = await client.query(
    `
      SELECT rules::text AS rules
      FROM practice_insurance_rule_revision
      WHERE "ruleSetId" = $1 AND status = 'PUBLISHED'
      ORDER BY "createdAt" DESC
      LIMIT 1
    `,
    [ruleSetId],
  );

  if (latest.rows[0]?.rules) {
    try {
      if (stableJsonStringify(JSON.parse(latest.rows[0].rules)) === stableRulesJson) {
        return false;
      }
    } catch {
      // Fall through and publish a clean replacement revision.
    }
  }

  await client.query(
    `
      INSERT INTO practice_insurance_rule_revision (
        id,
        "ruleSetId",
        rules,
        source,
        status,
        "createdAt",
        "publishedAt"
      )
      VALUES ($1, $2, $3::jsonb, 'IMPORT', 'PUBLISHED', NOW(), NOW())
    `,
    [randomUUID(), ruleSetId, rulesJson],
  );

  return true;
}

async function upsertInsuranceRuleSet(client, practiceId, locationId, office) {
  const rules = rulesForOffice(office);
  const result = await client.query(
    `
      INSERT INTO practice_insurance_rule_set (
        id,
        "practiceId",
        "locationId",
        title,
        slug,
        status,
        "createdAt",
        "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, 'ACTIVE', NOW(), NOW())
      ON CONFLICT ("practiceId", slug)
      DO UPDATE SET
        "locationId" = EXCLUDED."locationId",
        title = EXCLUDED.title,
        status = 'ACTIVE',
        "updatedAt" = NOW()
      RETURNING id
    `,
    [randomUUID(), practiceId, locationId, office.insuranceTitle, office.ruleSlug],
  );

  const revisionCreated = await ensurePublishedInsuranceRevision(
    client,
    result.rows[0].id,
    rules,
  );

  return {
    revisionCreated,
    slug: office.ruleSlug,
  };
}

function normalizeSeat(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const extension = String(value.extension || "").trim();
  const label = String(value.label || "").trim();

  if (!extension || !label) {
    return null;
  }

  return {
    enabled: value.enabled !== false,
    extension,
    label,
    sipUsername: String(value.sipUsername || "").trim() || null,
    telnyxCredentialId: String(value.telnyxCredentialId || "").trim() || null,
  };
}

async function upsertSeats(client, practiceId, locationId, office, seatConfig) {
  const rawSeats = Array.isArray(seatConfig[office.key]) ? seatConfig[office.key] : [];
  const seats = rawSeats.map(normalizeSeat).filter(Boolean);

  for (const seat of seats) {
    const existing = await client.query(
      `
        SELECT id
        FROM call_center_agent_seat
        WHERE "practiceId" = $1 AND "locationId" = $2 AND extension = $3
        LIMIT 1
      `,
      [practiceId, locationId, seat.extension],
    );
    const existingId = existing.rows[0]?.id;

    if (existingId) {
      await client.query(
        `
          UPDATE call_center_agent_seat
          SET
            label = $2,
            "telnyxCredentialId" = $3,
            "sipUsername" = $4,
            enabled = $5,
            "updatedAt" = NOW()
          WHERE id = $1
        `,
        [existingId, seat.label, seat.telnyxCredentialId, seat.sipUsername, seat.enabled],
      );
      continue;
    }

    await client.query(
      `
        INSERT INTO call_center_agent_seat (
          id,
          "practiceId",
          "locationId",
          label,
          extension,
          "telnyxCredentialId",
          "sipUsername",
          enabled,
          "createdAt",
          "updatedAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      `,
      [
        randomUUID(),
        practiceId,
        locationId,
        seat.label,
        seat.extension,
        seat.telnyxCredentialId,
        seat.sipUsername,
        seat.enabled,
      ],
    );
  }

  return seats.length;
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const seatConfig = parseSeatConfig();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

try {
  const summary = [];
  const practice = await getPractice(pool);
  const client = await pool.connect();

  await client.query("BEGIN");

  try {
    for (const office of officeConfigs) {
      const location = await upsertLocation(client, practice.id, office);
      await upsertPhoneNumbers(client, practice.id, location.id, office);
      const knowledge = await upsertKnowledgeDocument(
        client,
        practice.id,
        location.id,
        office,
      );
      const insurance = await upsertInsuranceRuleSet(
        client,
        practice.id,
        location.id,
        office,
      );
      const seatCount = await upsertSeats(
        client,
        practice.id,
        location.id,
        office,
        seatConfig,
      );

      summary.push({
        insurance,
        knowledge,
        location,
        phones: office.phones.map((phone) => phone.phoneNumber),
        seatsUpserted: seatCount,
      });
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  console.log(
    JSON.stringify(
      {
        practice,
        summary,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
