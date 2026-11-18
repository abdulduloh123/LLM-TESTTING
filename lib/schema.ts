import { pgTable, text, boolean, timestamp, integer, jsonb, uuid, index } from "drizzle-orm/pg-core";

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const providers = pgTable("providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(), // openai | anthropic | google | openai-compatible
  preset: text("preset").notNull(), // openrouter, groq, custom, ...
  name: text("name").notNull(),
  baseUrl: text("base_url"),
  keyEnc: text("key_enc").notNull(),
  keyLast4: text("key_last4").notNull(),
  status: text("status").notNull().default("unknown"), // ok | error | unknown
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const models = pgTable(
  "models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: uuid("provider_id").notNull().references(() => providers.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    label: text("label").notNull(),
    favorite: boolean("favorite").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
  },
  (t) => [index("models_provider_idx").on(t.providerId)],
);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull().default("Percakapan baru"),
  pinned: boolean("pinned").notNull().default(false),
  providerId: uuid("provider_id"),
  modelId: text("model_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    role: text("role").notNull(),
    parts: jsonb("parts").notNull(),
    text: text("text").notNull().default(""),
    model: text("model"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("messages_conv_idx").on(t.conversationId, t.position)],
);

export const loginAttempts = pgTable("login_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  ip: text("ip").notNull(),
  at: timestamp("at").notNull().defaultNow(),
});
