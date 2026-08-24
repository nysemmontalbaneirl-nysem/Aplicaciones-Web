import { useState } from "react";
import { Usuario } from "../types";

export type Pestana =
  | "trabajadores"
  | "importar"
  | "periodos"
  | "tareo"
  | "calculo"
  | "boletas"
  | "reportes"
  | "parametros"
  | "usuarios"
  | "empresa"
  | "proyectos";

interface ItemMenu {
  id: Pestana;
  etiqueta: string;
  disabled?: boolean;
}

interface GrupoMenu {
  id: string;
  etiqueta: string;
  items: ItemMenu[];
}

interface Props {
  usuario: Usuario;
  pestana: Pestana;
  setPestana: (p: Pestana) => void;
  periodoSeleccionado: boolean;
  esAdmin: boolean;
  puedeCalcular: boolean;
  onCambiarPassword: () => void;
  onCerrarSesion: () => void;
}

export default function Sidebar({
  usuario,
  pestana,
  setPestana,
  periodoSeleccionado,
  esAdmin,
  puedeCalcular,
  onCambiarPassword,
  onCerrarSesion,
}: Props) {
  const grupos: GrupoMenu[] = [
    {
      id: "trabajadores",
      etiqueta: "Trabajadores",
      items: [
        { id: "trabajadores", etiqueta: "Trabajadores" },
        ...(esAdmin ? [{ id: "importar" as const, etiqueta: "Importar masivo" }] : []),
      ],
    },
    {
      id: "planillas",
      etiqueta: "Planillas",
      items: [
        { id: "periodos", etiqueta: "Periodos" },
        { id: "tareo", etiqueta: "Tareo", disabled: !periodoSeleccionado },
        ...(puedeCalcular
          ? [
              { id: "calculo" as const, etiqueta: "Calcular", disabled: !periodoSeleccionado },
              { id: "boletas" as const, etiqueta: "Boletas" },
              { id: "reportes" as const, etiqueta: "Reportes" },
            ]
          : []),
      ],
    },
    ...(esAdmin
      ? [
          {
            id: "administracion",
            etiqueta: "Administración",
            items: [
              { id: "parametros" as const, etiqueta: "Parametros" },
              { id: "proyectos" as const, etiqueta: "Proyectos" },
              { id: "usuarios" as const, etiqueta: "Usuarios" },
              { id: "empresa" as const, etiqueta: "Empresa" },
            ],
          },
        ]
      : []),
  ];

  const grupoDeLaPestanaActiva = grupos.find((g) => g.items.some((i) => i.id === pestana))?.id;
  const [grupoAbierto, setGrupoAbierto] = useState<string | null>(grupoDeLaPestanaActiva ?? "trabajadores");

  return (
    <div className="sidebar">
      <div className="sidebar-titulo">Sistema de Planillas</div>
      <div className="sidebar-subtitulo">JHCR</div>

      <nav className="sidebar-nav">
        {grupos.map((grupo) => {
          const abierto = grupoAbierto === grupo.id;
          return (
            <div key={grupo.id} className="sidebar-grupo">
              <button
                type="button"
                className={`sidebar-grupo-boton ${abierto ? "abierto" : ""}`}
                onClick={() => setGrupoAbierto(abierto ? null : grupo.id)}
              >
                <span>{grupo.etiqueta}</span>
                <span className="sidebar-flecha">{abierto ? "▾" : "▸"}</span>
              </button>
              {abierto && (
                <div className="sidebar-submenu">
                  {grupo.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`sidebar-item ${pestana === item.id ? "activo" : ""}`}
                      onClick={() => setPestana(item.id)}
                      disabled={item.disabled}
                    >
                      {item.etiqueta}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-usuario">
        <div className="sidebar-usuario-nombre">{usuario.nombre}</div>
        <div className="sidebar-usuario-rol">{usuario.rol}</div>
        <button type="button" onClick={onCambiarPassword}>
          Cambiar contraseña
        </button>
        <button type="button" onClick={onCerrarSesion}>
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
