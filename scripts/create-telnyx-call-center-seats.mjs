import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { Pool } from "pg";

config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

const [email, locationName, tag = "acuity-call-center"] = process.argv.slice(2);

const DEFAULT_SEATS = [
  { extension: "101", label: "Emma" },
  { extension: "102", label: "Sherry" },
  { extension: "103", label: "Debbie" },
  { extension: "104", label: "Front Desk" },
];

if (!email || !locationName) {
  console.error(
    "Usage: bun scripts/create-telnyx-call-center-seats.mjs <user-email> <location-name> [credential-tag]",
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

if (!process.env.TELNYX_API_KEY) {
  console.error("TELNYX_API_KEY is required.");
  process.exit(1);
}

async function createTelnyxCredential({ connectionId, name }) {
  const response = await fetch("https://api.telnyx.com/v2/telephony_credentials", {
    body: JSON.stringify({
      connection_id: connectionId,
      name,
      tag,
    }),
    headers: {
      Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to create Telnyx credential ${name}: ${response.status} ${body}`,
    );
  }

  const body = await response.json();
  const credential = body?.data;

  if (!credential?.id || !credential?.sip_username) {
    throw new Error(
      `Telnyx credential response for ${name} was missing id or sip_username.`,
    );
  }

  return {
    id: credential.id,
    sipUsername: credential.sip_username,
  };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

try {
  const membership = await pool.query(
    `
      SELECT p.id, p.name
      FROM practice_membership pm
      JOIN "user" u ON u.id = pm."userId"
      JOIN practice p ON p.id = pm."practiceId"
      WHERE u.email = $1
      ORDER BY pm."isPrimary" DESC, pm."createdAt" ASC
      LIMIT 1
    `,
    [email],
  );
  const practice = membership.rows[0];

  if (!practice) {
    console.error(`No practice found for ${email}.`);
    process.exit(1);
  }

  const locationResult = await pool.query(
    `
      SELECT id, name
      FROM practice_location
      WHERE "practiceId" = $1 AND LOWER(name) = LOWER($2)
      LIMIT 1
    `,
    [practice.id, locationName],
  );
  const location = locationResult.rows[0];

  if (!location) {
    console.error(`No location named "${locationName}" found for ${practice.name}.`);
    process.exit(1);
  }

  const settingsResult = await pool.query(
    `
      SELECT "telnyxConnectionId"
      FROM practice_call_center_settings
      WHERE "practiceId" = $1 AND enabled = true
      LIMIT 1
    `,
    [practice.id],
  );
  const connectionId = settingsResult.rows[0]?.telnyxConnectionId;

  if (!connectionId) {
    console.error(
      `Enabled call-center settings for ${practice.name} are missing telnyxConnectionId.`,
    );
    process.exit(1);
  }

  const configuredSeats = [];

  for (const seat of DEFAULT_SEATS) {
    const existing = await pool.query(
      `
        SELECT id, "telnyxCredentialId", "sipUsername"
        FROM call_center_agent_seat
        WHERE "practiceId" = $1 AND "locationId" = $2 AND extension = $3
        LIMIT 1
      `,
      [practice.id, location.id, seat.extension],
    );
    let credentialId = existing.rows[0]?.telnyxCredentialId || null;
    let sipUsername = existing.rows[0]?.sipUsername || null;

    if (!credentialId || !sipUsername) {
      const credential = await createTelnyxCredential({
        connectionId,
        name: `${practice.name} ${location.name} ${seat.label}`,
      });
      credentialId = credential.id;
      sipUsername = credential.sipUsername;
    }

    const result = existing.rows[0]
      ? await pool.query(
          `
            UPDATE call_center_agent_seat
            SET
              label = $2,
              "telnyxCredentialId" = $3,
              "sipUsername" = $4,
              enabled = true,
              "updatedAt" = NOW()
            WHERE id = $1
            RETURNING id, label, extension, "telnyxCredentialId", "sipUsername", enabled
          `,
          [existing.rows[0].id, seat.label, credentialId, sipUsername],
        )
      : await pool.query(
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
            VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW())
            RETURNING id, label, extension, "telnyxCredentialId", "sipUsername", enabled
          `,
          [
            randomUUID(),
            practice.id,
            location.id,
            seat.label,
            seat.extension,
            credentialId,
            sipUsername,
          ],
        );

    configuredSeats.push(result.rows[0]);
  }

  console.log(
    JSON.stringify(
      {
        location: location.name,
        practice: practice.name,
        seats: configuredSeats,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
