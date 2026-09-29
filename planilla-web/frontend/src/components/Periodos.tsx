import { useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut, BASE_URL, conToken } from "../api";
import { PeriodoPlanilla, Proyecto } from "../types";
import { useAuth } from "../AuthContext";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre",
];

type TipoPeriodo = "MENSUAL" | "QUINCENAL" | "SEMANAL";

function primerDia(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, "0")}-01`;
}

function ultimoDia(anio: number, mes: number): string {
  const fecha = new Date(anio, mes, 0);
  return `${anio}-${String(mes).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;
}

interface Props {
  onCargarTareo?: (p: PeriodoPlanilla) => void;
  onTareoDiario?: (p: PeriodoPlanilla) => void;
  onCalcular?: (p: PeriodoPlanilla) => void;
}

export default function Periodos({ onCargarTareo, onTareoDiario, onCalcular }: Props) {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === "ADMIN";
  const [periodos, setPeriodos] = useState<PeriodoPlanilla[]>([]);
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [tipo, setTipo] = useState<TipoPeriodo>("MENSUAL");
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [quincena, setQuincena] = useState<1 | 2>(1);
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [proyecto, setProyecto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [edicion, setEdicion] = useState<
    Record<number, { fecha_inicio: string; fecha_fin: string; proyecto: string }>
  >({});
  const [guardandoEdicionId, setGuardandoEdicionId] = useState<number | null>(null);

  // Un usuario no-ADMIN solo puede elegir entre los proyectos que tiene
  // asignados (usuario.proyectos, nombres); un ADMIN puede elegir cualquiera
  // o dejarlo vacio (periodo "legado", para todos los proyectos).
  const proyectosDisponibles = esAdmin
    ? proyectos
    : proyectos.filter((p) => usuario?.proyectos.includes(p.nombre));

  async function cargar() {
    try {
      const [datosPeriodos, datosProyectos] = await Promise.all([
        apiGet<PeriodoPlanilla[]>("/periodos"),
        apiGet<Proyecto[]>("/proyectos"),
      ]);
      setPeriodos(datosPeriodos);
      setProyectos(datosProyectos);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  // Al cambiar de tipo se limpian las fechas elegidas a mano, para no
  // arrastrar por accidente un rango pensado para otro tipo de periodo.
  function cambiarTipo(nuevo: TipoPeriodo) {
    setTipo(nuevo);
    setFechaInicio("");
    setFechaFin("");
  }

  async function eliminarPeriodo(p: PeriodoPlanilla) {
    if (!window.confirm(`¿Eliminar el periodo ${MESES[p.mes - 1]} ${p.anio}? Esta accion no se puede deshacer.`)) {
      return;
    }
    setError(null);
    try {
      await apiDelete(`/periodos/${p.id}`);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Abre el formulario de edicion de un periodo ABIERTO, precargado con sus
  // valores actuales.
  function iniciarEdicion(p: PeriodoPlanilla) {
    setError(null);
    setEdicion((prev) => ({
      ...prev,
      [p.id]: {
        fecha_inicio: p.fecha_inicio?.slice(0, 10) ?? "",
        fecha_fin: p.fecha_fin?.slice(0, 10) ?? "",
        proyecto: p.proyecto ?? "",
      },
    }));
    setEditandoId(p.id);
  }

  function cancelarEdicion() {
    setEditandoId(null);
  }

  async function guardarEdicion(p: PeriodoPlanilla) {
    const datos = edicion[p.id];
    if (!datos) return;
    if (!esAdmin && !datos.proyecto) {
      setError("Debes elegir uno de tus proyectos asignados. Solo un Administrador puede dejar un periodo sin proyecto.");
      return;
    }
    setError(null);
    setGuardandoEdicionId(p.id);
    try {
      await apiPut(`/periodos/${p.id}`, {
        fecha_inicio: datos.fecha_inicio,
        fecha_fin: datos.fecha_fin,
        proyecto: datos.proyecto || null,
      });
      setEditandoId(null);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardandoEdicionId(null);
    }
  }

  async function crearPeriodo(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!esAdmin && !proyecto) {
      setError("Debes seleccionar uno de tus proyectos asignados. Solo un Administrador puede crear un periodo sin proyecto.");
      return;
    }
    setCreando(true);
    try {
      const proyectoEnviado = proyecto || null;
      if (tipo === "MENSUAL") {
        // dias_periodo lo calcula el backend a partir de fecha_inicio/fecha_fin
        // (dias calendario reales del mes: 28, 29, 30 o 31).
        await apiPost<PeriodoPlanilla>("/periodos", {
          anio,
          mes,
          tipo: "MENSUAL",
          fecha_inicio: primerDia(anio, mes),
          fecha_fin: ultimoDia(anio, mes),
          proyecto: proyectoEnviado,
        });
      } else if (tipo === "QUINCENAL") {
        if (!fechaInicio || !fechaFin) {
          throw new Error("Ingresa la fecha de inicio y de fin de la quincena");
        }
        // Las fechas quedan libres (no fijas en 1-15/16-fin de mes) porque
        // cada obra puede acordar limites de quincena distintos. anio/mes
        // se calculan de la fecha de inicio (igual que en SEMANAL) en vez
        // de pedirse aparte: si se mostraran como campos independientes,
        // quedaria facil elegir fechas de un mes y dejar el Año/Mes en el
        // valor por defecto de otro, usando sin querer la tabla salarial
        // equivocada al calcular.
        const [anioCalc, mesCalc] = fechaInicio.split("-").map(Number);
        await apiPost<PeriodoPlanilla>("/periodos", {
          anio: anioCalc,
          mes: mesCalc,
          quincena,
          tipo: "QUINCENAL",
          fecha_inicio: fechaInicio,
          fecha_fin: fechaFin,
          proyecto: proyectoEnviado,
        });
      } else {
        if (!fechaInicio || !fechaFin) {
          throw new Error("Ingresa la fecha de inicio y de fin de la semana");
        }
        // anio/mes de un periodo semanal se calculan del mes calendario en
        // que inicia la semana (mismo criterio que usa el sistema para
        // decidir que tabla salarial/tasas AFP de ese mes le corresponden).
        // No se le pide anio/mes por separado al usuario para no duplicar
        // informacion que ya esta implicita en la fecha de inicio elegida.
        const [anioCalc, mesCalc] = fechaInicio.split("-").map(Number);
        await apiPost<PeriodoPlanilla>("/periodos", {
          anio: anioCalc,
          mes: mesCalc,
          tipo: "SEMANAL",
          fecha_inicio: fechaInicio,
          fecha_fin: fechaFin,
          proyecto: proyectoEnviado,
        });
      }
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreando(false);
    }
  }

  const etiquetaBoton =
    tipo === "MENSUAL" ? "Crear periodo mensual" : tipo === "QUINCENAL" ? "Crear periodo quincenal" : "Crear periodo semanal";

  return (
    <div>
      <div className="card">
        <h2>Nuevo periodo de planilla</h2>
        {error && <div className="mensaje-error">{error}</div>}
        <form onSubmit={crearPeriodo}>
          <div className="form-grid">
            <label>
              Tipo de periodo
              <select value={tipo} onChange={(e) => cambiarTipo(e.target.value as TipoPeriodo)}>
                <option value="MENSUAL">Mensual</option>
                <option value="QUINCENAL">Quincenal</option>
                <option value="SEMANAL">Semanal (obreros de jornal)</option>
              </select>
            </label>

            <label>
              Proyecto
              <select value={proyecto} onChange={(e) => setProyecto(e.target.value)} required={!esAdmin}>
                {esAdmin && <option value="">Todos los proyectos (legado)</option>}
                {!esAdmin && proyecto === "" && <option value="">Selecciona un proyecto...</option>}
                {proyectosDisponibles.map((p) => (
                  <option key={p.id} value={p.nombre}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </label>

            {tipo === "MENSUAL" && (
              <>
                <label>
                  Año
                  <input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))} />
                </label>
                <label>
                  Mes
                  <select value={mes} onChange={(e) => setMes(Number(e.target.value))}>
                    {MESES.map((nombre, idx) => (
                      <option key={nombre} value={idx + 1}>
                        {nombre}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}

            {tipo === "QUINCENAL" && (
              <label>
                Quincena
                <select value={quincena} onChange={(e) => setQuincena(Number(e.target.value) as 1 | 2)}>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </label>
            )}

            {tipo !== "MENSUAL" && (
              <>
                <label>
                  Fecha de inicio
                  <input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
                </label>
                <label>
                  Fecha de fin
                  <input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
                </label>
              </>
            )}
          </div>

          {tipo !== "MENSUAL" && (
            <p style={{ color: "#5a6172", fontSize: "0.86rem", marginTop: -6, marginBottom: 14 }}>
              {tipo === "QUINCENAL"
                ? "Las fechas se pueden ajustar libremente si la quincena acordada con la obra no es del 1 al 15 / 16 al fin de mes."
                : "Elige el rango exacto de la semana segun lo acordado con la obra o proyecto (no necesariamente de lunes a domingo)."}
            </p>
          )}

          <button className="primario" type="submit" disabled={creando}>
            {creando ? "Creando..." : etiquetaBoton}
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Periodos existentes</h2>
        <table>
          <thead>
            <tr>
              <th>Periodo</th>
              <th>Tipo</th>
              <th>Proyecto</th>
              <th>Desde</th>
              <th>Hasta</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {periodos.map((p) => {
              const enEdicion = editandoId === p.id;
              const datosEdicion = edicion[p.id];
              return (
                <tr key={p.id}>
                  <td>{MESES[p.mes - 1]} {p.anio}</td>
                  <td>{p.tipo}</td>
                  <td>
                    {enEdicion && datosEdicion ? (
                      <select
                        value={datosEdicion.proyecto}
                        onChange={(e) =>
                          setEdicion((prev) => ({ ...prev, [p.id]: { ...prev[p.id], proyecto: e.target.value } }))
                        }
                      >
                        {esAdmin && <option value="">Todos los proyectos (legado)</option>}
                        {proyectosDisponibles.map((pr) => (
                          <option key={pr.id} value={pr.nombre}>
                            {pr.nombre}
                          </option>
                        ))}
                      </select>
                    ) : (
                      p.proyecto ?? "Todos los proyectos (legado)"
                    )}
                  </td>
                  <td>
                    {enEdicion && datosEdicion ? (
                      <input
                        type="date"
                        value={datosEdicion.fecha_inicio}
                        onChange={(e) =>
                          setEdicion((prev) => ({ ...prev, [p.id]: { ...prev[p.id], fecha_inicio: e.target.value } }))
                        }
                      />
                    ) : (
                      p.fecha_inicio?.slice(0, 10)
                    )}
                  </td>
                  <td>
                    {enEdicion && datosEdicion ? (
                      <input
                        type="date"
                        value={datosEdicion.fecha_fin}
                        onChange={(e) =>
                          setEdicion((prev) => ({ ...prev, [p.id]: { ...prev[p.id], fecha_fin: e.target.value } }))
                        }
                      />
                    ) : (
                      p.fecha_fin?.slice(0, 10)
                    )}
                  </td>
                  <td>{p.estado}</td>
                  <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {enEdicion ? (
                      <>
                        <button
                          className="primario"
                          type="button"
                          onClick={() => guardarEdicion(p)}
                          disabled={guardandoEdicionId === p.id}
                        >
                          {guardandoEdicionId === p.id ? "Guardando..." : "Guardar"}
                        </button>
                        <button type="button" onClick={cancelarEdicion} disabled={guardandoEdicionId === p.id}>
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        {onCargarTareo && (
                          <button className="primario" onClick={() => onCargarTareo(p)}>
                            Cargar tareo
                          </button>
                        )}
                        {onTareoDiario && (
                          <button type="button" onClick={() => onTareoDiario(p)}>
                            Tareo diario
                          </button>
                        )}
                        {onCalcular && (
                          <button type="button" onClick={() => onCalcular(p)}>
                            Calcular
                          </button>
                        )}
                        {p.estado === "CALCULADO" && (
                          <>
                            <a href={conToken(`${BASE_URL}/periodos/${p.id}/exportar/rem`)}>
                              <button type="button">Descargar REM (PLAME)</button>
                            </a>
                            <a href={conToken(`${BASE_URL}/periodos/${p.id}/exportar/afpnet`)}>
                              <button type="button">Descargar AFPnet (CSV)</button>
                            </a>
                          </>
                        )}
                        {p.estado === "ABIERTO" && (
                          <>
                            <button type="button" onClick={() => iniciarEdicion(p)}>
                              Editar
                            </button>
                            <button type="button" onClick={() => eliminarPeriodo(p)}>
                              Eliminar
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
