import { INestApplication } from '@nestjs/common';
import { api, createApp, createTenant, Fixture, nextPhone, owner, tokenFor } from './helpers';

describe('notifications and internal chat (e2e)', () => {
  let app: INestApplication;
  let fx: Fixture;
  let other: Fixture;
  let ownerToken: string;
  let salesToken: string;
  let teacherToken: string;

  beforeAll(async () => {
    app = await createApp();
    [fx, other] = await Promise.all([createTenant(), createTenant()]);
    [ownerToken, salesToken, teacherToken] = await Promise.all([tokenFor(app, fx, 'owner'), tokenFor(app, fx, 'sales'), tokenFor(app, fx, 'teacher')]);
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  it('notifies the new owner of a student, but not the actor', async () => {
    const created = await api(app, ownerToken).post('/students', {
      full_name: 'Notif Test',
      branch_id: fx.branches.a,
      phone: nextPhone(),
      owner_id: fx.users.sales.id,
    });
    expect(created.status).toBe(201);
    // O'zini mas'ul qilgan foydalanuvchiga bildirishnoma kelmaydi
    await api(app, ownerToken).post('/students', { full_name: 'Self Owned', branch_id: fx.branches.a, owner_id: fx.users.owner.id });

    expect((await api(app, salesToken).get('/inbox/counters')).body.data).toEqual({ notifications: 1, messages: 0 });
    expect((await api(app, ownerToken).get('/inbox/counters')).body.data.notifications).toBe(0);

    const list = (await api(app, salesToken).get('/notifications')).body.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      type: 'student.assigned',
      read: false,
      data: { student_id: created.body.data.id, student_name: 'Notif Test', actor_name: 'Owner' },
    });

    // Boshqa foydalanuvchi begona bildirishnomani o'qilgan qila olmaydi
    await api(app, teacherToken).post('/notifications/read', { ids: [list[0].id] });
    expect((await api(app, salesToken).get('/inbox/counters')).body.data.notifications).toBe(1);

    // Mas'ul almashganda yangi mas'ulga xabar boradi
    await api(app, ownerToken).patch(`/students/${created.body.data.id}`, { owner_id: fx.users.managerA.id });
    expect((await api(app, await tokenFor(app, fx, 'managerA')).get('/inbox/counters')).body.data.notifications).toBe(1);

    expect((await api(app, salesToken).post('/notifications/read', {})).status).toBe(204);
    expect((await api(app, salesToken).get('/inbox/counters')).body.data.notifications).toBe(0);
    expect((await api(app, salesToken).get('/notifications')).body.data[0].read).toBe(true);
  });

  it('runs a direct chat with unread counters', async () => {
    const opened = await api(app, ownerToken).post('/chats', { user_id: fx.users.sales.id });
    expect(opened.status).toBe(200);
    const chatId = opened.body.data.id as string;
    expect(opened.body.data.peer.full_name).toBe('Sales');
    // Qarama-qarshi tomondan ochilganda ham o'sha suhbat
    expect((await api(app, salesToken).post('/chats', { user_id: fx.users.owner.id })).body.data.id).toBe(chatId);
    // Xabarsiz suhbat ro'yxatda ko'rinmaydi
    expect((await api(app, salesToken).get('/chats')).body.data).toEqual([]);

    expect((await api(app, ownerToken).post(`/chats/${chatId}/messages`, { body: '  Salom!  ' })).body.data).toMatchObject({ body: 'Salom!', mine: true });
    await api(app, ownerToken).post(`/chats/${chatId}/messages`, { body: 'Bugun majlis 15:00 da' });
    expect((await api(app, ownerToken).post(`/chats/${chatId}/messages`, { body: '   ' })).status).toBe(400);

    expect((await api(app, salesToken).get('/inbox/counters')).body.data.messages).toBe(2);
    expect((await api(app, ownerToken).get('/inbox/counters')).body.data.messages).toBe(0);
    const chats = (await api(app, salesToken).get('/chats')).body.data;
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ unread: 2, peer: { full_name: 'Owner' }, last_message: { body: 'Bugun majlis 15:00 da', mine: false } });

    const thread = (await api(app, salesToken).get(`/chats/${chatId}/messages`)).body.data;
    expect(thread.items.map((m: { body: string }) => m.body)).toEqual(['Salom!', 'Bugun majlis 15:00 da']);
    expect(thread.has_more).toBe(false);

    expect((await api(app, salesToken).post(`/chats/${chatId}/read`)).status).toBe(204);
    expect((await api(app, salesToken).get('/inbox/counters')).body.data.messages).toBe(0);
    await api(app, salesToken).post(`/chats/${chatId}/messages`, { body: 'Xo\'p' });
    expect((await api(app, ownerToken).get('/chats')).body.data[0].unread).toBe(1);
  });

  it('keeps chats private to their participants and tenants', async () => {
    const chatId = (await api(app, ownerToken).post('/chats', { user_id: fx.users.sales.id })).body.data.id as string;
    expect((await api(app, teacherToken).get(`/chats/${chatId}/messages`)).status).toBe(404);
    expect((await api(app, teacherToken).post(`/chats/${chatId}/messages`, { body: 'hi' })).status).toBe(404);
    expect((await api(app, teacherToken).post(`/chats/${chatId}/read`)).status).toBe(404);
    expect((await api(app, teacherToken).get('/chats')).body.data).toEqual([]);

    const otherToken = await tokenFor(app, other, 'owner');
    expect((await api(app, otherToken).get(`/chats/${chatId}/messages`)).status).toBe(404);
    expect((await api(app, otherToken).post('/chats', { user_id: fx.users.sales.id })).status).toBe(404);
    expect((await api(app, ownerToken).post('/chats', { user_id: fx.users.owner.id })).status).toBe(400);
  });
});
