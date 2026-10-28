import { redirect } from 'next/navigation';

// Xodimlar paneli uchun qisqa manzil: /admin → ish stoli (kirilmagan bo'lsa kirish sahifasiga o'tadi)
export default function AdminEntry() {
  redirect('/dashboard');
}
