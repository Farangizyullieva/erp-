'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, MessagesSquare, SendHorizontal } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useToast } from '@/components/toast';
import { Avatar, EmptyState, ErrorNote, IconButton, PageHeader, Panel, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';

interface Message {
  id: string;
  body: string;
  mine: boolean;
  created_at: string;
}

interface Chat {
  id: string;
  peer: { id: string; full_name: string; is_active: boolean } | null;
  last_message: Message | null;
  unread: number;
}

const time = (iso: string): string => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const dayOf = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function ChatsPage() {
  return (
    <Suspense>
      <Chats />
    </Suspense>
  );
}

// Xodimlar orasidagi ichki chat (TZ M8.5). Yangilanish — qisqa polling; real-time (WebSocket) kommunikatsiya bosqichida.
function Chats() {
  const { me } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const activeId = params.get('c');
  const select = (id: string | null) => router.replace(id ? `${pathname}?c=${id}` : pathname, { scroll: false });

  const chats = useQuery({ queryKey: ['inbox', 'chats'], queryFn: () => api<Chat[]>('/chats'), refetchInterval: 10_000 });
  const people = useQuery({ queryKey: ['employees', 'options'], queryFn: () => api<{ id: string; full_name: string }[]>('/employees/options') });
  // Yangi ochilgan, hali xabarsiz suhbat ro'yxatda yo'q — sarlavha uchun alohida saqlanadi
  const [opened, setOpened] = useState<Chat | null>(null);
  const active = chats.data?.find((c) => c.id === activeId) ?? (opened?.id === activeId ? opened : null);

  const open = useMutation({
    mutationFn: (userId: string) => api<{ id: string; peer: Chat['peer'] }>('/chats', { method: 'POST', body: { user_id: userId } }),
    onSuccess: (chat) => {
      setOpened({ ...chat, last_message: null, unread: 0 });
      select(chat.id);
    },
    onError: (e) => toast.error(e.message),
  });
  const others = (people.data ?? []).filter((p) => p.id !== me.id);

  return (
    <>
      <PageHeader title={t("Chatlar")} description={t("Hamkasblar bilan ichki yozishmalar")} />
      <Panel className="grid h-[calc(100dvh-14.5rem)] min-h-[26rem] overflow-hidden md:grid-cols-[20rem_minmax(0,1fr)]">
        <div className={clsx('flex min-h-0 flex-col border-line md:border-r', activeId && 'hidden md:flex')}>
          <div className="border-b border-line p-3">
            <Select
              aria-label={t('Yangi suhbat')}
              value=""
              onChange={(e) => e.target.value && open.mutate(e.target.value)}
              disabled={others.length === 0 || open.isPending}
              className="w-full"
            >
              <option value="">{others.length === 0 ? t("Boshqa xodim yo'q") : t('+ Yangi suhbat boshlash…')}</option>
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {chats.isPending ? (
              <div className="space-y-2 p-3" role="status">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-14 animate-pulse rounded-lg bg-canvas" />
                ))}
              </div>
            ) : chats.isError ? (
              <div className="p-3">
                <ErrorNote onRetry={() => void chats.refetch()}>{chats.error.message}</ErrorNote>
              </div>
            ) : chats.data.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-muted">{t("Hali suhbat yo'q. Yuqoridan hamkasbingizni tanlab, birinchi xabarni yozing.")}</p>
            ) : (
              <ul>
                {chats.data.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => select(c.id)}
                      aria-current={c.id === activeId || undefined}
                      className={clsx('flex w-full items-center gap-3 px-3 py-2.5 text-left', c.id === activeId ? 'bg-brand-soft' : 'hover:bg-canvas/70')}
                    >
                      <Avatar name={c.peer?.full_name ?? '?'} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={clsx('truncate text-sm', c.unread ? 'font-semibold' : 'font-medium')}>{c.peer?.full_name ?? '—'}</span>
                          {c.last_message && <span className="shrink-0 text-[11px] tabular-nums text-muted">{time(c.last_message.created_at)}</span>}
                        </span>
                        <span className="flex items-center justify-between gap-2">
                          <span className={clsx('truncate text-[13px]', c.unread ? 'text-ink' : 'text-muted')}>
                            {c.last_message?.mine && `${t('Siz')}: `}
                            {c.last_message?.body}
                          </span>
                          {c.unread > 0 && (
                            <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">{c.unread}</span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className={clsx('min-h-0 flex-col', activeId ? 'flex' : 'hidden md:flex')}>
          {activeId && active ? (
            <Thread key={activeId} chat={active} onBack={() => select(null)} />
          ) : (
            <div className="grid flex-1 place-items-center">
              <EmptyState icon={MessagesSquare} title={t("Suhbatni tanlang")} hint={t("Chapdan suhbatni tanlang yoki yangisini boshlang.")} />
            </div>
          )}
        </div>
      </Panel>
    </>
  );
}

function Thread({ chat, onBack }: { chat: Chat; onBack: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const messages = useQuery({
    queryKey: ['inbox', 'chat', chat.id],
    queryFn: () => api<{ items: Message[]; has_more: boolean }>(`/chats/${chat.id}/messages`),
    refetchInterval: 4000,
  });
  const items = messages.data?.items ?? [];
  const lastId = items.at(-1)?.id;
  const lastIncoming = items.findLast((m) => !m.mine)?.id;

  // Yangi brauzerlarda scrollIntoView Promise qaytaradi — effect undan hech narsa qaytarmasligi kerak
  useLayoutEffect(() => {
    void bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [lastId]);
  // Suhbat ochiq turganda kelgan xabar darhol o'qilgan hisoblanadi
  useEffect(() => {
    if (!lastIncoming) return;
    void api<void>(`/chats/${chat.id}/read`, { method: 'POST' }).then(() => queryClient.invalidateQueries({ queryKey: ['inbox', 'counters'] }));
  }, [lastIncoming, chat.id, queryClient]);

  const send = useMutation({
    mutationFn: (body: string) => api<Message>(`/chats/${chat.id}/messages`, { method: 'POST', body: { body } }),
    onSuccess: async () => {
      setText('');
      await queryClient.invalidateQueries({ queryKey: ['inbox'] });
    },
    onError: (e) => toast.error(e.message),
  });
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (text.trim() && !send.isPending) send.mutate(text.trim());
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <IconButton label={t("Orqaga")} icon={ArrowLeft} onClick={onBack} className="md:hidden" />
        <Avatar name={chat.peer?.full_name ?? '?'} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{chat.peer?.full_name ?? '—'}</p>
          {chat.peer && !chat.peer.is_active && <p className="text-xs text-muted">{t('Xodim faol emas')}</p>}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas/50 px-4 py-4" aria-live="polite">
        {messages.isPending ? (
          <p className="py-8 text-center text-[13px] text-muted" role="status">
            {t('Yuklanmoqda…')}
          </p>
        ) : messages.isError ? (
          <ErrorNote onRetry={() => void messages.refetch()}>{messages.error.message}</ErrorNote>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-muted">{t("Hali xabar yo'q. Birinchi bo'lib yozing.")}</p>
        ) : (
          <ol className="space-y-1.5">
            {items.map((m, i) => {
              const newDay = dayOf(m.created_at) !== (items[i - 1] ? dayOf((items[i - 1] as Message).created_at) : null);
              return (
                <li key={m.id}>
                  {newDay && (
                    <p className="my-3 text-center text-[11px] font-medium text-muted">
                      <span className="rounded-full bg-surface px-2.5 py-1 shadow-card">{dayOf(m.created_at) === dayOf(new Date().toISOString()) ? t('Bugun') : formatDate(dayOf(m.created_at))}</span>
                    </p>
                  )}
                  <div className={clsx('flex', m.mine ? 'justify-end' : 'justify-start')}>
                    <div className={clsx('max-w-[78%] rounded-2xl px-3.5 py-2 text-sm shadow-card', m.mine ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md bg-surface')}>
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className={clsx('mt-0.5 text-right text-[10px] tabular-nums', m.mine ? 'text-white/70' : 'text-muted')}>{time(m.created_at)}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="flex items-end gap-2 border-t border-line p-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={4000}
          autoFocus
          placeholder={t('Xabar yozing…')}
          aria-label={t('Xabar')}
          className="max-h-32 min-h-10 flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/15"
        />
        <button
          type="submit"
          disabled={!text.trim() || send.isPending}
          aria-label={t('Yuborish')}
          title={t('Yuborish (Enter)')}
          className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand text-white transition-colors hover:bg-brand-strong disabled:opacity-50"
        >
          <SendHorizontal className="size-[18px]" aria-hidden />
        </button>
      </form>
    </>
  );
}
