export type StudentStatus = 'new' | 'active' | 'paused' | 'finished' | 'archived';

export const STATUS: Record<StudentStatus, { label: string; tone: 'info' | 'success' | 'warning' | 'neutral' }> = {
  new: { label: 'Yangi', tone: 'info' },
  active: { label: "O'qiyapti", tone: 'success' },
  paused: { label: "To'xtatilgan", tone: 'warning' },
  finished: { label: 'Tugatgan', tone: 'neutral' },
  archived: { label: 'Arxivda', tone: 'neutral' },
};

export const GENDER: Record<string, string> = { male: 'Erkak', female: 'Ayol' };
export const RELATIONS = ['Ona', 'Ota', 'Buvi', 'Bobo', 'Aka', 'Opa', 'Vasiy', 'Boshqa'];

export interface Ref {
  id: string;
  name: string;
}

export interface StudentRow {
  id: string;
  /** Odam o'qiydigan tartib raqami — ekranda studentNo() bilan */
  number: number;
  photo_url: string | null;
  full_name: string;
  birth_date: string | null;
  gender: 'male' | 'female' | null;
  phone: string | null;
  branch: Ref;
  status: StudentStatus;
  balance: number;
  owner: { id: string; full_name: string } | null;
  blacklisted: boolean;
  created_at: string;
  /** Hozir o'qiyotgan guruhlari */
  groups: { id: string; name: string; course: string; teacher: string; status: string; since: string }[];
}

export interface Contact {
  id: string;
  full_name: string;
  relation: string;
  phone: string | null;
  email: string | null;
  is_bill_recipient: boolean;
  receives_notifications: boolean;
  /** Telegram botga ulangan (bloklamagan) */
  telegram_linked: boolean;
}

export interface Student extends StudentRow {
  email: string | null;
  contacts_hidden: boolean;
  contacts: Contact[];
  ad_source: Ref | null;
  learning_goal: Ref | null;
  notification_language: string;
  note: string | null;
  blacklist_reason: string | null;
  archived_at: string | null;
}

export interface DictionaryItem extends Ref {
  kind: string;
  is_active: boolean;
}
