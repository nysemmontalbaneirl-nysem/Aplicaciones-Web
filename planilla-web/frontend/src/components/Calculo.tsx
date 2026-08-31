import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api";
import { AsistenciaTareo, PeriodoPlanilla } from "../types";

interface Props {
  periodo: PeriodoPlanilla;
  onVerBoletas: () => void;
}

interface ErrorCalculo {
  contrato_id: number;
  dni: string;
  nombre: string;
  motivo: string;
}

interface AvisoSubsidio {
  contrato_id: number;
  dni: string;
  nombre: string;
  dias_subsidio_enfermedad: number;
  dias_subsidio_maternidad: number;
  dias_licencia_paternidad: number;
}

export default function Calculo({ periodo, onVerBoletas }: Props) {
  const [cantidadTareo, setCantidadTareo] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [resultado, setResultado] = useState<{ trabajadores_calculados: number } | null>(null);
  const [erroresCalculo, setErroresCalculo] = useState<ErrorCalculo[]>([]);
  const [avisosSubsidio, setAvisosSubsidio] = useState<AvisoSubsidio[]>([]);

  useEffect(() => {
    setResultado(null);
    setErroresCalculo([]);
    setAvisosSubsidio([]);
    setError(null);
    apiGet<{ tareo: AsistenciaTareo[] }>(`/periodos/${periodo.id}/tareo`)
      .then((d) => setCantidadTareo(d.tareo.length))
      .catch((e) => setError((e as Error).message));
  }, [periodo.id]);

  async function calcular() {
    setError(null);
    setErroresCalculo([]);
    setAvisosSubsidio([]);
    setCalculando(true);
    try {
      const respuesta = await apiPost<{
        trabajadores_calculados: number;
        errores: ErrorCalculo[];
        avisos_subsidio: AvisoSubsidio[];
      }>(`/periodos/${periodo.id}/calcular`, {});
      setResultado({ trabajadores_calculados: respuesta.trabajadores_calculados });
      setErroresCalculo(respuesta.errores ?? []);
      setAvisosSubsidio(respuesta.avisos_subsidio ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCalculando(false);
    }
  }

  return (
    <div>
      {error && <div className="mensaje-error">{error}</div>}

      <div className="card">
        <h2>
          Calcular planilla — {periodo.mes}/{periodo.anio}
        </h2>
        {cantidadTareo === null ? (
          <p>Cargando...</p>
        ) : cantidadTareo === 0 ? (
          <p style={{ color: "#5a6172" }}>
            Todavia no hay tareo cargado para este periodo. Ve a la pestana Tareo primero.
          </p>
        ) : (
          <p style={{ color: "#5a6172" }}>
            Hay {cantidadTareo} trabajadores con tareo cargado en este periodo. Al calcular, se
            genera (o se actualiza) la boleta de cada uno de ellos.
          </p>
        )}
        <button className="primario" onClick={calcular} disabled={calculando || !cantidadTareo}>
          {calculando ? "Calculando..." : "Calcular planilla"}
        </button>

        {resultado && (
          <div className="mensaje-ok" style={{ marginTop: 16 }}>
            {resultado.trabajadores_calculados} trabajadores calculados correctamente.{" "}
            <button type="button" onClick={onVerBoletas}>
              Ver boletas
            </button>
          </div>
        )}

        {erroresCalculo.length > 0 && (
          <>
            <h3>Trabajadores no calculados ({erroresCalculo.length})</h3>
            <p style={{ color: "#5a6172", fontSize: "0.88rem" }}>
              El resto de la planilla se calculo con normalidad. Corrige los datos de estos
              trabajadores (en la pestana Trabajadores) y vuelve a presionar "Calcular planilla".
            </p>
            <table>
              <thead>
                <tr>
                  <th>DNI</th>
                  <th>Trabajador</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {erroresCalculo.map((e) => (
                  <tr key={e.contrato_id}>
                    <td>{e.dni}</td>
                    <td>{e.nombre}</td>
                    <td>{e.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {avisosSubsidio.length > 0 && (
          <>
            <h3>Trabajadores con dias de subsidio/licencia este periodo ({avisosSubsidio.length})</h3>
            <div className="mensaje-advertencia" style={{ marginBottom: 12 }}>
              El calculo NO ajusto automaticamente el monto ni los aportes por estos dias
              (descanso medico, maternidad o paternidad) — revisa cada boleta a mano segun la
              regla legal (dias 1-20 los paga la empresa igual que un dia trabajado y con
              aportes normales, desde el dia 21 lo asume EsSalud sobre el promedio de los
              ultimos 4 meses y sin aportes; maternidad desde el dia 1).
            </div>
            <table>
              <thead>
                <tr>
                  <th>DNI</th>
                  <th>Trabajador</th>
                  <th>Dias subs. enfermedad</th>
                  <th>Dias subs. maternidad</th>
                  <th>Dias lic. paternidad</th>
                </tr>
              </thead>
              <tbody>
                {avisosSubsidio.map((a) => (
                  <tr key={a.contrato_id}>
                    <td>{a.dni}</td>
                    <td>{a.nombre}</td>
                    <td>{a.dias_subsidio_enfermedad}</td>
                    <td>{a.dias_subsidio_maternidad}</td>
                    <td>{a.dias_licencia_paternidad}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
