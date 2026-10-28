'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ArrowLeft, Bell, Send, EyeOff, Mail, KeyRound, Pencil, Phone, Plus, Printer, Receipt, Undo2, ShieldAlert, Trash2, UserRound, Users } from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { PaymentDialog } from '@/components/academic';
import { ReceiptDialog } from '@/components/receipt';
import { StudentPortalDialog } from '@/components/student-portal';
import { AttendanceCalendar } from '@/components/attendance-calendar';
import { PhotoUpload } from '@/components/photo';
import { StudentForm } from '@/components/student-form';
import { SendMessageDialog, TelegramLinkDialog } from '@/components/student-telegram';
import { useToast } from '@/components/toast';
import { Avatar, BackButton, Button, CheckCard, ConfirmDialog, EmptyState, ErrorNote, Field, IconButton, Modal, Panel, SelectField, StatusPill, TableSkeleton, Tabs, Tag } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { METHODS } from '@/lib/academic';
import { useAuth } from '@/lib/auth';
import { ageOf, formatDate, formatDateTime, formatMoney, formatPhone, studentNo } from '@/lib/format';
import { GENDER, RELATIONS, STATUS, type Contact, type Student } from '@/lib/students';
import { t } from '@/lib/i18n';

interface Ledger {
  balance: number;
  entries: { id: string; type: 'payment' | 'payment_cancel' | 'subscription' | 'charge' | 'reversal' | 'refund' | 'adjustment'; cancelled: boolean; amount: number; occurred_at: string; method: string | null; comment: string | null }[];
}

/** Abonement izohi "GURUH: 2026-09-12 – 2026-10-11" → "GURUH · 12.09.2026 – 11.10.2026" */
const period = (comment: string | null): string => (comment ?? '').replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3.$2.$1').replace(': ', ' · ');

const ENTRY: Record<string, string> = { payment: "To'lov", payment_cancel: "To'lov bekor qilindi", subscription: 'Oylik abonement', charge: 'Yechim', reversal: 'Yechim bekor qilindi', refund: 'Qaytarish', adjustment: 'Tuzatish' };

interface HistoryEntry {
  id: string;
  action: string;
  actor: string | null;
  occurred_at: string;
  changes: { field: string; from: unknown; to: unknown }[];
}

const ACTIONS: Record<string, string> = {
  'student.created': "O'quvchi yaratildi",
  'student.updated': "Ma'lumotlar o'zgartirildi",
  'student.archived': 'Arxivga olindi',
  'student.unarchived': 'Arxivdan qaytarildi',
  'student.contact_added': "Aloqa shaxsi qo'shildi",
  'student.contact_updated': "Aloqa shaxsi o'zgartirildi",
  'student.contact_removed': "Aloqa shaxsi o'chirildi",
};
const FIELDS: Record<string, string> = {
  full_name: 'F.I.O.', birth_date: "Tug'ilgan sana", gender: 'Jinsi', phone: 'Telefon', email: 'Email', branch: 'Filial', status: 'Holat',
  owner: "Mas'ul", blacklisted: "Qora ro'yxat", blacklist_reason: "Qora ro'yxat sababi", ad_source: 'Manba', learning_goal: 'Maqsad',
  notification_language: 'Xabarnoma tili', note: 'Izoh', relation: "Kim bo'ladi", is_bill_recipient: 'Schyot oluvchi', receives_notifications: 'Xabarnoma oladi',
};
const show = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : v === true ? t("Ha") : v === false ? t("Yo'q") : t(STATUS[v as keyof typeof STATUS]?.label ?? GENDER[String(v)] ?? String(v)));

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9.5rem_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted">{t(label)}</dt>
      <dd className="min-w-0 break-words font-medium">{children}</dd>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Panel>
      <header className="flex min-h-[52px] items-center justify-between gap-3 border-b border-line px-5 py-2.5">
        <h2 className="font-semibold">{t(title)}</h2>
        {action}
      </header>
      {children}
    </Panel>
  );
}

export default function StudentPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'general' | 'attendance' | 'finance' | 'history'>('general');
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [portal, setPortal] = useState(false);
  const [cancelling, setCancelling] = useState<{ id: string; amount: number } | null>(null);
  // Moliya sahifasi yoki tezkor amaldan `?pay=1` bilan kelinganda: Moliya bo'limi va to'lov oynasi darhol ochiladi
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const payRequested = searchParams.get('pay') === '1';
  useEffect(() => {
    if (!payRequested) return;
    setTab('finance');
    if (can('payment.create')) setPaying(true);
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payRequested]);
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [contact, setContact] = useState<Contact | 'new' | null>(null);
  const [removing, setRemoving] = useState<Contact | null>(null);
  const [linking, setLinking] = useState<Contact | null>(null);
  const [messaging, setMessaging] = useState(false);

  const student = useQuery({ queryKey: ['students', id], queryFn: () => api<Student>(`/students/${id}`) });
  const ledger = useQuery({ queryKey: ['students', id, 'ledger'], queryFn: () => api<Ledger>(`/students/${id}/ledger`), enabled: tab === 'finance' && can('ledger.view') });
  const history = useQuery({ queryKey: ['students', id, 'history'], queryFn: () => api<HistoryEntry[]>(`/students/${id}/history`), enabled: tab === 'history' });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['students'] });

  const archive = useMutation({
    mutationFn: (archived: boolean) => api<Student>(`/students/${id}/${archived ? 'archive' : 'unarchive'}`, { method: 'POST' }),
    onSuccess: async (s) => {
      await refresh();
      setConfirmArchive(false);
      toast.success(s.status === 'archived' ? t("O'quvchi arxivga olindi") : t("O'quvchi arxivdan qaytarildi"));
    },
    onError: (e) => toast.error(e.message),
  });
  const removeContact = useMutation({
    mutationFn: (c: Contact) => api<void>(`/students/${id}/contacts/${c.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await refresh();
      setRemoving(null);
      toast.success("Aloqa shaxsi o'chirildi");
    },
    onError: (e) => toast.error(e.message),
  });

  const back = (
    <div className="mb-3">
      <BackButton />
    </div>
  );
  if (student.isPending) return <Panel><TableSkeleton rows={4} /></Panel>;
  if (student.isError) {
    return (
      <>
        {back}
        <ErrorNote onRetry={() => void student.refetch()}>{student.error.message}</ErrorNote>
      </>
    );
  }
  const s = student.data;
  const archived = s.status === 'archived';
  const age = ageOf(s.birth_date);
  const canEdit = can('student.update') && !archived;
  const canEditContacts = canEdit && !s.contacts_hidden;

  return (
    <>
      {back}
      {/* Obyekt kartochkasi (TZ P2): chap ustun 300px + o'ngda tab'lar */}
      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Panel className="p-5">
            <div className="flex flex-col items-center text-center">
              {canEdit ? <PhotoUpload name={s.full_name} src={s.photo_url} uploadPath={`/students/${id}/photo`} onUploaded={refresh} /> : <Avatar name={s.full_name} src={s.photo_url} size="xl" />}
              <h1 className="mt-3 text-lg font-semibold leading-tight">{s.full_name}</h1>
              <p className="mt-1 rounded-md bg-canvas px-2 py-0.5 text-xs font-medium tabular-nums text-muted" title={t("O'quvchi ID raqami")}>
                ID {studentNo(s.number)}
              </p>
              {s.groups.length > 0 && <p className="mt-2 text-sm font-medium">{s.groups.map((g) => g.name).join(', ')}</p>}
              <p className="mt-1 text-sm text-muted">{[age !== null && `${age} ${t('yosh')}`, s.gender && t(GENDER[s.gender] ?? '')].filter(Boolean).join(' · ') || s.branch.name}</p>
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                <StatusPill tone={STATUS[s.status].tone}>{STATUS[s.status].label}</StatusPill>
                {s.blacklisted && <StatusPill tone="danger">{t("Qora ro'yxatda")}</StatusPill>}
              </div>
            </div>

            <dl className="mt-5 space-y-2.5 border-t border-line pt-4 text-sm">
              {s.contacts_hidden ? (
                <p className="flex items-center gap-2 text-muted">
                  <EyeOff className="size-4 shrink-0" aria-hidden /> {t("Kontaktlarni ko'rishga ruxsatingiz yo'q")}
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-2.5">
                    <Phone className="size-4 shrink-0 text-muted" aria-hidden />
                    <dt className="sr-only">{t("Telefon")}</dt>
                    <dd>{s.phone ? <a href={`tel:${s.phone}`} className="font-medium hover:text-brand-strong">{formatPhone(s.phone)}</a> : <span className="text-muted">{t("Telefon kiritilmagan")}</span>}</dd>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Mail className="size-4 shrink-0 text-muted" aria-hidden />
                    <dt className="sr-only">{t("Email")}</dt>
                    <dd className="min-w-0 truncate">{s.email ?? <span className="text-muted">{t("Email kiritilmagan")}</span>}</dd>
                  </div>
                </>
              )}
            </dl>

            {(canEdit || can('student.archive') || can('message.send') || can('payment.create')) && (
              <div className="mt-5 grid gap-2">
                {canEdit && (
                  <Button variant="secondary" onClick={() => setEditing(true)}>
                    <Pencil className="size-4" aria-hidden /> {t("Tahrirlash")}
                  </Button>
                )}
                {can('payment.create') && !archived && (
                  <Button onClick={() => setPaying(true)}>
                    <Plus className="size-4" aria-hidden /> To'lov qabul qilish
                  </Button>
                )}
                {can('message.send') && !archived && (
                  <Button variant="secondary" onClick={() => setMessaging(true)}>
                    <Send className="size-4" aria-hidden /> Xabar yuborish
                  </Button>
                )}
                {can('student.enable_portal') && !archived && (
                  <Button variant="secondary" onClick={() => setPortal(true)}>
                    <KeyRound className="size-4" aria-hidden /> Shaxsiy kabinet
                  </Button>
                )}
                {can('student.archive') && (
                  <Button variant="ghost" className="text-muted" onClick={() => setConfirmArchive(true)}>
                    {archived ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
                    {archived ? t("Arxivdan qaytarish") : t("Arxivga olish")}
                  </Button>
                )}
              </div>
            )}
          </Panel>

          <Panel className="p-5">
            <p className="text-xs font-medium text-muted">{t("Balans")}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${s.balance < 0 ? 'text-danger' : ''}`}>{formatMoney(s.balance)}</p>
            <p className="mt-1 text-xs text-muted">{s.balance < 0 ? t("Qarzdorlik bor") : s.balance > 0 ? t("Oldindan to'lov bor") : t("To'lov va yechimlar hali yo'q")}</p>
          </Panel>
        </aside>

        <div className="min-w-0 space-y-5">
          {s.blacklisted && (
            <div role="note" className="flex items-start gap-2.5 rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                <b className="font-semibold">{t("Qora ro'yxatda.")}</b> {s.blacklist_reason ?? t("Sabab ko'rsatilmagan")}
              </p>
            </div>
          )}
          <Tabs
            tabs={[
              { id: 'general', label: 'Umumiy' },
              ...(can('attendance.view') ? [{ id: 'attendance' as const, label: 'Davomat' }] : []),
              ...(can('ledger.view') ? [{ id: 'finance' as const, label: 'Moliya' }] : []),
              { id: 'history', label: 'Tarix' },
            ]}
            value={tab}
            onChange={setTab}
          />

          {tab === 'general' ? (
            <>
              <Section title={t("Shaxsiy ma'lumot")}>
                <dl className="divide-y divide-line px-5 py-1.5">
                  <Row label={t("F.I.O.")}>{s.full_name}</Row>
                  <Row label={t("Tug'ilgan sana")}>{s.birth_date ? `${formatDate(s.birth_date)}${age !== null ? ` (${age} ${t('yosh')})` : ''}` : '—'}</Row>
                  <Row label={t("Jinsi")}>{s.gender ? t(GENDER[s.gender] ?? '') : '—'}</Row>
                  <Row label={t("Ichki izoh")}>{s.note ? <span className="whitespace-pre-wrap font-normal">{s.note}</span> : '—'}</Row>
                </dl>
              </Section>

              <Section
                title={t("Aloqa shaxslari")}
                action={
                  canEditContacts && (
                    <Button variant="secondary" size="sm" onClick={() => setContact('new')}>
                      <Plus className="size-4" aria-hidden /> {t("Qo'shish")}
                    </Button>
                  )
                }
              >
                {s.contacts_hidden ? (
                  <EmptyState icon={EyeOff} title={t("Kontaktlar yashirilgan")} hint={t("Aloqa shaxslarini ko'rish uchun alohida ruxsat kerak.")} />
                ) : s.contacts.length === 0 ? (
                  <EmptyState icon={UserRound} title={t("Aloqa shaxsi yo'q")} hint={t("Ota-ona yoki vakilni qo'shing — schyot va xabarlar unga boradi.")} />
                ) : (
                  <ul className="divide-y divide-line">
                    {s.contacts.map((c) => (
                      <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                        <Avatar name={c.full_name} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            {c.full_name} <span className="font-normal text-muted">· {t(c.relation)}</span>
                          </p>
                          <p className="text-xs text-muted tabular-nums">{[c.phone && formatPhone(c.phone), c.email].filter(Boolean).join(' · ') || t("Kontakt kiritilmagan")}</p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {c.is_bill_recipient && (
                              <Tag>
                                <Receipt className="mr-1 inline size-3" aria-hidden />
                                {t("Schyot oluvchi")}
                              </Tag>
                            )}
                            {c.telegram_linked && (
                              <Tag>
                                <Send className="mr-1 inline size-3" aria-hidden />
                                Telegram ulangan
                              </Tag>
                            )}
                            {c.receives_notifications && (
                              <Tag>
                                <Bell className="mr-1 inline size-3" aria-hidden />
                                {t("Xabarnoma oladi")}
                              </Tag>
                            )}
                          </div>
                        </div>
                        {canEditContacts && (
                          <>
                            {!c.telegram_linked && <IconButton label={t("{name}ni Telegram'ga ulash", { name: c.full_name })} icon={Send} onClick={() => setLinking(c)} />}
                            <IconButton label={t('{name}ni tahrirlash', { name: c.full_name })} icon={Pencil} onClick={() => setContact(c)} />
                            <IconButton label={t("{name}ni o'chirish", { name: c.full_name })} icon={Trash2} onClick={() => setRemoving(c)} />
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Guruhlar va kurslar">
                {s.groups.length === 0 ? (
                  <EmptyState icon={Users} title="Hali guruhga qo'shilmagan" hint="O'quvchini guruh sahifasidagi «O'quvchi qo'shish» tugmasi orqali guruhga biriktiring." />
                ) : (
                  <ul className="divide-y divide-line">
                    {s.groups.map((g) => (
                      <li key={g.id}>
                        <Link href={`/study-units/${g.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 hover:bg-canvas/50">
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">{g.name}</span>
                            <span className="block text-xs text-muted">
                              {g.course} · {g.teacher}
                            </span>
                          </span>
                          <span className="text-xs tabular-nums text-muted">{t('{date} dan beri', { date: formatDate(g.since) })}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title={t("O'quv ma'lumoti")}>
                <dl className="divide-y divide-line px-5 py-1.5">
                  <Row label={t("Filial")}>{s.branch.name}</Row>
                  <Row label={t("Mas'ul xodim")}>{s.owner?.full_name ?? '—'}</Row>
                  <Row label={t("Qayerdan bildi")}>{s.ad_source?.name ?? '—'}</Row>
                  <Row label={t("O'qish maqsadi")}>{s.learning_goal?.name ?? '—'}</Row>
                  <Row label={t("Qo'shilgan sana")}>{formatDateTime(s.created_at)}</Row>
                </dl>
              </Section>
            </>
          ) : tab === 'attendance' ? (
            <Panel>
              <AttendanceCalendar studentId={id} />
            </Panel>
          ) : tab === 'finance' ? (
            <Section
              title="Shaxsiy hisob"
              action={
                can('payment.create') &&
                !archived && (
                  <Button size="sm" onClick={() => setPaying(true)}>
                    <Plus className="size-4" aria-hidden /> To'lov qabul qilish
                  </Button>
                )
              }
            >
              {ledger.isPending ? (
                <TableSkeleton rows={3} />
              ) : ledger.isError ? (
                <div className="p-4">
                  <ErrorNote onRetry={() => void ledger.refetch()}>{ledger.error.message}</ErrorNote>
                </div>
              ) : ledger.data.entries.length === 0 ? (
                <EmptyState icon={Receipt} title="Hali to'lov va yechim yo'q" hint="To'lov qabul qilinganda yoki guruhga qo'shilib abonement hisoblanganda shu yerda ko'rinadi." />
              ) : (
                <ul className="divide-y divide-line">
                  {ledger.data.entries.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-4 px-5 py-3">
                      <div className={`min-w-0 ${e.cancelled ? 'opacity-55' : ''}`}>
                        <p className="text-sm font-medium">
                          <span className={e.cancelled ? 'line-through' : undefined}>{t(ENTRY[e.type] ?? e.type)}</span>
                          {e.cancelled && <span className="ml-2 rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger">{t('Bekor qilingan')}</span>}
                        </p>
                        <p className="truncate text-xs text-muted tabular-nums">
                          {e.type === 'subscription' ? period(e.comment) : [formatDateTime(e.occurred_at), e.method && t(METHODS[e.method] ?? e.method), e.comment].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <span className="flex shrink-0 items-center gap-1">
                        <span className={`whitespace-nowrap text-sm font-semibold tabular-nums ${e.cancelled ? 'text-muted line-through' : e.amount > 0 ? 'text-success' : 'text-ink'}`}>
                          {e.amount > 0 ? '+' : ''}
                          {formatMoney(e.amount)}
                        </span>
                        {e.type === 'payment' && !e.cancelled && can('payment.view') ? <IconButton label="Chekni ochish" icon={Printer} onClick={() => setReceipt(e.id)} /> : <span className="size-9" aria-hidden />}
                        {e.type === 'payment' && !e.cancelled && can('payment.delete') ? <IconButton label="To'lovni bekor qilish" icon={Undo2} onClick={() => setCancelling({ id: e.id, amount: e.amount })} className="hover:!text-danger" /> : can('payment.delete') && <span className="size-9" aria-hidden />}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          ) : (
            <Section title={t("O'zgarishlar tarixi")}>
              {history.isPending ? (
                <TableSkeleton rows={3} />
              ) : history.isError ? (
                <div className="p-4">
                  <ErrorNote onRetry={() => void history.refetch()}>{history.error.message}</ErrorNote>
                </div>
              ) : (
                <ol className="divide-y divide-line">
                  {history.data.map((h) => (
                    <li key={h.id} className="px-5 py-3.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <p className="text-sm font-medium">{t(ACTIONS[h.action] ?? h.action)}</p>
                        <p className="text-xs text-muted tabular-nums">
                          {h.actor ?? t("Tizim")} · {formatDateTime(h.occurred_at)}
                        </p>
                      </div>
                      {h.action !== 'student.created' && h.changes.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 text-[13px] text-muted">
                          {h.changes.map((c) => (
                            <li key={c.field}>
                              {t(FIELDS[c.field] ?? c.field)}: <span className="line-through">{show(c.from)}</span> → <span className="text-ink">{show(c.to)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          )}
        </div>
      </div>

      {editing && <StudentForm student={s} onClose={() => setEditing(false)} />}
      {portal && <StudentPortalDialog studentId={s.id} name={s.full_name} onClose={() => setPortal(false)} />}
      {receipt && <ReceiptDialog paymentId={receipt} onClose={() => setReceipt(null)} />}
      {cancelling && <CancelPayment payment={cancelling} onClose={() => setCancelling(null)} />}
      {paying && <PaymentDialog student={{ id: s.id, number: s.number, full_name: s.full_name }} onClose={() => setPaying(false)} />}
      {linking && (
        <TelegramLinkDialog
          studentId={id}
          contact={linking}
          onClose={() => {
            setLinking(null);
            // Ota-ona shu orada ulangan bo'lishi mumkin
            void refresh();
          }}
        />
      )}
      {messaging && <SendMessageDialog studentId={id} studentName={s.full_name} onClose={() => setMessaging(false)} />}
      {contact && <ContactForm studentId={id} contact={contact === 'new' ? undefined : contact} onClose={() => setContact(null)} />}
      {confirmArchive && (
        <ConfirmDialog
          title={archived ? t("Arxivdan qaytarish") : t("Arxivga olish")}
          message={
            archived
              ? t("{name} yana faol o'quvchilar ro'yxatiga qaytadi.", { name: s.full_name })
              : t("{name} asosiy ro'yxatdan yashiriladi. Ma'lumotlari, to'lov va davomat tarixi saqlanib qoladi — istalgan payt qaytarish mumkin.", { name: s.full_name })
          }
          confirmLabel={archived ? t("Qaytarish") : t("Arxivga olish")}
          pending={archive.isPending}
          onConfirm={() => archive.mutate(!archived)}
          onClose={() => setConfirmArchive(false)}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={t("Aloqa shaxsini o'chirish")}
          message={t("{name} ({relation}) bu o'quvchining aloqa shaxslaridan o'chiriladi.", { name: removing.full_name, relation: t(removing.relation) })}
          confirmLabel={t("O'chirish")}
          danger
          pending={removeContact.isPending}
          onConfirm={() => removeContact.mutate(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}

function ContactForm({ studentId, contact, onClose }: { studentId: string; contact?: Contact; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [bill, setBill] = useState(contact?.is_bill_recipient ?? false);
  const [notify, setNotify] = useState(contact?.receives_notifications ?? true);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      contact
        ? api<Contact>(`/students/${studentId}/contacts/${contact.id}`, { method: 'PATCH', body })
        : api<Contact>(`/students/${studentId}/contacts`, { method: 'POST', body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['students'] });
      toast.success(contact ? t("Aloqa shaxsi saqlandi") : t("Aloqa shaxsi qo'shildi"));
      onClose();
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors() : {};

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (name: string): string => String(form.get(name) ?? '').trim();
    save.mutate({
      full_name: text('full_name'),
      relation: text('relation'),
      phone: text('phone'),
      email: text('email'),
      is_bill_recipient: bill,
      receives_notifications: notify,
    });
  }

  return (
    <Modal title={contact ? t("Aloqa shaxsini tahrirlash") : t("Yangi aloqa shaxsi")} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={t("F.I.O.")} name="full_name" defaultValue={contact?.full_name} placeholder={t("Familiya Ism")} required minLength={2} autoFocus error={errors.full_name} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label={t("Kim bo'ladi")} name="relation" defaultValue={contact?.relation ?? t("Ona")}>
            {[...new Set([...RELATIONS, ...(contact ? [contact.relation] : [])])].map((r) => (
              <option key={r} value={r}>
                {t(r)}
              </option>
            ))}
          </SelectField>
          <Field label={t("Telefon")} name="phone" type="tel" defaultValue={contact?.phone ?? ''} placeholder="+998 90 123-45-67" error={errors.phone} />
        </div>
        <Field label={t("Email")} name="email" type="email" defaultValue={contact?.email ?? ''} error={errors.email} />
        <div className="grid gap-2">
          <CheckCard title={t("Schyot oluvchi")} description={t("To'lov schyotlari shu shaxsga yuboriladi (faqat bitta bo'ladi)")} checked={bill} onChange={setBill} />
          <CheckCard title={t("Xabarnoma oladi")} description={t("Dars, davomat va jadval o'zgarishlari haqida")} checked={notify} onChange={setNotify} />
        </div>
        {save.isError && Object.keys(errors).length === 0 && <ErrorNote>{save.error.message}</ErrorNote>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            {t("Bekor qilish")}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {t("Saqlash")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Xato kiritilgan to'lovni bekor qilish: yozuv o'chirilmaydi, teskari yozuv qo'shiladi va balans qaytadi */
function CancelPayment({ payment, onClose }: { payment: { id: string; amount: number }; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () => api<{ balance: number }>(`/payments/${payment.id}/cancel`, { method: 'POST', body: { reason: reason.trim() } }),
    onSuccess: async (r) => {
      await Promise.all(['finance', 'payments', 'students', 'study-units', 'dashboard'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      toast.success(t("To'lov bekor qilindi. Yangi balans: {sum}", { sum: formatMoney(r.balance) }));
      onClose();
    },
  });
  return (
    <Modal
      title="To'lovni bekor qilish"
      description={t("{sum} — balansdan qaytarib olinadi. Keyin to'g'ri summani qaytadan kiritasiz", { sum: formatMoney(payment.amount) })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Yopish
          </Button>
          <Button variant="danger" onClick={() => cancel.mutate()} loading={cancel.isPending} disabled={reason.trim().length < 2}>
            To'lovni bekor qilish
          </Button>
        </>
      }
    >
      <Field label="Sabab" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} required autoFocus placeholder="Masalan: summa xato kiritildi" hint="To'lov tarixda «bekor qilingan» deb qoladi — kim va nega bekor qilgani ko'rinadi" />
      {cancel.isError && (
        <div className="mt-3">
          <ErrorNote>{cancel.error.message}</ErrorNote>
        </div>
      )}
    </Modal>
  );
}
