import { db, type SiteDb } from "../db";
import { getDefaultContentFolder } from "../site-config";
import { conversations, conversationMessages, aiKnowledge } from "@shared/schema";
import type { InsertConversation, InsertConversationMessage, Conversation, ConversationMessage } from "@shared/schema";
import { eq, desc, and, gte, lte, like, sql, type SQL } from "drizzle-orm";
import { siteConversationsGcsKey } from "@shared/gcsKeys";
import { gcs } from "../gcs";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { child } from "../logger";
const log = child({ module: "ai/ConversationStore" });



export class ConversationStore {
  private readonly db: SiteDb;
  private readonly contentFolderName: string;

  constructor(siteDb: SiteDb = db, contentFolderName: string = "default") {
    this.db = siteDb;
    this.contentFolderName = contentFolderName;
  }

  async createConversation(data: InsertConversation): Promise<Conversation> {
    const [conv] = await this.db
      .insert(conversations)
      .values(data as typeof conversations.$inferInsert)
      .returning();
    return conv;
  }

  async addMessage(data: InsertConversationMessage): Promise<ConversationMessage> {
    const [msg] = await this.db.insert(conversationMessages).values(data).returning();
    return msg;
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const [conv] = await this.db.select().from(conversations).where(eq(conversations.id, id));
    return conv || null;
  }

  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    return this.db.select().from(conversationMessages)
      .where(eq(conversationMessages.conversation_id, conversationId))
      .orderBy(conversationMessages.created_at);
  }

  async rateMessage(
    messageId: string,
    rating: "good" | "bad",
    ratedBy: string
  ): Promise<ConversationMessage | null> {
    const [msg] = await this.db.update(conversationMessages)
      .set({
        rating,
        rated_by: ratedBy,
        rated_at: new Date(),
      })
      .where(eq(conversationMessages.id, messageId))
      .returning();
    return msg || null;
  }

  async overrideMessage(
    messageId: string,
    overrideContent: string,
    overrideBy: string
  ): Promise<ConversationMessage | null> {
    const [msg] = await this.db.update(conversationMessages)
      .set({
        override_content: overrideContent,
        override_by: overrideBy,
        override_at: new Date(),
      })
      .where(eq(conversationMessages.id, messageId))
      .returning();
    return msg || null;
  }

  async listConversations(filters: {
    page?: number;
    limit?: number;
    dateFrom?: string;
    dateTo?: string;
    pageUrl?: string;
    featureTag?: string;
    questionTag?: string;
    rating?: string;
    contentRoot?: string;
  }): Promise<{ conversations: (Conversation & { messages: ConversationMessage[] })[]; total: number }> {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [];

    if (filters.dateFrom) {
      conditions.push(gte(conversations.started_at, new Date(filters.dateFrom)));
    }
    if (filters.dateTo) {
      conditions.push(lte(conversations.started_at, new Date(filters.dateTo)));
    }
    if (filters.pageUrl) {
      conditions.push(like(conversations.page_url, `%${filters.pageUrl}%`));
    }
    if (filters.featureTag) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM json_each(${conversations.feature_tags}) WHERE value = ${filters.featureTag})`
      );
    }
    if (filters.questionTag) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${conversationMessages} WHERE ${conversationMessages.conversation_id} = ${conversations.id} AND ${conversationMessages.question_tag} = ${filters.questionTag})`
      );
    }
    if (filters.rating) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${conversationMessages} WHERE ${conversationMessages.conversation_id} = ${conversations.id} AND ${conversationMessages.rating} = ${filters.rating})`
      );
    }

    let graceMinutes = 15;
    const contentRoot = filters.contentRoot || getDefaultContentFolder();
    try {
      const llmPath = path.resolve(`${contentRoot}/llm.yml`);
      if (fs.existsSync(llmPath)) {
        const raw = yaml.load(fs.readFileSync(llmPath, "utf-8")) as Record<string, unknown>;
        if (raw && typeof raw.empty_conversation_grace_minutes === "number") {
          graceMinutes = raw.empty_conversation_grace_minutes;
        }
      }
    } catch (err) {
      log.warn(
        { err },
        "[ConversationStore] Failed to read empty_conversation_grace_minutes from llm.yml, using default",
      );
    }
    const cutoffEpochSec = Math.floor((Date.now() - graceMinutes * 60 * 1000) / 1000);
    conditions.push(
      sql`NOT (
        (SELECT count(*) FROM ${conversationMessages} WHERE ${conversationMessages.conversation_id} = ${conversations.id}) = 0
        AND ${conversations.started_at} < ${cutoffEpochSec}
      )`
    );

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await this.db.select({ count: sql<number>`count(*)` })
      .from(conversations)
      .where(whereClause);

    const convList = await this.db.select().from(conversations)
      .where(whereClause)
      .orderBy(desc(conversations.started_at))
      .limit(limit)
      .offset(offset);

    const result: (Conversation & { messages: ConversationMessage[] })[] = [];

    for (const conv of convList) {
      const msgs = await this.getMessages(conv.id);
      result.push({ ...conv, messages: msgs });
    }

    return {
      conversations: result,
      total: Number(countResult?.count || 0),
    };
  }

  async getRecentUserMessages(limit: number = 100): Promise<{ content: string; question_tag: string | null; conversation_id: string }[]> {
    const msgs = await this.db.select({
      content: conversationMessages.content,
      question_tag: conversationMessages.question_tag,
      conversation_id: conversationMessages.conversation_id,
    })
      .from(conversationMessages)
      .where(eq(conversationMessages.role, "user"))
      .orderBy(desc(conversationMessages.created_at))
      .limit(limit);
    return msgs;
  }

  async saveContextSnapshot(conversationId: string, context: Record<string, unknown>): Promise<void> {
    if (!gcs.available) return;
    try {
      const key = siteConversationsGcsKey(this.contentFolderName, conversationId);
      await gcs.upload(key, Buffer.from(JSON.stringify(context, null, 2)), "application/json");
    } catch (err) {
      log.error({ err: err }, "[ConversationStore] Failed to save context snapshot:");
    }
  }

  async getKnowledge(key: string): Promise<unknown | null> {
    const [row] = await this.db.select().from(aiKnowledge).where(eq(aiKnowledge.key, key));
    return row?.value || null;
  }

  async setKnowledge(key: string, value: unknown, updatedBy?: string): Promise<void> {
    const existing = await this.db.select().from(aiKnowledge).where(eq(aiKnowledge.key, key));
    if (existing.length > 0) {
      await this.db.update(aiKnowledge)
        .set({ value, updated_at: new Date(), updated_by: updatedBy })
        .where(eq(aiKnowledge.key, key));
    } else {
      await this.db.insert(aiKnowledge).values({ key, value, updated_by: updatedBy });
    }
  }

  async getAllKnowledge(): Promise<Record<string, unknown>> {
    const rows = await this.db.select().from(aiKnowledge);
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }
}

export const conversationStore = new ConversationStore(db, "default");
