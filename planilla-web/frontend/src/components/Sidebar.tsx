import { useState } from "react";

export type Pestana =
  | "inicio"
  | "trabajadores"
  | "importar"
  | "periodos"
  | "tareo"
  | "tareoDiario"
  | "calculo"
  | "boletas"
  | "reportes"
  | "vacaciones"
  | "parametros"
  | "usuarios"
  | "empresa"
  | "proyectos"
  | "configuracion"
  | "bitacora"
  | "roles";

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
  puedeVerBoletas: boolean;
  puedeVerReportes: boolean;
  puedeVerVacaciones: boolean;
  puedeImportarMasivo: boolean;
  puedeVerParametros: boolean;
  puedeVerConfiguracion: boolean;
  puedeVerProyectos: boolean;
  puedeVerEmpresa: boolean;
  puedeVerBitacora: boolean;
}

export default function Sidebar({
  pestana,
  setPestana,
  periodoSeleccionado,
  esAdmin,
  puedeCalcular,
  puedeVerBoletas,
  puedeVerReportes,
  puedeVerVacaciones,
  puedeImportarMasivo,
  puedeVerParametros,
  puedeVerConfiguracion,
  puedeVerProyectos,
  puedeVerEmpresa,
  puedeVerBitacora,
}: Props) {
  const puedeVerAdministracion =
    puedeVerParametros ||
    puedeVerConfiguracion ||
    puedeVerProyectos ||
    puedeVerEmpresa ||
    puedeVerBitacora ||
    esAdmin;

  const grupos: GrupoMenu[] = [
    {
      id: "inicio",
      etiqueta: "Inicio",
      items: [{ id: "inicio", etiqueta: "Resumen" }],
    },
    {
      id: "trabajadores",
      etiqueta: "Trabajadores",
      items: [
        { id: "trabajadores", etiqueta: "Trabajadores" },
        ...(puedeImportarMasivo ? [{ id: "importar" as const, etiqueta: "Importar masivo" }] : []),
      ],
    },
    {
      id: "planillas",
      etiqueta: "Planillas",
      items: [
        { id: "periodos", etiqueta: "Periodos" },
        { id: "tareo", etiqueta: "Tareo", disabled: !periodoSeleccionado },
        { id: "tareoDiario", etiqueta: "Registrar Tareo Diario", disabled: !periodoSeleccionado },
        ...(puedeCalcular ? [{ id: "calculo" as const, etiqueta: "Calcular", disabled: !periodoSeleccionado }] : []),
        ...(puedeVerBoletas ? [{ id: "boletas" as const, etiqueta: "Boletas" }] : []),
        ...(puedeVerReportes ? [{ id: "reportes" as const, etiqueta: "Reportes" }] : []),
        ...(puedeVerVacaciones ? [{ id: "vacaciones" as const, etiqueta: "Vacaciones" }] : []),
      ],
    },
    ...(puedeVerAdministracion
      ? [
          {
            id: "administracion",
            etiqueta: "Administración",
            items: [
              ...(puedeVerParametros ? [{ id: "parametros" as const, etiqueta: "Parametros" }] : []),
              ...(puedeVerConfiguracion ? [{ id: "configuracion" as const, etiqueta: "Configuración" }] : []),
              ...(puedeVerProyectos ? [{ id: "proyectos" as const, etiqueta: "Proyectos" }] : []),
              ...(esAdmin ? [{ id: "usuarios" as const, etiqueta: "Usuarios" }] : []),
              ...(esAdmin ? [{ id: "roles" as const, etiqueta: "Roles" }] : []),
              ...(puedeVerEmpresa ? [{ id: "empresa" as const, etiqueta: "Empresa" }] : []),
              ...(puedeVerBitacora ? [{ id: "bitacora" as const, etiqueta: "Bitácora" }] : []),
            ],
          },
        ]
      : []),
  ];

  const grupoDeLaPestanaActiva = grupos.find((g) => g.items.some((i) => i.id === pestana))?.id;
  const [grupoAbierto, setGrupoAbierto] = useState<string | null>(grupoDeLaPestanaActiva ?? "inicio");

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
