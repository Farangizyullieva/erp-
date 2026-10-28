import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

const THEME_SCRIPT = `try{var t=localStorage.getItem('educrm.theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t}catch(e){}`;

export const metadata: Metadata = { title: 'EduCRM', description: "O'quv markazlari uchun CRM" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Nonce'li CSP (middleware.ts) har bir so'rovda yangi bo'ladi: sarlavhani o'qish sahifani dinamik qiladi,
  // Next esa o'z skriptlariga shu nonce'ni o'zi qo'yadi
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="uz" suppressHydrationWarning>
      <head>
        {/* Statik matn (foydalanuvchi ma'lumoti yo'q): saqlangan yoki tizim temasini birinchi chizishdan oldin qo'yadi */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
