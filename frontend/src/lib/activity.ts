import { t } from './i18n';

// Audit amallarining foydalanuvchiga ko'rinadigan nomlari
export const ACTIVITY_LABELS: Record<string, string> = {
  'branch.created': "Filial qo'shildi",
  'branch.updated': "Filial o'zgartirildi",
  'classroom.created': "Xona qo'shildi",
  'classroom.updated': "Xona o'zgartirildi",
  'employee.created': "Xodim qo'shildi",
  'employee.updated': "Xodim ma'lumotlari o'zgartirildi",
  'employee.roles_changed': "Xodim rollari o'zgartirildi",
  'employee.activated': 'Xodim faollashtirildi',
  'employee.deactivated': 'Xodim faolsizlantirildi',
  'role.created': 'Rol yaratildi',
  'role.updated': "Rol nomi o'zgartirildi",
  'role.permissions_changed': "Rol ruxsatlari o'zgartirildi",
  'dictionary.created': "Ma'lumotnomaga yozuv qo'shildi",
  'dictionary.updated': "Ma'lumotnoma yozuvi o'zgartirildi",
  'holiday.created': "Bayram qo'shildi",
  'holiday.deleted': "Bayram o'chirildi",
  'student.created': "O'quvchi qo'shildi",
  'student.updated': "O'quvchi ma'lumotlari o'zgartirildi",
  'student.archived': "O'quvchi arxivga olindi",
  'student.unarchived': "O'quvchi arxivdan qaytarildi",
  'student.contact_added': "Aloqa shaxsi qo'shildi",
  'student.contact_updated': "Aloqa shaxsi o'zgartirildi",
  'student.contact_removed': "Aloqa shaxsi o'chirildi",
};

export function activityHref(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null;
  if (entityType === 'student') return `/students/${entityId}`;
  if (entityType === 'branch') return `/company/branches/${entityId}`;
  return null;
}

/** "5 daqiqa oldin" ko'rinishidagi nisbiy vaqt */
export function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return t('hozirgina');
  if (minutes < 60) return t('{n} daqiqa oldin', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('{n} soat oldin', { n: hours });
  const days = Math.round(hours / 24);
  return days < 30 ? t('{n} kun oldin', { n: days }) : t('{n} oy oldin', { n: Math.round(days / 30) });
}
