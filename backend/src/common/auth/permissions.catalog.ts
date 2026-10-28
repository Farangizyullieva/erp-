// Ruxsatlar katalogi (TZ 3.2). Guruhlar UI'dagi checkbox matritsasi guruhlariga mos.
export const PERMISSION_GROUPS = {
  Filiallar: ['branch.view', 'branch.create', 'branch.update', 'branch.delete', 'classroom.manage'],
  Xodimlar: [
    'employee.view',
    'employee.create',
    'employee.update',
    'employee.deactivate',
    'role.manage',
    'teacher.view_salary_settings',
    'teacher.edit_salary_settings',
  ],
  'Arizalar va lidlar': [
    'study_request.view',
    'study_request.approve',
    'study_request.archive',
    'lead.view',
    'lead.create',
    'lead.update',
    'lead.delete',
    'lead.view_contacts',
    'lead.bulk_action',
    'lead.change_owner',
  ],
  "O'quvchilar": [
    'student.view',
    'student.create',
    'student.update',
    'student.archive',
    'student.view_contacts',
    'student.view_passport',
    'student.enable_portal',
  ],
  "O'quv birliklari": [
    'study_unit.view',
    'study_unit.create',
    'study_unit.update',
    'study_unit.delete',
    'study_unit.change_status',
    'study_unit.manage_members',
  ],
  Jadval: [
    'schedule.view',
    'schedule.create',
    'schedule.update',
    'schedule.delete',
    'lesson.cancel',
    'lesson.reschedule',
    'lesson.substitute_teacher',
  ],
  Davomat: ['attendance.view', 'attendance.mark', 'attendance.mark_past', 'attendance.edit_locked'],
  // Darsliklar yuklash; uy vazifasi berish va baholash
  "Ta'lim": ['material.manage', 'homework.manage'],
  Moliya: [
    'finance.view_amounts',
    'price.view',
    'price.manage',
    'invoice.view',
    'invoice.create',
    'invoice.update',
    'invoice.delete',
    'payment.view',
    'payment.create',
    'payment.update',
    'payment.delete',
    'payment.refund',
    'ledger.view',
    'ledger.adjust',
    'expense.view',
    'expense.manage',
  ],
  Payroll: ['payroll.view_own', 'payroll.view_all', 'payroll.calculate', 'payroll.approve', 'payroll.pay'],
  Hisobotlar: ['report.finance', 'report.sales', 'report.load', 'report.profitability', 'report.manager'],
  Kommunikatsiya: [
    'message.send',
    'message.bulk_send',
    'template.manage',
    'automation.manage',
    'chat.view_all',
    'chat.reply',
  ],
  Vazifalar: ['task.view_others', 'task.edit_others'],
  Tizim: ['import.run', 'export.run', 'audit.view', 'settings.manage'],
} as const satisfies Record<string, readonly string[]>;

export type PermissionGroup = keyof typeof PERMISSION_GROUPS;
export type PermissionCode = (typeof PERMISSION_GROUPS)[PermissionGroup][number];
export type Scope = 'own' | 'branch' | 'all';

export const ALL_PERMISSIONS: { code: PermissionCode; group: PermissionGroup }[] = (
  Object.entries(PERMISSION_GROUPS) as [PermissionGroup, readonly PermissionCode[]][]
).flatMap(([group, codes]) => codes.map((code) => ({ code, group })));

const ALL_CODES = ALL_PERMISSIONS.map((p) => p.code);
const SCOPE_RANK: Record<Scope, number> = { own: 1, branch: 2, all: 3 };
export const widerScope = (a: Scope, b: Scope): Scope => (SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b);
export const scopeCovers = (held: Scope, needed: Scope): boolean => SCOPE_RANK[held] >= SCOPE_RANK[needed];

type RoleSeed = { code: string; name: string; scope: Scope; permissions: readonly PermissionCode[] };

const SALES: PermissionCode[] = [
  'branch.view',
  'study_request.view',
  'study_request.approve',
  'study_request.archive',
  'lead.view',
  'lead.create',
  'lead.update',
  'lead.view_contacts',
  'lead.bulk_action',
  'student.view',
  'student.create',
  'student.view_contacts',
  'schedule.view',
  'message.send',
  'chat.reply',
];

// Boshlang'ich tizim rollari (TZ 3.1). student / parent kabinet orqali kiradi — xodim ruxsatlari yo'q.
export const SYSTEM_ROLES: readonly RoleSeed[] = [
  { code: 'owner', name: 'Tashkilot egasi', scope: 'all', permissions: ALL_CODES },
  {
    code: 'branch_manager',
    name: 'Filial boshqaruvchisi',
    scope: 'branch',
    permissions: ALL_CODES.filter(
      (c) => !['branch.create', 'branch.delete', 'role.manage', 'settings.manage', 'payroll.pay'].includes(c),
    ),
  },
  { code: 'sales_manager', name: 'Sotuv menejeri', scope: 'branch', permissions: SALES },
  {
    code: 'administrator',
    name: 'Administrator (reception)',
    scope: 'branch',
    permissions: [
      ...SALES,
      'student.update',
      // O'quvchiga kabinet ochib, parol berish — reception ishi
      'student.enable_portal',
      'study_unit.view',
      'study_unit.manage_members',
      'schedule.create',
      'schedule.update',
      'lesson.cancel',
      'lesson.reschedule',
      'lesson.substitute_teacher',
      'attendance.view',
      'attendance.mark',
      'price.view',
      'invoice.view',
      'invoice.create',
      'payment.view',
      'payment.create',
      'ledger.view',
    ],
  },
  {
    code: 'accountant',
    name: 'Buxgalter',
    scope: 'all',
    permissions: [
      'branch.view',
      'student.view',
      'study_unit.view',
      'employee.view',
      'teacher.view_salary_settings',
      'teacher.edit_salary_settings',
      ...PERMISSION_GROUPS.Moliya,
      ...PERMISSION_GROUPS.Payroll,
      'report.finance',
      'report.profitability',
      'export.run',
    ],
  },
  {
    code: 'teacher',
    name: "O'qituvchi",
    scope: 'own',
    permissions: [
      'schedule.view',
      'study_unit.view',
      'student.view',
      'attendance.view',
      'attendance.mark',
      'material.manage',
      'homework.manage',
      'payroll.view_own',
      'chat.reply',
    ],
  },
  { code: 'student', name: "O'quvchi", scope: 'own', permissions: [] },
  { code: 'parent', name: 'Ota-ona / vakil', scope: 'own', permissions: [] },
];
