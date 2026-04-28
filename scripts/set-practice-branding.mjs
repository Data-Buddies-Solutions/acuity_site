import { config } from "dotenv";
import { Pool } from "pg";

config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

const [
  email,
  logoUrl,
  logoAlt = "Practice logo",
  primaryColor = null,
  accentColor = null,
  markUrl = logoUrl,
] = process.argv.slice(2);

if (!email || !logoUrl) {
  console.error(
    "Usage: bun scripts/set-practice-branding.mjs <user-email> <logo-url> [logo-alt] [primary-color] [accent-color] [mark-url]",
  );
  process.exit(1);
}

try {
  new URL(logoUrl);
  if (markUrl) {
    new URL(markUrl);
  }
} catch {
  console.error("Logo URL and mark URL must be valid URLs.");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

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
  await pool.end();
  console.error(`No practice found for ${email}.`);
  process.exit(1);
}

const result = await pool.query(
  `
    UPDATE practice
    SET
      "brandLogoUrl" = $2,
      "brandLogoAlt" = $3,
      "brandMarkUrl" = $4,
      "brandPrimaryColor" = $5,
      "brandAccentColor" = $6,
      "updatedAt" = NOW()
    WHERE id = $1
    RETURNING
      id,
      name,
      "brandLogoUrl",
      "brandLogoAlt",
      "brandMarkUrl",
      "brandPrimaryColor",
      "brandAccentColor"
  `,
  [practice.id, logoUrl, logoAlt, markUrl || null, primaryColor, accentColor],
);

await pool.end();

console.log(JSON.stringify(result.rows[0], null, 2));
