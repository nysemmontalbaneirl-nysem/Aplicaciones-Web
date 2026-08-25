import { useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, BASE_URL, conToken } from "../api";
import { PeriodoPlanilla } from "../types";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre",
];

function primerDia(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, "0")}-01`;
}

function ultimoDia(anio: number, mes: number): string {
  const fecha = new Date(anio, mes, 0);
  return `${anio}-${String(mes).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;
}

interface Props {
  onCargarTareo?: (p: PeriodoPlanilla) => void;
  onCalcular?: (p: PeriodoPlanilla) => void;
}

export default function Periodos({ onCargarTareo, onCalcular }: Props) {
  const [periodos, setPeriodos] = useState<PeriodoPlanilla[]>([]);
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  async function cargar() {
    try {
      const datos = await apiGet<PeriodoPlanilla[]>("/periodos");
      setPeriodos(datos);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

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

  async function crearPeriodo(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreando(true);
    try {
      // dias_periodo lo calcula el backend a partir de fecha_inicio/fecha_fin
      // (dias calendario reales del mes: 28, 29, 30 o 31).
      await apiPost<PeriodoPlanilla>("/periodos", {
        anio,
        mes,
        tipo: "MENSUAL",
        fecha_inicio: primerDia(anio, mes),
        fecha_fin: ultimoDia(anio, mes),
      });
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreando(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Nuevo periodo de planilla</h2>
        {error && <div className="mensaje-error">{error}</div>}
        <form onSubmit={crearPeriodo}>
          <div className="form-grid">
            <label>
              Año
              <input
                type="number"
                value={anio}
                onChange={(e) => setAnio(Number(e.target.value))}
              />
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
          </div>
          <button className="primario" type="submit" disabled={creando}>
            {creando ? "Creando..." : "Crear periodo mensual"}
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
              <th>Desde</th>
              <th>Hasta</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {periodos.map((p) => (
              <tr key={p.id}>
                <td>{MESES[p.mes - 1]} {p.anio}</td>
                <td>{p.tipo}</td>
                <td>{p.fecha_inicio?.slice(0, 10)}</td>
                <td>{p.fecha_fin?.slice(0, 10)}</td>
                <td>{p.estado}</td>
                <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {onCargarTareo && (
                    <button className="primario" onClick={() => onCargarTareo(p)}>
                      Cargar tareo
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
                    <button type="button" onClick={() => eliminarPeriodo(p)}>
                      Eliminar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
