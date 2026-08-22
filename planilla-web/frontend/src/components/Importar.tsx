import { useState } from "react";
import { BASE_URL } from "../api";

interface ErrorFila {
  fila: number;
  dni: string;
  motivo: string;
}

interface ResultadoImportacion {
  total_filas: number;
  empleados_creados: number;
  empleados_actualizados: number;
  contratos_creados: number;
  errores: ErrorFila[];
}

const COLUMNAS_ESPERADAS = [
  "DNI", "APELLIDOS_NOMBRES", "FECHA_NACIMIENTO", "GRADO_INSTRUCCION", "NUMERO_HIJOS",
  "CELULAR", "CORREO", "DIRECCION", "UBIGEO", "ENTIDAD_BANCARIA", "CUENTA_BANCARIA",
  "PROYECTO", "GRUPO", "CATEGORIA", "OCUPACION", "SISTEMA_PENSION", "AFP_NOMBRE",
  "CUSPP", "SISTEMA_COMISION", "FECHA_INGRESO", "FECHA_CESE", "SUELDO_BASE", "VIATICOS",
  "SINDICALIZADO", "POLIZA_SEGURO", "SCTR_SALUD", "ESSALUD_VIDA", "ESTADO",
];

export default function Importar() {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function subirArchivo(e: React.FormEvent) {
    e.preventDefault();
    if (!archivo) return;
    setError(null);
    setResultado(null);
    setSubiendo(true);
    try {
      const formData = new FormData();
      formData.append("archivo", archivo);
      const res = await fetch(`${BASE_URL}/empleados/importar-masivo`, {
        method: "POST",
        body: formData,
      });
      const cuerpo = await res.json();
      if (!res.ok) throw new Error(cuerpo.error ?? `Error ${res.status}`);
      setResultado(cuerpo);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Importar trabajadores desde CSV</h2>
        <p style={{ color: "#5a6172", fontSize: "0.88rem" }}>
          Sube un archivo CSV con encabezado en la primera fila. Cada fila crea (o actualiza,
          si el DNI ya existe) un empleado y su contrato. Las filas con errores se reportan
          abajo sin detener la importación del resto.
        </p>
        {error && <div className="mensaje-error">{error}</div>}

        <form onSubmit={subirArchivo}>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
          />
          <div style={{ marginTop: 12 }}>
            <button className="primario" type="submit" disabled={!archivo || subiendo}>
              {subiendo ? "Importando..." : "Importar"}
            </button>
          </div>
        </form>

        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: "pointer", color: "#2f6fed" }}>
            Ver columnas esperadas en el CSV
          </summary>
          <div style={{ marginTop: 8, fontSize: "0.82rem", color: "#5a6172" }}>
            {COLUMNAS_ESPERADAS.join(", ")}
          </div>
        </details>
      </div>

      {resultado && (
        <div className="card">
          <h2>Resultado de la importación</h2>
          <div className="mensaje-ok">
            {resultado.total_filas} filas procesadas — {resultado.empleados_creados} empleados
            nuevos, {resultado.empleados_actualizados} actualizados, {resultado.contratos_creados}{" "}
            contratos creados.
          </div>

          {resultado.errores.length > 0 && (
            <>
              <h3>Filas con error ({resultado.errores.length})</h3>
              <table>
                <thead>
                  <tr>
                    <th>Fila</th>
                    <th>DNI</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.errores.map((e, idx) => (
                    <tr key={idx}>
                      <td>{e.fila}</td>
                      <td>{e.dni}</td>
                      <td>{e.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
