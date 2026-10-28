import {
  BarChart3, Building2, CalendarDays, ClipboardCheck, GraduationCap, Inbox, LayoutDashboard,
  MessagesSquare, Settings, Target, Users, Wallet, type LucideIcon,
} from 'lucide-react';

/** Kirgandan keyingi bosh sahifa; `/` — ochiq (landing) sahifa */
export const HOME = '/dashboard';

export interface NavPage {
  label: string;
  href: string;
  /** Sanab o'tilganlardan kamida bittasi bo'lsa ko'rinadi; bo'sh = hammaga */
  permissions?: string[];
}

export interface NavSection extends NavPage {
  icon: LucideIcon;
  pages?: NavPage[];
  /** Backend moduli hali qurilmagan: sahifa namuna ma'lumot bilan ko'rsatiladi (menyuda "Namuna" belgisi) */
  demo?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavSection[];
}

// Asosiy navigatsiya (TZ 4.2): 12 bo'lim, mazmuniga ko'ra guruhlangan. Menyu rolga qarab qisqaradi.
export const NAV: NavGroup[] = [
  {
    label: 'Asosiy',
    items: [{ label: 'Ish stoli', href: HOME, icon: LayoutDashboard }],
  },
  {
    label: 'Sotuv',
    items: [
      { label: 'Arizalar', href: '/requests', icon: Inbox, permissions: ['study_request.view'], demo: true },
      { label: 'Lidlar', href: '/leads', icon: Target, permissions: ['lead.view'] },
    ],
  },
  {
    label: "O'quv jarayoni",
    items: [
      { label: "O'quvchilar", href: '/students', icon: GraduationCap, permissions: ['student.view'] },
      { label: "O'quv birliklari", href: '/study-units', icon: Users, permissions: ['study_unit.view'] },
      { label: 'Jadval', href: '/schedule', icon: CalendarDays, permissions: ['schedule.view'] },
      { label: 'Davomat', href: '/attendance', icon: ClipboardCheck, permissions: ['attendance.view'] },
    ],
  },
  {
    label: 'Moliya va aloqa',
    items: [
      { label: 'Moliya', href: '/finance', icon: Wallet, permissions: ['payment.view', 'invoice.view', 'ledger.view'] },
      {
        label: 'Kommunikatsiya',
        href: '/communication',
        icon: MessagesSquare,
        // Ota-onalarga Telegram xabarlari (ruxsat bo'yicha) va barcha xodimlarga ochiq ichki chat
        pages: [
          { label: 'Telegram xabarlar', href: '/communication/telegram', permissions: ['message.send'] },
          { label: 'Chatlar', href: '/communication/chats' },
        ],
      },
      {
        label: 'Hisobotlar',
        href: '/reports',
        icon: BarChart3,
        permissions: ['report.finance', 'report.sales', 'report.load', 'report.profitability', 'report.manager'],
        demo: true,
      },
    ],
  },
  {
    label: 'Boshqaruv',
    items: [
      {
        label: 'Kompaniya',
        href: '/company',
        icon: Building2,
        permissions: ['branch.view', 'employee.view'],
        pages: [
          { label: 'Filiallar', href: '/company/branches', permissions: ['branch.view'] },
          { label: 'Xodimlar', href: '/company/employees', permissions: ['employee.view'] },
        ],
      },
      {
        label: 'Sozlamalar',
        href: '/settings',
        icon: Settings,
        permissions: ['settings.manage', 'role.manage'],
        pages: [
          { label: "Ma'lumotnomalar", href: '/settings/dictionaries', permissions: ['settings.manage'] },
          { label: 'Rollar va ruxsatlar', href: '/settings/roles', permissions: ['role.manage'] },
        ],
      },
    ],
  },
];

export const NAV_ITEMS: NavSection[] = NAV.flatMap((g) => g.items);

/** Tez amallar: "+" menyusi va buyruqlar palitrasi. `?new=1` sahifada qo'shish formasini ochadi */
export const QUICK_ACTIONS: { label: string; href: string; permission: string; icon: LucideIcon }[] = [
  { label: "To'lov qabul qilish", href: '/finance?new=1', permission: 'payment.create', icon: Wallet },
  { label: "O'quvchi qo'shish", href: '/students?new=1', permission: 'student.create', icon: GraduationCap },
  { label: "Xodim qo'shish", href: '/company/employees?new=1', permission: 'employee.create', icon: Users },
  { label: "Filial qo'shish", href: '/company/branches?new=1', permission: 'branch.create', icon: Building2 },
];
