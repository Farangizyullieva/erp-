-- Administrator (reception) o'quvchiga kabinet ochib, parol bera oladi.
-- Faqat tizim rolida va hali bu ruxsat bo'lmasa qo'shiladi: tashkilot o'zgartirgan sozlamalar ustidan yozilmaydi.
ALTER TABLE roles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions NO FORCE ROW LEVEL SECURITY;
INSERT INTO role_permissions (tenant_id, role_id, permission_code, scope)
SELECT r.tenant_id, r.id, 'student.enable_portal', 'branch'
FROM roles r
WHERE r.code = 'administrator' AND r.is_system
ON CONFLICT DO NOTHING;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
