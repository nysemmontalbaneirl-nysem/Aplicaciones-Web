import { useState } from "react";

export type Pestana =
  | "trabajadores"
  | "importar"
  | "periodos"
  | "tareo"
  | "calculo"
  | "boletas"
  | "reportes"
  | "vacaciones"
  | "parametros"
  | "usuarios"
  | "empresa"
  | "proyectos"
  | "configuracion"
  | "bitacora";

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
  pestana: Pestana;
  setPestana: (p: Pestana) => void;
  periodoSeleccionado: boolean;
  esAdmin: boolean;
  puedeCalcular: boolean;
}

export default function Sidebar({
  pestana,
  setPestana,
  periodoSeleccionado,
  esAdmin,
  puedeCalcular,
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
              { id: "vacaciones" as const, etiqueta: "Vacaciones" },
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
              { id: "configuracion" as const, etiqueta: "Configuración" },
              { id: "proyectos" as const, etiqueta: "Proyectos" },
              { id: "usuarios" as const, etiqueta: "Usuarios" },
              { id: "empresa" as const, etiqueta: "Empresa" },
              { id: "bitacora" as const, etiqueta: "Bitácora" },
            ],
          },
        ]
      : []),
  ];

  const grupoDeLaPestanaActiva = grupos.find((g) => g.items.some((i) => i.id === pestana))?.id;
  const [grupoAbierto, setGrupoAbierto] = useState<string | null>(grupoDeLaPestanaActiva ?? "trabajadores");

  return (
    <div className="sidebar">
      <div className="sidebar-titulo">Menú</div>

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
    </div>
  );
}
