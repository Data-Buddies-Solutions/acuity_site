import { config } from "dotenv";

config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

const PRACTICE_NAME = "Abita Eye Group";
const SPRING_HILL_LOCATIONS = ["Spring Hill"];
const SOUTH_FLORIDA_LOCATIONS = ["Hollywood", "Sweetwater"];
const SWEETWATER_OPTICAL_LOCATIONS = ["Sweetwater", "North Miami Beach Optical"];

function usage() {
  return `ABITA_PORTAL_USERS_JSON is required.

Example:
ABITA_PORTAL_USERS_JSON='{
  "admin": {
    "email": "admin@abitaeye.com",
    "name": "Abita Eye Group Admin",
    "password": "replace-with-a-long-temporary-password"
  },
  "springHill": [
    { "email": "spring1@abitaeye.com", "name": "Spring Hill 1", "password": "..." },
    { "email": "spring2@abitaeye.com", "name": "Spring Hill 2", "password": "..." },
    { "email": "spring3@abitaeye.com", "name": "Spring Hill 3", "password": "..." }
  ],
  "southFlorida": [
    { "email": "southfl1@abitaeye.com", "name": "South Florida 1", "password": "..." },
    { "email": "southfl2@abitaeye.com", "name": "South Florida 2", "password": "..." },
    { "email": "southfl3@abitaeye.com", "name": "South Florida 3", "password": "..." },
    { "email": "southfl4@abitaeye.com", "name": "South Florida 4", "password": "..." }
  ],
  "callCenter": [
    { "email": "callcenter@abitaeye.com", "name": "Abita South Florida Call Center", "password": "..." }
  ],
  "sweetwaterOpticals": [
    { "email": "sweetwateropticals@abitaeye.com", "name": "Sweetwater Optical Call Center", "password": "..." }
  ]
}' bun scripts/seed-abita-scoped-users.mjs`;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseConfig() {
  const raw = process.env.ABITA_PORTAL_USERS_JSON;

  if (!raw) {
    throw new Error(usage());
  }

  const parsed = JSON.parse(raw);
  const entries = Array.isArray(parsed)
    ? parsed
    : [
        ...asArray(parsed.admin).map((entry) => ({
          ...entry,
          locations: "ALL",
          role: entry.role || "ADMIN",
        })),
        ...asArray(parsed.springHill ?? parsed.spring_hill).map((entry) => ({
          ...entry,
          locations: entry.locations || SPRING_HILL_LOCATIONS,
          role: entry.role || "STAFF",
        })),
        ...asArray(parsed.southFlorida ?? parsed.south_florida).map((entry) => ({
          ...entry,
          locations: entry.locations || SOUTH_FLORIDA_LOCATIONS,
          role: entry.role || "STAFF",
        })),
        ...asArray(parsed.callCenter ?? parsed.call_center).map((entry) => ({
          ...entry,
          locations: entry.locations || SOUTH_FLORIDA_LOCATIONS,
          role: entry.role || "STAFF",
        })),
        ...asArray(parsed.sweetwaterOpticals ?? parsed.sweetwater_opticals).map(
          (entry) => ({
            ...entry,
            locations: entry.locations || SWEETWATER_OPTICAL_LOCATIONS,
            role: entry.role || "STAFF",
          }),
        ),
      ];

  return entries.map((entry, index) => {
    const email = String(entry.email || "")
      .trim()
      .toLowerCase();
    const name = String(entry.name || email || `Abita Portal User ${index + 1}`).trim();
    const password = entry.password ? String(entry.password) : "";
    const role = String(entry.role || "STAFF")
      .trim()
      .toUpperCase();
    const locations =
      entry.locations === "ALL" || entry.locationScope === "ALL"
        ? "ALL"
        : asArray(entry.locations).map((location) => String(location).trim());

    if (!email || !email.includes("@")) {
      throw new Error(`User ${index + 1} is missing a valid email.`);
    }

    if (!["OWNER", "ADMIN", "STAFF"].includes(role)) {
      throw new Error(`${email} has invalid role ${role}.`);
    }

    if (locations !== "ALL" && locations.length === 0) {
      throw new Error(`${email} needs locations or locations: "ALL".`);
    }

    return { email, locations, name, password, role };
  });
}

async function ensureUser({ auth, email, name, password, prisma }) {
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    const updatedUser =
      existingUser.name === name
        ? existingUser
        : await prisma.user.update({
            data: { name },
            where: { id: existingUser.id },
          });

    return { created: false, user: updatedUser };
  }

  if (!password || password.length < 8) {
    throw new Error(`${email} is new and needs a password with at least 8 characters.`);
  }

  await auth.api.signUpEmail({
    body: {
      email,
      name,
      password,
    },
    headers: new Headers({
      host: new URL(process.env.BETTER_AUTH_URL || "http://localhost:3000").host,
    }),
  });

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new Error(`Better Auth did not create ${email}.`);
  }

  return { created: true, user };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  process.env.PORTAL_ALLOW_SIGNUP = "true";

  const entries = parseConfig();
  const { auth } = await import("../lib/auth.ts");
  const { prisma } = await import("../lib/prisma.ts");
  const practice = await prisma.practice.findFirst({
    include: {
      locations: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    where: {
      name: PRACTICE_NAME,
    },
  });

  if (!practice) {
    throw new Error(`No practice found named ${PRACTICE_NAME}.`);
  }

  const locationsByName = new Map(
    practice.locations.map((location) => [location.name.toLowerCase(), location]),
  );
  const results = [];

  for (const entry of entries) {
    const { created, user } = await ensureUser({ auth, prisma, ...entry });
    const locationScope = entry.locations === "ALL" ? "ALL" : "SELECTED";
    const selectedLocations =
      entry.locations === "ALL"
        ? []
        : entry.locations.map((locationName) => {
            const location = locationsByName.get(locationName.toLowerCase());

            if (!location) {
              throw new Error(
                `${entry.email} references unknown Abita location ${locationName}.`,
              );
            }

            return location;
          });

    await prisma.$transaction(async (tx) => {
      await tx.practiceMembership.updateMany({
        data: {
          isPrimary: false,
        },
        where: {
          userId: user.id,
        },
      });

      const membership = await tx.practiceMembership.upsert({
        create: {
          isPrimary: true,
          locationScope,
          practiceId: practice.id,
          role: entry.role,
          userId: user.id,
        },
        update: {
          isPrimary: true,
          locationScope,
          role: entry.role,
        },
        where: {
          practiceId_userId: {
            practiceId: practice.id,
            userId: user.id,
          },
        },
      });

      await tx.practiceMembershipLocation.deleteMany({
        where: {
          membershipId: membership.id,
        },
      });

      if (selectedLocations.length) {
        await tx.practiceMembershipLocation.createMany({
          data: selectedLocations.map((location) => ({
            locationId: location.id,
            membershipId: membership.id,
          })),
          skipDuplicates: true,
        });
      }
    });

    results.push({
      created,
      email: entry.email,
      locations:
        entry.locations === "ALL"
          ? "ALL"
          : selectedLocations.map((location) => location.name),
      role: entry.role,
    });
  }

  await prisma.$disconnect();

  console.log(JSON.stringify({ practice: practice.name, users: results }, null, 2));
  console.log(
    "Existing users keep their current passwords; new users use the supplied password.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
