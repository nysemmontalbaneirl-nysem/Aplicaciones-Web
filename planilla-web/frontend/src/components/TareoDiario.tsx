import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPut } from "../api";
import {
  Contrato,
  esConstruccionCivil,
  FactoresHorasExtra,
  PeriodoPlanilla,
  porcentajeRecargo,
  TareoDiarioFila,
  TipoDiaEspecial,
} from "../types";

interface Props {
  periodo: PeriodoPlanilla;
}

const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];

const OPCIONES_DIA_ESPECIAL: { valor: TipoDiaEspecial | ""; etiqueta: string }[] = [
  { valor: "", etiqueta: "" },
  { valor: "FALTA", etiqueta: "Falta" },
  { valor: "SUBSIDIO_ENFERMEDAD", etiqueta: "Subsidio enfermedad" },
  { valor: "SUBSIDIO_MATERNIDAD", etiqueta: "Subsidio maternidad" },
  { valor: "LICENCIA_PATERNIDAD", etiqueta: "Licencia paternidad" },
];

// "YYYY-MM-DD" -> Date en hora local (evita el corrimiento de un dia que da
// "new Date('YYYY-MM-DD')", que Javascript interpreta en UTC).
function fechaLocal(fechaIso: string): Date {
  const [anio, mes, dia] = fechaIso.split("-").map(Number);
  return new Date(anio, mes - 1, dia);
}

function formatearFechaIso(d: Date): string {
  const anio = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}

function diasDelPeriodo(periodo: PeriodoPlanilla): string[] {
  const fechas: string[] = [];
  const actual = fechaLocal(periodo.fecha_inicio.slice(0, 10));
  const fin = fechaLocal(periodo.fecha_fin.slice(0, 10));
  while (actual <= fin) {
    fechas.push(formatearFechaIso(actual));
    actual.setDate(actual.getDate() + 1);
  }
  return fechas;
}

function filaVacia(fecha: string): TareoDiarioFila {
  return {
    fecha,
    horas_normales: 0,
    minutos_normales: 0,
    horas_dominical: 0,
    minutos_dominical: 0,
    horas_feriado: 0,
    minutos_feriado: 0,
    horas_extra_tramo1: 0,
    minutos_extra_tramo1: 0,
    horas_extra_tramo2: 0,
    minutos_extra_tramo2: 0,
    horas_extra_tramo3: 0,
    minutos_extra_tramo3: 0,
    tipo_dia_especial: null,
  };
}

type CampoHoras = Exclude<keyof TareoDiarioFila, "fecha" | "tipo_dia_especial">;

export default function TareoDiario({ periodo }: Props) {
  const [contratosDisponibles, setContratosDisponibles] = useState<Contrato[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [contratoSeleccionado, setContratoSeleccionado] = useState<Contrato | null>(null);
  const [dias, setDias] = useState<TareoDiarioFila[]>([]);
  const [factores, setFactores] = useState<FactoresHorasExtra | null>(null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const buscadorRef = useRef<HTMLInputElement>(null);
  function irABuscador() {
    buscadorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    buscadorRef.current?.focus();
  }

  useEffect(() => {
    apiGet<Contrato[]>("/contratos?estado=HABIL")
      .then(setContratosDisponibles)
      .catch((e) => setError((e as Error).message));
    apiGet<FactoresHorasExtra>("/conceptos/horas-extra")
      .then(setFactores)
      .catch(() => {
        // Si no se pudo traer (ej. sin permiso), se muestran los tramos sin
        // porcentaje ("Horas extra tramo 1", etc.) - no bloquea la pantalla.
      });
  }, []);

  const contratosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (q.length < 2) return [];
    return contratosDisponibles
      .filter(
        (c) =>
          c.numero_documento?.toLowerCase().includes(q) ||
          c.apellidos_nombres?.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [busqueda, contratosDisponibles]);

  async function elegirTrabajador(c: Contrato) {
    setContratoSeleccionado(c);
    setBusqueda("");
    setError(null);
    setOk(null);
    setCargando(true);
    try {
      const respuesta = await apiGet<{ dias: TareoDiarioFila[] }>(`/periodos/${periodo.id}/tareo-diario/${c.id}`);
      const porFecha = new Map(respuesta.dias.map((d) => [d.fecha.slice(0, 10), d]));
      const grilla = diasDelPeriodo(periodo).map((fecha) => porFecha.get(fecha) ?? filaVacia(fecha));
      setDias(grilla);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  function actualizarHoras(fecha: string, campo: CampoHoras, valor: number) {
    setDias((prev) =>
      prev.map((f) => (f.fecha === fecha ? { ...f, [campo]: Math.max(0, valor || 0) } : f))
    );
  }

  function actualizarTipoDia(fecha: string, valor: TipoDiaEspecial | "") {
    setDias((prev) => prev.map((f) => (f.fecha === fecha ? { ...f, tipo_dia_especial: valor || null } : f)));
  }

  async function guardar() {
    if (!contratoSeleccionado) return;
    setGuardando(true);
    setError(null);
    setOk(null);
    try {
      await apiPut(`/periodos/${periodo.id}/tareo-diario/${contratoSeleccionado.id}`, { dias });
      setOk(`Tareo diario de ${contratoSeleccionado.apellidos_nombres} guardado correctamente.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  const construccionCivil = contratoSeleccionado ? esConstruccionCivil(contratoSeleccionado.categoria_ocupacional) : true;
  const factoresRegimen = factores ? (construccionCivil ? factores.construccion : factores.general) : null;
  const etiquetaTramo1 = `Horas extra tramo 1${factoresRegimen ? ` (${porcentajeRecargo(factoresRegimen.factor1)})` : ""}`;
  const etiquetaTramo2 = `Horas extra tramo 2${factoresRegimen ? ` (${porcentajeRecargo(factoresRegimen.factor2)})` : ""}`;
  const etiquetaTramo3 = `Horas extra tramo 3${factoresRegimen ? ` (${porcentajeRecargo(factoresRegimen.factor3)})` : ""}`;

  return (
    <div>
      <div className="barra-accesos-rapidos">
        <button type="button" onClick={irABuscador}>
          Ir al buscador de trabajador
        </button>
      </div>

      {error && <div className="mensaje-error">{error}</div>}
      {ok && <div className="mensaje-ok">{ok}</div>}

      <div className="card">
        <h2>
          Registrar Tareo Diario — {periodo.mes}/{periodo.anio}
        </h2>
        <p style={{ color: "#5a6172", fontSize: "0.88rem" }}>
          Busca a un trabajador para registrar su asistencia dia por dia de este periodo (horas y
          minutos separados). Esto se suma automaticamente a los totales del tareo del periodo,
          igual que si se hubieran cargado por Excel o a mano.
        </p>
        <div style={{ position: "relative", maxWidth: 400 }}>
          <label>
            Buscar trabajador (por DNI o nombre)
            <input
              ref={buscadorRef}
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar..."
            />
          </label>
          {contratosFiltrados.length > 0 && (
            <div className="lista-sugerencias">
              {contratosFiltrados.map((c) => (
                <div key={c.id} className="sugerencia" onClick={() => elegirTrabajador(c)}>
                  {c.numero_documento} — {c.apellidos_nombres} ({c.proyecto})
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {contratoSeleccionado && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h2>
              {contratoSeleccionado.apellidos_nombres} — {contratoSeleccionado.numero_documento} (
              {contratoSeleccionado.proyecto})
            </h2>
            <button className="primario" type="button" disabled={guardando || cargando} onClick={guardar}>
              {guardando ? "Guardando..." : "Guardar"}
            </button>
          </div>

          {cargando ? (
            <p>Cargando...</p>
          ) : (
            <div className="tabla-tareo-diario" style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Dia</th>
                    <th>Jornal normal (H/M)</th>
                    <th>Domingo trabajado (H/M)</th>
                    <th>Feriado trabajado (H/M)</th>
                    <th>{etiquetaTramo1} (H/M)</th>
                    <th>{etiquetaTramo2} (H/M)</th>
                    <th>{etiquetaTramo3} (H/M)</th>
                    <th>Dia especial</th>
                  </tr>
                </thead>
                <tbody>
                  {dias.map((fila) => {
                    const esEspecial = fila.tipo_dia_especial !== null;
                    return (
                      <tr key={fila.fecha}>
                        <td>{fila.fecha}</td>
                        <td>{DIAS_SEMANA[fechaLocal(fila.fecha).getDay()]}</td>
                        {(
                          [
                            ["horas_normales", "minutos_normales"],
                            ["horas_dominical", "minutos_dominical"],
                            ["horas_feriado", "minutos_feriado"],
                            ["horas_extra_tramo1", "minutos_extra_tramo1"],
                            ["horas_extra_tramo2", "minutos_extra_tramo2"],
                            ["horas_extra_tramo3", "minutos_extra_tramo3"],
                          ] as [CampoHoras, CampoHoras][]
                        ).map(([campoHoras, campoMinutos]) => (
                          <td key={campoHoras}>
                            <input
                              type="number"
                              min={0}
                              disabled={esEspecial}
                              style={{ width: 48 }}
                              value={fila[campoHoras]}
                              onChange={(e) => actualizarHoras(fila.fecha, campoHoras, Number(e.target.value))}
                            />
                            {" h "}
                            <input
                              type="number"
                              min={0}
                              max={59}
                              disabled={esEspecial}
                              style={{ width: 48 }}
                              value={fila[campoMinutos]}
                              onChange={(e) => actualizarHoras(fila.fecha, campoMinutos, Number(e.target.value))}
                            />
                            {" m"}
                          </td>
                        ))}
                        <td>
                          <select
                            value={fila.tipo_dia_especial ?? ""}
                            onChange={(e) => actualizarTipoDia(fila.fecha, e.target.value as TipoDiaEspecial | "")}
                          >
                            {OPCIONES_DIA_ESPECIAL.map((o) => (
                              <option key={o.valor} value={o.valor}>
                                {o.etiqueta}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ color: "#5a6172", fontSize: "0.82rem", marginTop: 12 }}>
            Los dias marcados como Falta, Subsidio o Licencia no necesitan horas: no se calcula
            jornal ese dia. El monto del subsidio/licencia y sus aportes se revisan manualmente
            por ahora — este registro solo avisa cuando calculas la planilla.
          </p>
        </div>
      )}
    </div>
  );
}
