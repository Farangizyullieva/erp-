import { Injectable } from '@nestjs/common';
import { RequestContextStore } from '../context/request-context';
import type { Tx } from '../db/prisma.service';

export type NotificationPayload =
  | { type: 'student.assigned'; data: { student_id: string; student_name: string; actor_name: string } }
  | { type: 'employee.roles_changed'; data: { actor_name: string; roles: string[] } };

@Injectable()
export class Notifier {
  /**
   * Tizim ichidagi bildirishnoma (qo'ng'iroqcha). Biznes o'zgarishi bilan bitta transaction'da yoziladi;
   * amalni bajargan foydalanuvchining o'ziga yuborilmaydi. SMS/Telegram kanallari keyin outbox orqali ulanadi.
   */
  async notify(tx: Tx, userIds: (string | null | undefined)[], payload: NotificationPayload): Promise<void> {
    const auth = RequestContextStore.auth();
    const recipients = [...new Set(userIds.filter((id): id is string => Boolean(id) && id !== auth.userId))];
    if (!recipients.length) return;
    await tx.notification.createMany({
      data: recipients.map((userId) => ({ tenantId: auth.tenantId, userId, type: payload.type, data: payload.data })),
    });
  }
}
