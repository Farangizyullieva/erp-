import { Injectable } from '@nestjs/common';
import type { ChatMessage } from '@prisma/client';
import { RequestContextStore } from '../../common/context/request-context';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { AppError } from '../../common/http/app-error';

const PAGE = 50;
const STAFF = { isActive: true, roles: { some: { role: { code: { notIn: ['student', 'parent'] } } } } };

const messageView = (m: ChatMessage, me: string) => ({
  id: m.id,
  body: m.body,
  mine: m.authorId === me,
  created_at: m.createdAt,
});

@Injectable()
export class InboxService {
  constructor(private readonly db: PrismaService) {}

  /** Topbar belgilari uchun bitta yengil so'rov */
  counters() {
    const me = RequestContextStore.auth().userId;
    return this.db.tx(async (tx) => ({
      notifications: await tx.notification.count({ where: { userId: me, readAt: null } }),
      messages: await this.unreadMessages(tx, me),
    }));
  }

  notifications() {
    const me = RequestContextStore.auth().userId;
    return this.db.tx(async (tx) => {
      const rows = await tx.notification.findMany({ where: { userId: me }, orderBy: { createdAt: 'desc' }, take: 30 });
      return rows.map((n) => ({ id: n.id, type: n.type, data: n.data, read: n.readAt !== null, created_at: n.createdAt }));
    });
  }

  markNotificationsRead(ids?: string[]) {
    const me = RequestContextStore.auth().userId;
    return this.db.tx(async (tx) => {
      // userId sharti: begona bildirishnomani id orqali o'qilgan qilib bo'lmaydi
      await tx.notification.updateMany({ where: { userId: me, readAt: null, id: ids ? { in: ids } : undefined }, data: { readAt: new Date() } });
    });
  }

  listChats() {
    const me = RequestContextStore.auth().userId;
    return this.db.tx(async (tx) => {
      const mine = await tx.chatParticipant.findMany({
        where: { userId: me, chat: { lastMessageAt: { not: null } } },
        include: {
          chat: {
            include: {
              participants: { where: { userId: { not: me } }, include: { user: { select: { id: true, fullName: true, isActive: true } } } },
              messages: { orderBy: { createdAt: 'desc' }, take: 1 },
            },
          },
        },
        orderBy: { chat: { lastMessageAt: 'desc' } },
        take: 100,
      });
      return Promise.all(
        mine.map(async (p) => {
          const peer = p.chat.participants[0]?.user;
          const last = p.chat.messages[0];
          return {
            id: p.chatId,
            peer: peer ? { id: peer.id, full_name: peer.fullName, is_active: peer.isActive } : null,
            last_message: last ? messageView(last, me) : null,
            unread: await tx.chatMessage.count({ where: { chatId: p.chatId, authorId: { not: me }, createdAt: { gt: p.lastReadAt } } }),
          };
        }),
      );
    });
  }

  /** Suhbat mavjud bo'lsa qaytaradi, bo'lmasa yaratadi (bir juftlik — bitta suhbat) */
  openChat(userId: string) {
    const auth = RequestContextStore.auth();
    if (userId === auth.userId) throw AppError.field('user_id', 'INVALID', "O'zingiz bilan suhbat ochib bo'lmaydi");
    const directKey = [auth.userId, userId].sort().join(':');
    return this.db.tx(async (tx) => {
      const peer = await tx.user.findFirst({ where: { id: userId, ...STAFF }, select: { id: true, fullName: true } });
      if (!peer) throw AppError.notFound('Xodim');
      const chat = await tx.chat.upsert({
        where: { tenantId_directKey: { tenantId: auth.tenantId, directKey } },
        update: {},
        create: {
          tenantId: auth.tenantId,
          directKey,
          participants: { create: [auth.userId, userId].map((id) => ({ tenantId: auth.tenantId, userId: id })) },
        },
      });
      return { id: chat.id, peer: { id: peer.id, full_name: peer.fullName, is_active: true } };
    });
  }

  messages(chatId: string, before?: string) {
    const me = RequestContextStore.auth().userId;
    return this.db.tx(async (tx) => {
      await this.assertParticipant(tx, chatId, me);
      const rows = await tx.chatMessage.findMany({
        where: { chatId, createdAt: before ? { lt: new Date(before) } : undefined },
        orderBy: { createdAt: 'desc' },
        take: PAGE + 1,
      });
      return { has_more: rows.length > PAGE, items: rows.slice(0, PAGE).reverse().map((m) => messageView(m, me)) };
    });
  }

  send(chatId: string, body: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      await this.assertParticipant(tx, chatId, auth.userId);
      const now = new Date();
      const message = await tx.chatMessage.create({ data: { tenantId: auth.tenantId, chatId, authorId: auth.userId, body, createdAt: now } });
      await tx.chat.update({ where: { id: chatId }, data: { lastMessageAt: now } });
      await tx.chatParticipant.update({ where: { chatId_userId: { chatId, userId: auth.userId } }, data: { lastReadAt: now } });
      return messageView(message, auth.userId);
    });
  }

  markChatRead(chatId: string) {
    const me = RequestContextStore.auth().userId;
    return this.db.tx(async (tx) => {
      await this.assertParticipant(tx, chatId, me);
      await tx.chatParticipant.update({ where: { chatId_userId: { chatId, userId: me } }, data: { lastReadAt: new Date() } });
    });
  }

  /** Ishtirokchi bo'lmagan foydalanuvchi suhbat mavjudligini ham bilmasligi kerak → 404 */
  private async assertParticipant(tx: Tx, chatId: string, userId: string): Promise<void> {
    const participant = await tx.chatParticipant.findUnique({ where: { chatId_userId: { chatId, userId } }, select: { chatId: true } });
    if (!participant) throw AppError.notFound('Suhbat');
  }

  private async unreadMessages(tx: Tx, me: string): Promise<number> {
    const rows = await tx.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM chat_participants p
      JOIN chat_messages m ON m.chat_id = p.chat_id AND m.author_id <> p.user_id AND m.created_at > p.last_read_at
      WHERE p.user_id = ${me}::uuid`;
    return rows[0]?.count ?? 0;
  }
}
