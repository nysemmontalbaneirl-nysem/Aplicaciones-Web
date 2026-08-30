import { useState } from "react";
import { apiPostArchivo, BASE_URL, conToken } from "../api";

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
  contratos_actualizados: number;
  errores: ErrorFila[];
}

const COLUMNAS_ESPERADAS = [
  "DNI", "APELLIDOS_NOMBRES", "FECHA_NACIMIENTO", "GRADO_INSTRUCCION", "NUMERO_HIJOS",
  "CELULAR", "CORREO", "DIRECCION", "UBIGEO", "ENTIDAD_BANCARIA", "CUENTA_BANCARIA",
  "PROYECTO", "GRUPO", "CATEGORIA", "OCUPACION", "SISTEMA_PENSION", "AFP_NOMBRE",
  "CUSPP", "SISTEMA_COMISION", "FECHA_INGRESO", "FECHA_CESE", "SUELDO_BASE", "VIATICOS",
  "SINDICALIZADO", "POLIZA_SEGURO", "SCTR_SALUD", "ESSALUD_VIDA", "ESTADO",
];

// Columnas nuevas de T-Registro (SUNAT): opcionales, van por el CODIGO del
// catalogo (el mismo que se ve en los desplegables del alta individual),
// no por el nombre/texto. Si no se incluyen, la fila se procesa igual que
// antes y esos datos se pueden completar despues editando el trabajador.
const COLUMNAS_SUNAT_OPCIONALES = [
  "SEXO", "ESTADO_CIVIL", "NACIONALIDAD_CODIGO", "PAIS_EMISOR_DOCUMENTO_CODIGO",
  "GRADO_INSTRUCCION_CODIGO", "ENTIDAD_BANCARIA_CODIGO", "DISCAPACIDAD",
  "SEGUNDA_DIRECCION", "DIRECCION_ESSALUD", "UBIGEO_DEPARTAMENTO_CODIGO",
  "UBIGEO_PROVINCIA_CODIGO", "UBIGEO_DISTRITO_CODIGO",
  "CATEGORIA_OCUPACIONAL_SUNAT_CODIGO", "TIPO_TRABAJADOR_CODIGO", "REGIMEN_LABORAL_CODIGO",
  "TIPO_CONTRATO_CODIGO", "TIPO_PAGO_CODIGO", "PERIODICIDAD_CODIGO",
  "SITUACION_ESPECIAL_CODIGO", "JORNADA_LABORAL", "REGIMEN_SALUD_CODIGO", "EPS_CODIGO",
  "MOTIVO_BAJA_CODIGO",
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
      const cuerpo = await apiPostArchivo<ResultadoImportacion>("/empleados/importar-masivo", formData);
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
        <p style={{ color: "#5a6172", fontSize: "0.88rem" }}>
          <strong>También puedes usar esta plantilla para dar de baja (cesar) trabajadores en
          lote:</strong> en la fila del trabajador ya existente (mismo DNI, PROYECTO y
          FECHA_INGRESO que su contrato actual), pon <strong>ESTADO = CESADO</strong>, completa{" "}
          <strong>FECHA_CESE</strong> (obligatoria en ese caso) y, si aplica,{" "}
          <strong>MOTIVO_BAJA_CODIGO</strong>. El sistema actualiza ese contrato en vez de crear
          uno nuevo. Por seguridad, la carga masiva nunca revierte un cese ya registrado: si el
          contrato ya está CESADO y la fila trae ESTADO=HABIL (o lo deja vacío), esa fila se
          ignora sin generar error.
        </p>

        <div style={{ margin: "12px 0" }}>
          <a
            href={conToken(`${BASE_URL}/empleados/importar-masivo/plantilla.xlsx`)}
            className="primario"
            style={{ display: "inline-block", textDecoration: "none" }}
          >
            Descargar plantilla en Excel
          </a>
          <p style={{ marginTop: 8, marginBottom: 0, fontSize: "0.82rem", color: "#5a6172" }}>
            Trae todas las columnas (incluidas las de T-Registro/SUNAT) listas para llenar, una
            <strong> fila de ejemplo resaltada</strong> con datos ficticios (DNI 00000000) que
            muestra el formato correcto de cada columna — <strong>bórrala antes de importar</strong>{" "}
            — y una hoja de referencia por cada catálogo (código y nombre: banco, ubigeo, tipo de
            contrato, EPS, etc.). Una vez llena, en Excel usa <strong>Archivo → Guardar como</strong>{" "}
            y elige el formato <strong>CSV UTF-8 (delimitado por comas)</strong> antes de subirla
            aquí — el sistema solo acepta CSV, no .xlsx.
          </p>
        </div>

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
          <p style={{ marginTop: 12, marginBottom: 4, fontSize: "0.88rem" }}>
            <strong>Columnas T-Registro (SUNAT) - opcionales:</strong>
          </p>
          <p style={{ marginTop: 0, marginBottom: 4, fontSize: "0.82rem", color: "#5a6172" }}>
            Van por el CODIGO del catalogo (el mismo que se ve en los desplegables del alta
            individual: Trabajadores → Nuevo trabajador), no por el nombre. Ej.
            ENTIDAD_BANCARIA_CODIGO = "002" para BCP, UBIGEO_DISTRITO_CODIGO = "190307". Si no
            incluyes estas columnas, la fila se procesa igual que antes y esos datos se pueden
            completar después editando el trabajador uno por uno.
          </p>
          <div style={{ marginTop: 8, fontSize: "0.82rem", color: "#5a6172" }}>
            {COLUMNAS_SUNAT_OPCIONALES.join(", ")}
          </div>
        </details>
      </div>

      {resultado && (
        <div className="card">
          <h2>Resultado de la importación</h2>
          <div className="mensaje-ok">
            {resultado.total_filas} filas procesadas — {resultado.empleados_creados} empleados
            nuevos, {resultado.empleados_actualizados} actualizados, {resultado.contratos_creados}{" "}
            contratos creados, {resultado.contratos_actualizados} contratos cesados/actualizados.
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
