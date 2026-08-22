import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api";
import { AsistenciaEntrada, Contrato, DetallePlanilla, PeriodoPlanilla } from "../types";
import Boleta from "./Boleta";

interface Props {
  periodo: PeriodoPlanilla;
}

type FilaAsistencia = AsistenciaEntrada & {
  apellidos_nombres: string;
  numero_documento: string;
};

export default function Planilla({ periodo }: Props) {
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [filas, setFilas] = useState<Record<number, FilaAsistencia>>({});
  const [resultado, setResultado] = useState<DetallePlanilla[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [boletaSeleccionada, setBoletaSeleccionada] = useState<DetallePlanilla | null>(null);

  useEffect(() => {
    async function cargar() {
      const [listaContratos, planillaExistente] = await Promise.all([
        apiGet<Contrato[]>("/contratos?estado=HABIL"),
        apiGet<{ detalle: DetallePlanilla[] }>(`/periodos/${periodo.id}/planilla`),
      ]);
      setContratos(listaContratos);
      setResultado(planillaExistente.detalle);

      const inicial: Record<number, FilaAsistencia> = {};
      for (const c of listaContratos) {
        const previo = planillaExistente.detalle.find((d) => d.contrato_id === c.id);
        inicial[c.id] = {
          contrato_id: c.id,
          apellidos_nombres: c.apellidos_nombres ?? "",
          numero_documento: c.numero_documento ?? "",
          dias_trabajados: previo?.dias_trabajados ?? 30,
          dias_dominical: 0,
          dias_feriado: 0,
          dias_falta: 0,
          horas_extra_25: 0,
          horas_extra_35: 0,
          horas_extra_100: 0,
        };
      }
      setFilas(inicial);
    }
    cargar().catch((e) => setError((e as Error).message));
  }, [periodo.id]);

  function actualizarFila(contratoId: number, campo: keyof AsistenciaEntrada, valor: number) {
    setFilas((prev) => ({
      ...prev,
      [contratoId]: { ...prev[contratoId], [campo]: valor },
    }));
  }

  async function calcularPlanilla() {
    setError(null);
    setCalculando(true);
    try {
      const asistencias = Object.values(filas).map(
        ({ apellidos_nombres, numero_documento, ...resto }) => resto
      );
      const respuesta = await apiPost<{ detalle: DetallePlanilla[] }>(
        `/periodos/${periodo.id}/calcular`,
        { asistencias }
      );
      // el endpoint de calculo no trae los datos del empleado, recargamos la vista con join
      const planillaActualizada = await apiGet<{ detalle: DetallePlanilla[] }>(
        `/periodos/${periodo.id}/planilla`
      );
      setResultado(planillaActualizada.detalle);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCalculando(false);
    }
  }

  const totales = resultado.reduce(
    (acc, d) => ({
      ingresos: acc.ingresos + Number(d.total_ingresos),
      descuentos: acc.descuentos + Number(d.total_descuentos),
      neto: acc.neto + Number(d.neto_pagar),
    }),
    { ingresos: 0, descuentos: 0, neto: 0 }
  );

  return (
    <div>
      {error && <div className="mensaje-error">{error}</div>}

      <div className="card">
        <h2>
          Asistencia del periodo — {periodo.mes}/{periodo.anio}
        </h2>
        <table>
          <thead>
            <tr>
              <th>Trabajador</th>
              <th>Dias trab.</th>
              <th>Dominical</th>
              <th>Feriado</th>
              <th>Faltas</th>
              <th>H.E. 25%</th>
              <th>H.E. 35%</th>
              <th>H.E. 100%</th>
            </tr>
          </thead>
          <tbody>
            {contratos.map((c) => {
              const fila = filas[c.id];
              if (!fila) return null;
              return (
                <tr key={c.id}>
                  <td>{c.apellidos_nombres}</td>
                  {(
                    [
                      "dias_trabajados",
                      "dias_dominical",
                      "dias_feriado",
                      "dias_falta",
                      "horas_extra_25",
                      "horas_extra_35",
                      "horas_extra_100",
                    ] as (keyof AsistenciaEntrada)[]
                  ).map((campo) => (
                    <td key={campo}>
                      <input
                        type="number"
                        min={0}
                        value={fila[campo]}
                        onChange={(e) => actualizarFila(c.id, campo, Number(e.target.value))}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ marginTop: 16 }}>
          <button className="primario" onClick={calcularPlanilla} disabled={calculando || contratos.length === 0}>
            {calculando ? "Calculando..." : "Calcular planilla"}
          </button>
        </div>
      </div>

      {resultado.length > 0 && (
        <div className="card">
          <h2>Resultado</h2>
          <table>
            <thead>
              <tr>
                <th>DNI</th>
                <th>Trabajador</th>
                <th>Categoria</th>
                <th>Total ingresos</th>
                <th>Total descuentos</th>
                <th>Neto a pagar</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {resultado.map((d) => (
                <tr key={d.id}>
                  <td>{d.numero_documento}</td>
                  <td>{d.apellidos_nombres}</td>
                  <td>{d.categoria_ocupacional}</td>
                  <td>S/ {Number(d.total_ingresos).toFixed(2)}</td>
                  <td>S/ {Number(d.total_descuentos).toFixed(2)}</td>
                  <td>S/ {Number(d.neto_pagar).toFixed(2)}</td>
                  <td>
                    <button type="button" onClick={() => setBoletaSeleccionada(d)}>
                      Ver boleta
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="totales-fila">
                <td colSpan={3}>Totales</td>
                <td>S/ {totales.ingresos.toFixed(2)}</td>
                <td>S/ {totales.descuentos.toFixed(2)}</td>
                <td>S/ {totales.neto.toFixed(2)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {boletaSeleccionada && (
        <Boleta
          detalle={boletaSeleccionada}
          periodo={periodo}
          onCerrar={() => setBoletaSeleccionada(null)}
        />
      )}
    </div>
  );
}
