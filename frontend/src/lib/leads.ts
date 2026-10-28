// Lidlar: sotuv voronkasi bosqichlari va tiplari
import type { Ref } from './academic';

export type LeadStage = 'new' | 'contacted' | 'trial' | 'contract' | 'enrolled' | 'lost';

export interface Lead {
  id: string;
  full_name: string;
  phone: string | null;
  branch: Ref;
  discipline: Ref | null;
  level: Ref | null;
  ad_source: Ref | null;
  owner: { id: string; full_name: string } | null;
  stage: LeadStage;
  note: string | null;
  lost_reason: string | null;
  student_id: string | null;
  created_at: string;
  last_activity_at: string;
}

export interface LeadEvent {
  id: string;
  type: 'created' | 'stage' | 'note' | 'converted';
  from_stage: LeadStage | null;
  to_stage: LeadStage | null;
  text: string | null;
  actor: string | null;
  created_at: string;
}

export const STAGES: { id: LeadStage; label: string; color: string }[] = [
  { id: 'new', label: 'Yangi', color: '#64748b' },
  { id: 'contacted', label: "Bog'lanildi", color: '#2563eb' },
  { id: 'trial', label: 'Sinov darsi', color: '#7c3aed' },
  { id: 'contract', label: 'Shartnoma', color: '#d97706' },
  { id: 'enrolled', label: "O'quvchi bo'ldi", color: '#15803d' },
  { id: 'lost', label: 'Rad etdi', color: '#dc2626' },
];
export const stageOf = (id: LeadStage) => STAGES.find((s) => s.id === id) as (typeof STAGES)[number];

/** "3 kun oldin" ko'rinishidagi qisqa vaqt */
export function ago(iso: string): { text: string; vars?: Record<string, number> } {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return minutes < 2 ? { text: 'Hozirgina' } : { text: '{n} daqiqa oldin', vars: { n: minutes } };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { text: '{n} soat oldin', vars: { n: hours } };
  return { text: '{n} kun oldin', vars: { n: Math.round(hours / 24) } };
}
