import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { hashSync } from "bcryptjs";
import type { User, Conversation, Message, Media } from "@/lib/shared/types";

let db: Database.Database | undefined;
export const database = (): Database.Database => {
  if (db) return db;
  const path = resolve(process.env.DATABASE_PATH ?? "./data/chat.db");
  mkdirSync(dirname(path), { recursive: true });
  const opened = new Database(path);
  opened.pragma("journal_mode = WAL");
  opened.pragma("foreign_keys = ON");
  opened.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, initials TEXT NOT NULL, color TEXT NOT NULL, passwordHash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), expiresAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS members (conversationId TEXT NOT NULL REFERENCES conversations(id), userId TEXT NOT NULL REFERENCES users(id), PRIMARY KEY (conversationId, userId));
    CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES users(id), url TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('image','video')), name TEXT NOT NULL, usedAt TEXT);
    CREATE TABLE IF NOT EXISTS messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
      conversationId TEXT NOT NULL REFERENCES conversations(id), senderId TEXT NOT NULL REFERENCES users(id),
      body TEXT NOT NULL, mediaId TEXT REFERENCES uploads(id), mediaAltText TEXT, forwardedFromId TEXT,
      clientNonce TEXT NOT NULL, createdAt TEXT NOT NULL,
      UNIQUE(senderId, clientNonce)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_seq ON messages(conversationId, seq);
    CREATE INDEX IF NOT EXISTS idx_members_user ON members(userId);
  `);
  if (
    (opened.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number })
      .n === 0
  ) {
    const accounts = [
      {
        id: "ada",
        name: "Ada Lovelace",
        initials: "AL",
        color: "#8875f6",
        pw: "ALICE_PASSWORD",
      },
      {
        id: "grace",
        name: "Grace Hopper",
        initials: "GH",
        color: "#eb9f6c",
        pw: "BOB_PASSWORD",
      },
      {
        id: "linus",
        name: "Linus Torvalds",
        initials: "LT",
        color: "#68baaa",
        pw: "CHARLIE_PASSWORD",
      },
    ];
    // No default password. Deployment owners must explicitly set initial credentials.
    for (const a of accounts)
      if (!process.env[a.pw])
        throw new Error(`Set ${a.pw} in .env.local before first run`);
    opened.transaction(() => {
      for (const a of accounts)
        opened
          .prepare("INSERT INTO users VALUES(?,?,?,?,?)")
          .run(
            a.id,
            a.name,
            a.initials,
            a.color,
            hashSync(process.env[a.pw]!, 12)
          );
      for (const [first, second] of [
        ["ada", "grace"],
        ["ada", "linus"],
        ["grace", "linus"],
      ]) {
        const id = randomUUID();
        opened
          .prepare("INSERT INTO conversations VALUES(?,?)")
          .run(id, new Date().toISOString());
        opened.prepare("INSERT INTO members VALUES(?,?)").run(id, first);
        opened.prepare("INSERT INTO members VALUES(?,?)").run(id, second);
      }
    })();
  }
  db = opened;
  return opened;
};

export function publicUser(userId: string): User | null {
  return (
    (database()
      .prepare("SELECT id, name, initials, color FROM users WHERE id = ?")
      .get(userId) as User | undefined) ?? null
  );
}
export function getLoginUser(
  name: string
): ({ passwordHash: string } & User) | undefined {
  return database().prepare("SELECT * FROM users WHERE name = ?").get(name) as
    | ({ passwordHash: string } & User)
    | undefined;
}
export function isMember(userId: string, conversationId: string): boolean {
  return !!database()
    .prepare("SELECT 1 FROM members WHERE userId=? AND conversationId=?")
    .get(userId, conversationId);
}
export function memberConversationIds(userId: string): string[] {
  return (
    database()
      .prepare("SELECT conversationId FROM members WHERE userId=?")
      .all(userId) as { conversationId: string }[]
  ).map((v) => v.conversationId);
}
export function getConversations(userId: string): Conversation[] {
  const rows = database()
    .prepare(
      `SELECT c.id, u.id AS otherId, u.name AS otherName, u.initials, u.color,
    (SELECT CASE WHEN m.body <> '' THEN m.body ELSE 'Attachment' END FROM messages m WHERE m.conversationId=c.id ORDER BY m.seq DESC LIMIT 1) lastMessage,
    (SELECT m.createdAt FROM messages m WHERE m.conversationId=c.id ORDER BY m.seq DESC LIMIT 1) lastAt
    FROM conversations c JOIN members me ON me.conversationId=c.id AND me.userId=?
    JOIN members other ON other.conversationId=c.id AND other.userId<>?
    JOIN users u ON u.id=other.userId ORDER BY COALESCE(lastAt,'') DESC, otherName`
    )
    .all(userId, userId) as {
    id: string;
    otherId: string;
    otherName: string;
    initials: string;
    color: string;
    lastMessage: string | null;
    lastAt: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    title: r.otherName,
    otherUser: {
      id: r.otherId,
      name: r.otherName,
      initials: r.initials,
      color: r.color,
    },
    lastMessage: r.lastMessage,
    lastAt: r.lastAt,
  }));
}

type MessageRow = {
  id: string;
  seq: number;
  conversationId: string;
  senderId: string;
  body: string;
  mediaId: string | null;
  url: string | null;
  kind: "image" | "video" | null;
  name: string | null;
  mediaAltText: string | null;
  forwardedFromId: string | null;
  clientNonce: string | null;
  createdAt: string;
};
const SELECT_MESSAGE = `SELECT m.*, u.url, u.kind, u.name FROM messages m LEFT JOIN uploads u ON u.id=m.mediaId`;
function fromRow(row: MessageRow): Message {
  const media: Media | null =
    row.mediaId && row.url && row.kind && row.name
      ? {
          id: row.mediaId,
          url: row.url,
          kind: row.kind,
          name: row.name,
          altText: row.mediaAltText ?? undefined,
        }
      : null;
  return {
    id: row.id,
    seq: row.seq,
    conversationId: row.conversationId,
    senderId: row.senderId,
    body: row.body,
    media,
    forwardedFromId: row.forwardedFromId,
    clientNonce: row.clientNonce,
    createdAt: row.createdAt,
  };
}
export function getMessage(id: string): Message | null {
  const row = database().prepare(`${SELECT_MESSAGE} WHERE m.id=?`).get(id) as
    | MessageRow
    | undefined;
  return row ? fromRow(row) : null;
}
export function getConversationMessages(
  conversationId: string,
  after: number | null = null,
  limit = 50
): Message[] {
  const sql =
    after === null
      ? `${SELECT_MESSAGE} WHERE m.conversationId=? ORDER BY m.seq DESC LIMIT ?`
      : `${SELECT_MESSAGE} WHERE m.conversationId=? AND m.seq>? ORDER BY m.seq ASC LIMIT ?`;
  const rows = (
    after === null
      ? database().prepare(sql).all(conversationId, limit)
      : database().prepare(sql).all(conversationId, after, limit)
  ) as MessageRow[];
  return (after === null ? rows.reverse() : rows).map(fromRow);
}
