import { defineConfig } from "drizzle-kit";

const isPg = !!process.env.DATABASE_URL;

export default defineConfig(
  isPg
    ? {
        out: "./migrations",
        schema: "./shared/schema.pg.ts",
        dialect: "postgresql",
        dbCredentials: { url: process.env.DATABASE_URL! },
      }
    : {
        out: "./migrations",
        schema: "./shared/schema.ts",
        dialect: "sqlite",
        dbCredentials: {
          url: process.env.DATA_DIR
            ? `${process.env.DATA_DIR}/data.db`
            : "./data.db",
        },
      }
);
