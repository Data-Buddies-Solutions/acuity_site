import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

const [
  email,
  locationName,
  label,
  extension,
  telnyxCredentialId,
  sipUsername,
  enabledInput = "true",
] = process.argv.slice(2);

if (
  !email ||
  !locationName ||
  !label ||
  !extension ||
  !telnyxCredentialId ||
  !sipUsername
) {
  console.error(
    "Usage: bun scripts/upsert-call-center-seat.mjs <user-email> <location-name> <seat-label> <extension> <telnyx-credential-id> <sip-username> [enabled]",
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const enabled = !["false", "0", "no", "off"].includes(enabledInput.toLowerCase());
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

  const existing = await pool.query(
    `
      SELECT id
      FROM call_center_agent_seat
      WHERE
        "practiceId" = $1
        AND "locationId" = $2
        AND extension = $3
      LIMIT 1
    `,
    [practice.id, location.id, extension],
  );

  const result = existing.rows[0]
    ? await pool.query(
        `
          UPDATE call_center_agent_seat
          SET
            label = $2,
            "telnyxCredentialId" = $3,
            "sipUsername" = $4,
            enabled = $5,
            "updatedAt" = NOW()
          WHERE id = $1
          RETURNING id, label, extension, "telnyxCredentialId", "sipUsername", enabled
        `,
        [existing.rows[0].id, label, telnyxCredentialId, sipUsername, enabled],
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
          VALUES (
            $8,
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            NOW(),
            NOW()
          )
          RETURNING id, label, extension, "telnyxCredentialId", "sipUsername", enabled
        `,
        [
          practice.id,
          location.id,
          label,
          extension,
          telnyxCredentialId,
          sipUsername,
          enabled,
          randomUUID(),
        ],
      );

  console.log(
    JSON.stringify(
      {
        location: location.name,
        practice: practice.name,
        seat: result.rows[0],
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
