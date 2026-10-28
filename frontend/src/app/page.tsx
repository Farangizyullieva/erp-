'use client';

import { ArrowRight, BarChart3, CalendarDays, ClipboardCheck, GraduationCap, ShieldCheck, Wallet, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { t, useLang } from '@/lib/i18n';

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: GraduationCap, title: "O'quvchilar va ota-onalar", text: "Kartochka, aloqa shaxslari, o'zgarishlar tarixi va balans bir joyda." },
  { icon: CalendarDays, title: 'Guruhlar va jadval', text: "Xona va o'qituvchi to'qnashuvi tizim darajasida oldi olinadi." },
  { icon: ClipboardCheck, title: 'Davomat', text: "O'qituvchi guruh davomatini telefondan bir necha soniyada belgilaydi." },
  { icon: Wallet, title: "To'lov va qarzdorlik", text: "Dars yakunlangach hisob avtomatik yuritiladi, qarzdorlar ko'rinib turadi." },
  { icon: ShieldCheck, title: 'Rollar va ruxsatlar', text: "Har bir xodim faqat o'z filiali va o'z vazifasiga tegishlisini ko'radi." },
  { icon: BarChart3, title: 'Hisobot va nazorat', text: 'Kim, qachon, nima qilgani yozib boriladi; rahbar uchun aniq raqamlar.' },
];

const ROLES: { title: string; text: string }[] = [
  { title: 'Rahbar', text: "Filiallar, tushum va o'quvchilar dinamikasi bitta ekranda." },
  { title: 'Administrator', text: "O'quvchi qo'shish, to'lov qabul qilish va jadval — bir necha bosishda." },
  { title: "O'qituvchi", text: "Bugungi darslar, davomat va o'z maoshi telefonda." },
];

const signIn =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-brand font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-white';

// Ochiq bosh sahifa: tizim haqida qisqacha va kirish tugmasi
export default function LandingPage() {
  const { lang, setLang } = useLang();

  return (
    <div data-theme="light" className="min-h-dvh bg-hero-surface text-hero-deep">
      <div className="bg-hero text-white">
        <header className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
          <Link href="/" className="rounded text-xl font-semibold tracking-tight">
            Edu<span className="text-hero-accent">CRM</span>
          </Link>
          <nav aria-label={t('Asosiy navigatsiya')} className="hidden gap-6 text-sm text-white/75 sm:flex">
            <a href="#imkoniyatlar" className="rounded hover:text-white">
              {t('Imkoniyatlar')}
            </a>
            <a href="#kimlar-uchun" className="rounded hover:text-white">
              {t('Kimlar uchun')}
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setLang(lang === 'uz' ? 'ru' : 'uz')}
              aria-label={lang === 'uz' ? 'Переключить на русский' : "O'zbek tiliga o'tish"}
              className="grid size-10 place-items-center rounded-lg border border-white/20 text-[12px] font-semibold text-white/85 hover:bg-white/10 focus-visible:outline-white"
            >
              {lang.toUpperCase()}
            </button>
            <Link href="/teacher/login" className="hidden h-10 items-center rounded-lg px-3 text-sm font-medium text-ink/70 hover:text-ink md:inline-flex">
              {t("O'qituvchilar")}
            </Link>
            <Link href="/student/login" className="hidden h-10 items-center rounded-lg px-3 text-sm font-medium text-ink/70 hover:text-ink sm:inline-flex">
              {t("O'quvchilar")}
            </Link>
            <Link href="/login" className={`${signIn} h-10 px-4 text-sm`}>
              {t('Kirish')}
            </Link>
          </div>
        </header>

        <section className="mx-auto max-w-6xl px-5 pb-20 pt-14 sm:pb-28 sm:pt-20">
          <p className="inline-flex rounded-full border border-white/20 px-3 py-1 text-[13px] text-hero-accent">{t("O'quv markazlari uchun yagona tizim")}</p>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-[56px]">{t("O'quv markazingizni bitta tizimdan boshqaring")}</h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/75 sm:text-lg">
            {t("Lid va o'quvchilardan tortib jadval, davomat, to'lov va maoshgacha — Excel, Telegram va qog'oz jurnallar o'rniga bitta tartibli platforma.")}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link href="/login" className={`${signIn} h-12 px-6 text-[15px]`}>
              {t('Tizimga kirish')}
              <ArrowRight className="size-[18px]" aria-hidden />
            </Link>
            <a href="#imkoniyatlar" className="rounded text-sm font-medium text-white/80 underline-offset-4 hover:text-white hover:underline">
              {t('Imkoniyatlar')}
            </a>
          </div>
        </section>
      </div>

      <main>
        <section id="imkoniyatlar" className="mx-auto max-w-6xl scroll-mt-6 px-5 py-16 sm:py-20">
          <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">{t("Har kungi ish uchun kerak bo'lgan hamma narsa")}</h2>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-hero-deep/70">
            {t("Har bir bo'lim bir-biri bilan bog'langan: davomat pul hisobiga, jadval maoshga ta'sir qiladi.")}
          </p>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="rounded-2xl border border-hero/10 bg-white p-6">
                <span className="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-4 text-[17px] font-semibold">{t(title)}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-hero-deep/70">{t(text)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="kimlar-uchun" className="scroll-mt-6 border-y border-hero/10 bg-white">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('Har bir rol uchun qulay')}</h2>
            <ol className="mt-10 grid gap-8 sm:grid-cols-3">
              {ROLES.map((role, i) => (
                <li key={role.title} className="border-t-2 border-hero pt-5">
                  <p className="text-sm font-semibold tabular-nums text-hero/60">0{i + 1}</p>
                  <h3 className="mt-2 text-lg font-semibold">{t(role.title)}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-hero-deep/70">{t(role.text)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <div className="flex flex-wrap items-center justify-between gap-6 rounded-3xl bg-hero px-7 py-10 text-white sm:px-12">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{t('Boshlashga tayyormisiz?')}</h2>
              <p className="mt-2 text-[15px] text-white/75">{t('Hisobingizga kiring va ishni davom ettiring.')}</p>
            </div>
            <Link href="/login" className={`${signIn} h-12 px-6 text-[15px]`}>
              {t('Tizimga kirish')}
              <ArrowRight className="size-[18px]" aria-hidden />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-hero/10">
        <p className="mx-auto max-w-6xl px-5 py-6 text-sm text-hero-deep/60">
          © {new Date().getFullYear()} EduCRM. {t('Barcha huquqlar himoyalangan.')}
        </p>
      </footer>
    </div>
  );
}
