// NAMUNA MA'LUMOT. Bu fayldagi hamma narsa o'ylab topilgan va backendga ulanmagan: Arizalar, Lidlar va
// Hisobotlar sahifalari CRM moduli qurilguncha shu bilan ko'rsatiladi (qolgan bo'limlar haqiqiy API'da).
// Modul backend'i tayyor bo'lganda tegishli sahifa haqiqiy API'ga o'tkaziladi va bu yerdagi qismi o'chiriladi.

export const SUBJECT_COLORS: Record<string, string> = {
  'Ingliz tili': '#2563eb',
  IELTS: '#7c3aed',
  Backend: '#0f766e',
  Frontend: '#c2410c',
  Matematika: '#be185d',
  'Rus tili': '#4d7c0f',
};

export interface DemoGroup {
  id: string;
  name: string;
  subject: string;
  level: string;
  teacher: string;
  branch: string;
  room: string;
  /** 1 = Dushanba … 6 = Shanba */
  days: number[];
  start: string;
  end: string;
  students: number;
  capacity: number;
  status: 'active' | 'forming' | 'paused';
  debtors: number;
}

export const GROUPS: DemoGroup[] = [
  { id: 'g1', name: 'ENG-A2-01', subject: 'Ingliz tili', level: 'A2', teacher: 'Karimova Zarina', branch: 'Asosiy filial', room: '101-xona', days: [1, 3, 5], start: '09:00', end: '10:30', students: 12, capacity: 14, status: 'active', debtors: 2 },
  { id: 'g2', name: 'ENG-B1-02', subject: 'Ingliz tili', level: 'B1', teacher: 'Karimova Zarina', branch: 'Asosiy filial', room: '101-xona', days: [1, 3, 5], start: '11:00', end: '12:30', students: 14, capacity: 14, status: 'active', debtors: 0 },
  { id: 'g3', name: 'IELTS-01', subject: 'IELTS', level: 'B2', teacher: 'Hamidova Laylo', branch: 'Chilonzor filiali', room: '201-xona', days: [2, 4, 6], start: '15:00', end: '17:00', students: 9, capacity: 12, status: 'active', debtors: 3 },
  { id: 'g4', name: 'BACK-JR-03', subject: 'Backend', level: 'Junior', teacher: 'Yusupov Sherzod', branch: 'Asosiy filial', room: 'Kompyuter xonasi', days: [1, 3, 5], start: '18:00', end: '20:00', students: 16, capacity: 18, status: 'active', debtors: 1 },
  { id: 'g5', name: 'FRONT-BG-02', subject: 'Frontend', level: 'Beginner', teacher: 'Sobirov Diyor', branch: 'Chilonzor filiali', room: 'Kompyuter xonasi', days: [2, 4, 6], start: '18:00', end: '20:00', students: 15, capacity: 18, status: 'active', debtors: 4 },
  { id: 'g6', name: 'MATH-9-01', subject: 'Matematika', level: '9-sinf', teacher: 'Usmonov Behruz', branch: 'Yunusobod filiali', room: 'A-1', days: [2, 4], start: '14:00', end: '15:30', students: 10, capacity: 12, status: 'active', debtors: 0 },
  { id: 'g7', name: 'RUS-A1-01', subject: 'Rus tili', level: 'A1', teacher: 'Mirzayeva Kamola', branch: 'Yunusobod filiali', room: 'A-2', days: [1, 3, 5], start: '16:00', end: '17:30', students: 8, capacity: 12, status: 'active', debtors: 1 },
  { id: 'g8', name: 'ENG-A1-05', subject: 'Ingliz tili', level: 'A1', teacher: 'Hamidova Laylo', branch: 'Chilonzor filiali', room: '102-xona', days: [2, 4, 6], start: '10:00', end: '11:30', students: 5, capacity: 14, status: 'forming', debtors: 0 },
  { id: 'g9', name: 'MATH-11-02', subject: 'Matematika', level: '11-sinf', teacher: 'Usmonov Behruz', branch: 'Yunusobod filiali', room: 'A-1', days: [1, 3], start: '10:00', end: '11:30', students: 7, capacity: 12, status: 'paused', debtors: 2 },
];

export const WEEKDAYS = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
export const WEEKDAYS_SHORT = ['Du', 'Se', 'Chor', 'Pay', 'Ju', 'Sha'];

export const LEAD_STAGES = ['Yangi', "Bog'lanildi", 'Sinov darsi', 'Shartnoma', 'Yozildi'] as const;
export interface DemoLead {
  id: string;
  name: string;
  phone: string;
  subject: string;
  level: string;
  owner: string;
  stage: (typeof LEAD_STAGES)[number];
  source: string;
  lastActivity: string;
  task: boolean;
}

export const LEADS: DemoLead[] = [
  { id: 'l1', name: 'Tursunov Javohir', phone: '+998 90 311-20-14', subject: 'Backend', level: 'Junior', owner: 'Saidov Jasur', stage: 'Yangi', source: 'Instagram', lastActivity: 'Bugun, 10:12', task: true },
  { id: 'l2', name: 'Abdullayeva Sevinch', phone: '+998 91 540-77-02', subject: 'Ingliz tili', level: 'A2', owner: 'Nazarova Dilnoza', stage: 'Yangi', source: 'Telegram', lastActivity: 'Bugun, 09:40', task: false },
  { id: 'l3', name: 'Qodirov Asadbek', phone: '+998 93 118-45-90', subject: 'IELTS', level: 'B2', owner: 'Saidov Jasur', stage: 'Yangi', source: 'Tavsiya', lastActivity: 'Kecha, 18:05', task: true },
  { id: 'l4', name: 'Ismoilova Mohira', phone: '+998 94 207-33-18', subject: 'Frontend', level: 'Beginner', owner: 'Nazarova Dilnoza', stage: "Bog'lanildi", source: 'Instagram', lastActivity: 'Bugun, 11:30', task: true },
  { id: 'l5', name: 'Xolmatov Ulugbek', phone: '+998 97 615-08-41', subject: 'Matematika', level: '9-sinf', owner: 'Saidov Jasur', stage: "Bog'lanildi", source: 'Google', lastActivity: 'Kecha, 15:22', task: false },
  { id: 'l6', name: 'Ergasheva Rayhona', phone: '+998 99 430-61-27', subject: 'Ingliz tili', level: 'B1', owner: 'Nazarova Dilnoza', stage: "Bog'lanildi", source: 'Tavsiya', lastActivity: '2 kun oldin', task: false },
  { id: 'l7', name: 'Hamidov Behruz', phone: '+998 90 852-14-66', subject: 'Backend', level: 'Junior', owner: 'Saidov Jasur', stage: 'Sinov darsi', source: 'Telegram', lastActivity: 'Ertaga, 18:00', task: true },
  { id: 'l8', name: 'Sobirova Zarina', phone: '+998 91 264-90-35', subject: 'IELTS', level: 'B2', owner: 'Nazarova Dilnoza', stage: 'Sinov darsi', source: 'Instagram', lastActivity: 'Bugun, 15:00', task: false },
  { id: 'l9', name: 'Mirzayev Otabek', phone: '+998 93 771-52-09', subject: 'Frontend', level: 'Beginner', owner: 'Saidov Jasur', stage: 'Sinov darsi', source: 'Google', lastActivity: 'Kecha, 18:00', task: true },
  { id: 'l10', name: 'Usmonova Kamola', phone: '+998 94 390-18-73', subject: 'Rus tili', level: 'A1', owner: 'Nazarova Dilnoza', stage: 'Shartnoma', source: 'Tavsiya', lastActivity: 'Bugun, 12:45', task: true },
  { id: 'l11', name: 'Rahimov Sardor', phone: '+998 97 506-27-48', subject: 'Ingliz tili', level: 'A2', owner: 'Saidov Jasur', stage: 'Shartnoma', source: 'Instagram', lastActivity: 'Kecha, 17:10', task: false },
  { id: 'l12', name: 'Yusupova Madina', phone: '+998 99 148-36-95', subject: 'Matematika', level: '11-sinf', owner: 'Nazarova Dilnoza', stage: 'Yozildi', source: 'Tavsiya', lastActivity: '3 kun oldin', task: false },
  { id: 'l13', name: 'Nazarov Timur', phone: '+998 90 673-81-20', subject: 'Backend', level: 'Junior', owner: 'Saidov Jasur', stage: 'Yozildi', source: 'Telegram', lastActivity: '4 kun oldin', task: false },
];

export const REQUESTS = [
  { id: 'r1', date: '11.10.2026 10:42', name: 'Karimov Diyor', phone: '+998 90 124-55-10', subject: 'Frontend', level: 'Beginner', branch: 'Chilonzor filiali', source: 'Sayt formasi', utm: 'instagram / kuz-aksiya', status: 'Yangi' },
  { id: 'r2', date: '11.10.2026 09:15', name: 'Aliyeva Shahzoda', phone: '+998 91 833-02-47', subject: 'Ingliz tili', level: 'A1', branch: 'Asosiy filial', source: 'Telegram bot', utm: '—', status: 'Yangi' },
  { id: 'r3', date: '10.10.2026 19:58', name: 'Saidov Jasurbek', phone: '+998 93 402-71-66', subject: 'Backend', level: 'Junior', branch: 'Asosiy filial', source: 'Sayt formasi', utm: 'google / backend-kurs', status: 'Yangi' },
  { id: 'r4', date: '10.10.2026 16:30', name: 'Nazarova Gulnora', phone: '+998 94 915-38-04', subject: 'IELTS', level: 'B2', branch: 'Chilonzor filiali', source: 'Sayt formasi', utm: 'telegram / ielts', status: 'Lidga aylantirildi' },
  { id: 'r5', date: '10.10.2026 12:07', name: 'Tursunova Laylo', phone: '+998 97 260-49-81', subject: 'Matematika', level: '9-sinf', branch: 'Yunusobod filiali', source: 'Telegram bot', utm: '—', status: 'Lidga aylantirildi' },
  { id: 'r6', date: '09.10.2026 18:44', name: 'Ergashev Sherzod', phone: '+998 99 571-06-32', subject: 'Rus tili', level: 'A1', branch: 'Yunusobod filiali', source: 'Sayt formasi', utm: 'instagram / kuz-aksiya', status: 'Lidga aylantirildi' },
  { id: 'r7', date: '09.10.2026 11:20', name: 'Qodirova Nodira', phone: '+998 90 388-64-15', subject: 'Ingliz tili', level: 'B1', branch: 'Asosiy filial', source: 'Landing (Tilda)', utm: 'google / ingliz-tili', status: 'Arxivlandi' },
];

export const FUNNEL = [
  { stage: 'Arizalar', count: 186 }, { stage: "Bog'lanildi", count: 142 }, { stage: 'Sinov darsi', count: 88 }, { stage: 'Shartnoma', count: 61 }, { stage: 'Yozildi', count: 52 },
];
export const LEAD_SOURCES = [
  { source: 'Instagram', leads: 74, converted: 18 }, { source: 'Telegram', leads: 49, converted: 15 }, { source: 'Tavsiya', leads: 38, converted: 14 }, { source: 'Google', leads: 25, converted: 5 },
];
