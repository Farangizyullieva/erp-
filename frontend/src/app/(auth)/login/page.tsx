import { StaffLogin } from '@/components/staff-login';

// Admin paneli kirish sahifasi (direktor, administrator, buxgalter…)
export default function LoginPage() {
  return <StaffLogin panel="staff" />;
}
