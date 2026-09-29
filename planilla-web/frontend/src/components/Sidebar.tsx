import { useState } from "react";

export type Pestana =
  | "inicio"
  | "trabajadores"
  | "importar"
  | "periodos"
  | "tareo"
  | "tareoDiario"
  | "marcaciones"
  | "calculo"
  | "boletas"
  | "reportes"
  | "planillaMensual"
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
  puedeVerPlanillaMensual: boolean;
  puedeVerVacaciones: boolean;
  puedeImportarMasivo: boolean;
  puedeVerParametros: boolean;
  puedeVerConfiguracion: boolean;
  puedeVerProyectos: boolean;
  puedeVerEmpresa: boolean;
  puedeVerBitacora: boolean;
  colapsada: boolean;
  onCambiarColapsada: (colapsada: boolean) => void;
}

// Icono (unicode, sin dependencias nuevas) para representar cada grupo
// cuando la barra lateral esta contraida a "solo iconos".
const ICONOS_GRUPO: Record<string, string> = {
  inicio: "🏠",
  trabajadores: "👷",
  planillas: "📋",
  administracion: "⚙️",
};

export default function Sidebar({
  pestana,
  setPestana,
  periodoSeleccionado,
  esAdmin,
  puedeCalcular,
  puedeVerBoletas,
  puedeVerReportes,
  puedeVerPlanillaMensual,
  puedeVerVacaciones,
  puedeImportarMasivo,
  puedeVerParametros,
  puedeVerConfiguracion,
  puedeVerProyectos,
  puedeVerEmpresa,
  puedeVerBitacora,
  colapsada,
  onCambiarColapsada,
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
        // Ronda 2 ("Control de Asistencia Diaria" - puente practico): importar
        // marcaciones biometricas desde un Excel/CSV mientras se compra/
        // verifica el equipo real. Escribe en el Tareo Diario recien al
        // aprobar la revision.
        // NOTA (recon 44/46): el parche original agrega esta pestana DENTRO
        // de un componente "TareoUnificado" (un sub-menu que junta Tareo +
        // TareoDiario + esto en una sola pestana del Sidebar) que ningun
        // parche de los 46 construye - grep confirma que "TareoUnificado"
        // solo aparece mencionado en este parche. Se agrega aqui como una
        // pestana plana mas del Sidebar, igual patron que "tareo"/
        // "tareoDiario" ya existentes, en vez de fabricar ese sub-menu.
        { id: "marcaciones", etiqueta: "Importar marcaciones", disabled: !periodoSeleccionado },
        ...(puedeCalcular ? [{ id: "calculo" as const, etiqueta: "Calcular", disabled: !periodoSeleccionado }] : []),
        ...(puedeVerBoletas ? [{ id: "boletas" as const, etiqueta: "Boletas" }] : []),
        ...(puedeVerReportes ? [{ id: "reportes" as const, etiqueta: "Reportes" }] : []),
        ...(puedeVerPlanillaMensual ? [{ id: "planillaMensual" as const, etiqueta: "Planilla Mensual" }] : []),
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

  // Con la barra contraida no se muestran los submenus (no hay espacio para
  // el texto de los items). Al hacer clic en el icono de un grupo, primero
  // se expande la barra completa y se abre ese grupo, para que el usuario
  // elija el item exacto con el texto visible.
  function alClicGrupo(grupoId: string, abierto: boolean) {
    if (colapsada) {
      onCambiarColapsada(false);
      setGrupoAbierto(grupoId);
    } else {
      setGrupoAbierto(abierto ? null : grupoId);
    }
  }

  return (
    <div className={`sidebar ${colapsada ? "colapsada" : ""}`}>
      <div className="sidebar-toggle-fila">
        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => onCambiarColapsada(!colapsada)}
          title={colapsada ? "Expandir menú" : "Contraer menú"}
        >
          {colapsada ? "»" : "«"}
        </button>
      </div>

      {!colapsada && <div className="sidebar-titulo">Menú</div>}

      <nav className="sidebar-nav">
        {grupos.map((grupo) => {
          const abierto = grupoAbierto === grupo.id;
          return (
            <div key={grupo.id} className="sidebar-grupo">
              <button
                type="button"
                className={`sidebar-grupo-boton ${abierto && !colapsada ? "abierto" : ""}`}
                onClick={() => alClicGrupo(grupo.id, abierto)}
                title={colapsada ? grupo.etiqueta : undefined}
              >
                {colapsada ? (
                  <span className="sidebar-icono-grupo">{ICONOS_GRUPO[grupo.id] ?? "•"}</span>
                ) : (
                  <>
                    <span>{grupo.etiqueta}</span>
                    <span className="sidebar-flecha">{abierto ? "▾" : "▸"}</span>
                  </>
                )}
              </button>
              {!colapsada && abierto && (
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
