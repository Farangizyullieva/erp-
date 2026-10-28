# EduCRM

O'quv markazi uchun CRM/ERP tizimi. Loyiha ikki qismdan iborat: **backend** (server) va **frontend** (sayt).

```
erp/
├── backend/     server: ma'lumotlar bazasi, qoidalar, xavfsizlik
├── frontend/    sayt: brauzerda ko'rinadigan hamma narsa
└── scripts/     bazani birinchi marta sozlash skripti
```

Frontend hech qachon bazaga to'g'ridan-to'g'ri murojaat qilmaydi — u backenddan so'raydi, backend esa ruxsatni tekshirib javob beradi.

## Ishga tushirish

`erp` papkasida ikkita terminal oching:

```bash
pnpm backend:dev     # server  → http://localhost:3001
pnpm frontend:dev    # sayt    → http://localhost:3000
```

Brauzerda http://localhost:3000 ni oching. Direktor logini va paroli `backend/.env` faylida (`SEED_OWNER_PHONE`, `SEED_OWNER_PASSWORD`).

Boshqa buyruqlar:

| Buyruq | Nima qiladi |
|---|---|
| `pnpm test` | backend testlarini ishga tushiradi |
| `pnpm db:migrate` | bazadagi jadvallarni yangilaydi |
| `pnpm db:demo` | namuna ma'lumot qo'shadi (o'quvchilar, guruhlar, to'lovlar) |
| `pnpm db:demo:clear` | faqat namuna ma'lumotni o'chiradi |

> Backend ishlab turganda baza tuzilmasi o'zgarsa (yangi migration), serverni to'xtatib qayta ishga tushiring.

## Backend (`backend/`)

NestJS + PostgreSQL. Har bir bo'lim o'z papkasida turadi.

```
backend/
├── .env                 sozlamalar va maxfiy kalitlar (bot tokenlari shu yerda)
├── prisma/
│   ├── schema.prisma    bazadagi barcha jadvallar tavsifi
│   ├── migrations/      bazaga kiritilgan o'zgarishlar tarixi
│   ├── seed.ts          boshlang'ich ma'lumot (rollar, direktor)
│   └── demo.ts          namuna ma'lumot
├── src/
│   ├── modules/         BO'LIMLAR — har biri bitta ish sohasi
│   │   ├── identity/        kirish, xodimlar, rollar va ruxsatlar
│   │   ├── organization/    filiallar va xonalar
│   │   ├── reference/       ma'lumotnomalar (fan, daraja…) va bayramlar
│   │   ├── students/        o'quvchilar va aloqa shaxslari
│   │   ├── academic/        guruhlar, jadval, darslar, davomat
│   │   ├── finance/         to'lovlar, balans, shaxsiy hisob
│   │   ├── leads/           lidlar (sotuv voronkasi), o'quvchiga aylantirish
│   │   ├── messaging/       ota-onalarga Telegram xabarlari, haftalik hisobot, qarz eslatmasi
│   │   ├── portal/          o'quvchi kabineti (kirish berish va o'quvchi ko'radigan ma'lumot)
│   │   ├── inbox/           ichki chat va bildirishnomalar
│   │   └── dashboard/       ish stoli raqamlari
│   └── common/          HAMMA BO'LIMLAR ISHLATADIGAN UMUMIY QISM
│       ├── auth/            ruxsat tekshiruvi
│       ├── db/              bazaga ulanish
│       ├── security/        himoya (2FA, fayl va URL tekshiruvi)
│       ├── alerts/          xatolarni Telegram botga yuborish
│       ├── audit/           kim nima qilgani jurnali
│       └── http/            xato javoblari formati
└── test/                avtomatik testlar
```

Bo'lim ichida fayllar bir xil nomlanadi:

- `*.module.ts` yoki `*.controller.ts` — manzillar (masalan `GET /students`) va har biriga kerakli ruxsat;
- `*.service.ts` — asosiy mantiq;
- `*.dto.ts` — kiruvchi ma'lumotni tekshirish qoidalari.

## Frontend (`frontend/`)

Next.js (React). Har bir sahifa — `src/app` ichidagi bitta papka; papka nomi sayt manzili bilan bir xil.

```
frontend/src/
├── app/                 SAHIFALAR
│   ├── page.tsx             ochiq bosh sahifa  (/)
│   ├── (auth)/              kirish sahifalari: /login (admin), /teacher/login, /student/login
│   ├── (teacher)/teacher/   o'qituvchi paneli (/teacher): bosh sahifa, jadval, guruhlar, davomat
│   ├── (portal)/student/    o'quvchi kabineti (/student)
│   └── (app)/               admin paneli — direktor, administrator, buxgalter…
│       ├── dashboard/           ish stoli
│       ├── students/            o'quvchilar ro'yxati va kartochkasi
│       ├── study-units/         guruhlar
│       ├── schedule/            jadval
│       ├── attendance/          davomat
│       ├── finance/             moliya
│       ├── communication/       Telegram xabarlar, chatlar
│       ├── company/             filiallar, xodimlar
│       ├── settings/            ma'lumotnomalar, rollar
│       ├── leads/               lidlar (kanban va ro'yxat)
│       └── requests/ reports/   hozircha namuna ko'rinish
├── components/          QAYTA ISHLATILADIGAN BO'LAKLAR
│   ├── ui/                  tugma, maydon, jadval, oyna — umumiy qurilish bloklari
│   ├── shell.tsx            chap menyu va tepa panel
│   ├── academic.tsx         guruh formasi, davomat oynasi, to'lov oynasi
│   └── …
└── lib/                 YORDAMCHI KOD
    ├── api.ts               backendga so'rov yuborish
    ├── auth.tsx             kim kirgani va uning ruxsatlari
    ├── nav.ts               menyu tarkibi
    ├── i18n.tsx, ru.ts      til (o'zbekcha / ruscha)
    └── format.ts            pul, sana, telefon ko'rinishi
```

`(auth)` va `(app)` qavsli papkalar manzilga kirmaydi — ular faqat sahifalarni guruhlash uchun.

## Yangi narsa qo'shish tartibi

1. Yangi jadval kerak bo'lsa — `backend/prisma/schema.prisma` va yangi migration.
2. Backendda bo'lim papkasiga servis va manzil qo'shiladi, test yoziladi.
3. Frontendda `src/app/(app)/…` ichiga sahifa qo'shiladi va `lib/nav.ts` da menyuga kiritiladi.
