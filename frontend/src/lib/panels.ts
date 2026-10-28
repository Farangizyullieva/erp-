// Panellar manzillari. Oddiy modul ("use client" emas): server layout'lar ham to'g'ridan-to'g'ri o'qiy oladi

/**
 * Uchta alohida panel, har birining o'z kirish sahifasi va manzili bor:
 *  - staff   — admin paneli (direktor, administrator, buxgalter…): /login → /dashboard
 *  - teacher — o'qituvchi paneli: /teacher/login → /teacher
 *  - portal  — o'quvchi kabineti: /student/login → /student
 */
export type Panel = 'staff' | 'teacher' | 'portal';

export const PANELS: Record<Panel, { home: string; login: string; name: string }> = {
  staff: { home: '/dashboard', login: '/login', name: 'Admin paneli' },
  teacher: { home: '/teacher', login: '/teacher/login', name: "O'qituvchi paneli" },
  portal: { home: '/student', login: '/student/login', name: "O'quvchi kabineti" },
};
export const STUDENT_HOME = PANELS.portal.home;
export const STUDENT_LOGIN = PANELS.portal.login;
