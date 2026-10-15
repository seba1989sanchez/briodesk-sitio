-- Solicitudes que llegan desde el sitio: demostraciones y direcciones (subdominios).
CREATE TABLE solicitudes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK (tipo IN ('demo', 'subdominio')),
  nombre TEXT NOT NULL,
  empresa TEXT NOT NULL,
  correo TEXT NOT NULL,
  interes TEXT,
  subdominio TEXT,
  pais TEXT,
  creado_en TEXT NOT NULL,
  aviso_enviado_en TEXT,
  aviso_intentos INTEGER NOT NULL DEFAULT 0,
  aviso_error TEXT
);
CREATE INDEX solicitudes_pendientes ON solicitudes (aviso_enviado_en, aviso_intentos);
CREATE INDEX solicitudes_fecha ON solicitudes (creado_en);
