-- Migracion 015: nuevo permiso "boletas.enviar" (enviar boletas por
-- correo), separado de "boletas.ver" (verlas en pantalla) - un rol puede
-- tener uno sin el otro. Se le da automaticamente a RESPONSABLE_PLANILLA
-- (ya tenia boletas.ver) para no cambiarle el acceso que ya tenia. ADMIN
-- no necesita fila: es protegido, siempre tiene acceso a todo.
-- No destructiva: se puede correr sobre la base real sin perder datos.

INSERT INTO permisos_catalogo (codigo, nombre, grupo, orden) VALUES
    ('boletas.enviar', 'Enviar boletas por correo', 'Planillas', 65)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_codigo, permiso_codigo)
SELECT 'RESPONSABLE_PLANILLA', 'boletas.enviar'
WHERE EXISTS (SELECT 1 FROM roles WHERE codigo = 'RESPONSABLE_PLANILLA')
ON CONFLICT DO NOTHING;
