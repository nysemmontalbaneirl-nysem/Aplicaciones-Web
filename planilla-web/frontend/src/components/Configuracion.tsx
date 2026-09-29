import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../api";
import { ConceptoPlanilla, LimitesTareo } from "../types";

type CampoAfecto = "afecto_essalud" | "afecto_sctr" | "afecto_senati" | "afecto_onp" | "afecto_afp" | "afecto_renta5ta" | "afecto_conafovicer";

const COLUMNAS_AFECTO: { campo: CampoAfecto; etiqueta: string }[] = [
  { campo: "afecto_essalud", etiqueta: "EsSalud" },
  { campo: "afecto_sctr", etiqueta: "SCTR" },
  { campo: "afecto_senati", etiqueta: "SENATI" },
  { campo: "afecto_onp", etiqueta: "ONP" },
  { campo: "afecto_afp", etiqueta: "AFP" },
  { campo: "afecto_renta5ta", etiqueta: "Renta 5ta" },
  { campo: "afecto_conafovicer", etiqueta: "CONAFOVICER" },
];

type Edicion = Partial<Pick<ConceptoPlanilla, "factor1" | "factor2" | "factor3" | "activo" | CampoAfecto>>;

export default function Configuracion() {
  const [conceptos, setConceptos] = useState<ConceptoPlanilla[]>([]);
  const [ediciones, setEdiciones] = useState<Record<string, Edicion>>({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [restaurando, setRestaurando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  // Limites de tareo (migracion 040): fila unica, se edita completa de una
  // vez (no celda por celda como los conceptos de arriba).
  // NOTA (recon 27/46): en produccion esta seccion vive en una pestana
  // propia dentro de un sub-menu de Configuracion ("Conceptos de ingreso" /
  // "Aportes y retenciones" / "Plan de cuentas" / "Dias feriados" / "Cuota
  // sindical" / "Limites de tareo" / "Conceptos con formula propia") que
  // nunca se reconstruyo en este arbol - las 5 secciones restantes (y sus
  // rutas backend correspondientes) no existen aqui, asi que se agrega esta
  // tarjeta como una segunda seccion simple debajo de la tabla de
  // conceptos, en vez de como una pestana mas de un sub-menu que no existe.
  const [limitesTareo, setLimitesTareo] = useState<LimitesTareo | null>(null);
  const [edicionLimites, setEdicionLimites] = useState<Record<keyof LimitesTareo, string>>({
    horas_max_lun_vie: "",
    minutos_max_lun_vie: "",
    horas_max_sabado: "",
    minutos_max_sabado: "",
  });
  const [guardandoLimites, setGuardandoLimites] = useState(false);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      const [datos, datosLimites] = await Promise.all([
        apiGet<ConceptoPlanilla[]>("/conceptos"),
        apiGet<LimitesTareo>("/conceptos/limites-tareo"),
      ]);
      setConceptos(datos);
      setEdiciones({});
      setLimitesTareo(datosLimites);
      setEdicionLimites({
        horas_max_lun_vie: String(datosLimites.horas_max_lun_vie),
        minutos_max_lun_vie: String(datosLimites.minutos_max_lun_vie),
        horas_max_sabado: String(datosLimites.horas_max_sabado),
        minutos_max_sabado: String(datosLimites.minutos_max_sabado),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar los conceptos");
    } finally {
      setCargando(false);
    }
  }

  function valorActual<K extends keyof Edicion>(c: ConceptoPlanilla, campo: K): ConceptoPlanilla[K] {
    const edicion = ediciones[c.codigo];
    if (edicion && campo in edicion) return edicion[campo] as ConceptoPlanilla[K];
    return c[campo];
  }

  function editar(codigo: string, campo: keyof Edicion, valor: Edicion[keyof Edicion]) {
    setEdiciones((prev) => ({ ...prev, [codigo]: { ...prev[codigo], [campo]: valor } }));
    setMensaje(null);
  }

  function esFilaEditada(codigo: string): boolean {
    return !!ediciones[codigo] && Object.keys(ediciones[codigo]).length > 0;
  }

  async function guardarFila(c: ConceptoPlanilla) {
    const cambios = ediciones[c.codigo];
    if (!cambios) return;
    setGuardando(c.codigo);
    setError(null);
    try {
      const actualizado = await apiPut<ConceptoPlanilla>(`/conceptos/${c.codigo}`, cambios);
      setConceptos((prev) => prev.map((x) => (x.codigo === c.codigo ? actualizado : x)));
      setEdiciones((prev) => {
        const copia = { ...prev };
        delete copia[c.codigo];
        return copia;
      });
      setMensaje(`Guardado: ${c.nombre}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar el concepto");
    } finally {
      setGuardando(null);
    }
  }

  async function restaurarValoresOriginales() {
    if (
      !confirm(
        "¿Restaurar TODOS los conceptos a los valores originales del sistema? Se perderán todos los cambios manuales que hayas hecho en esta pestaña."
      )
    ) {
      return;
    }
    setRestaurando(true);
    setError(null);
    try {
      const datos = await apiPost<ConceptoPlanilla[]>("/conceptos/restaurar", {});
      setConceptos(datos);
      setEdiciones({});
      setMensaje("Se restauraron los valores originales.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al restaurar los valores originales");
    } finally {
      setRestaurando(false);
    }
  }

  function celdaFactor(c: ConceptoPlanilla, campo: "factor1" | "factor2" | "factor3", etiquetaCampo: "factor1_etiqueta" | "factor2_etiqueta" | "factor3_etiqueta") {
    const etiqueta = c[etiquetaCampo];
    if (!etiqueta) return <td style={{ color: "#b0b5c0" }}>—</td>;
    const valor = valorActual(c, campo);
    return (
      <td title={etiqueta}>
        <input
          type="number"
          step="any"
          value={valor ?? ""}
          onChange={(e) => editar(c.codigo, campo, e.target.value === "" ? null : Number(e.target.value))}
          style={{ width: 90 }}
        />
        <div style={{ fontSize: "0.72rem", color: "#8a90a0", maxWidth: 140 }}>{etiqueta}</div>
      </td>
    );
  }

  function celdaAfecto(c: ConceptoPlanilla, campo: CampoAfecto) {
    const valor = valorActual(c, campo);
    if (valor === null) {
      return (
        <span style={{ color: "#b0b5c0" }} title="No aplica: ya incorporado en la fórmula anual de Empleado">
          N/A
        </span>
      );
    }
    return (
      <input type="checkbox" checked={valor} onChange={(e) => editar(c.codigo, campo, e.target.checked)} />
    );
  }

  // Migracion 039: interruptor activo/inactivo para conceptos de codigo fijo
  // (sin formula) - permite apagar temporalmente uno (ej. para reemplazarlo
  // por un "gemelo" con formula propia) sin borrarlo del catalogo.
  // SUELDO_BASICO no se puede apagar (el sueldo/jornal basico siempre se
  // calcula, ver motorCalculo.ts:estaActivo) - el checkbox aparece
  // deshabilitado para ese codigo puntual, con una explicacion al pasar el
  // mouse.
  function celdaActivo(c: ConceptoPlanilla) {
    const valor = valorActual(c, "activo");
    if (c.codigo === "SUELDO_BASICO") {
      return (
        <input
          type="checkbox"
          checked={true}
          disabled
          title="El sueldo/jornal básico siempre se calcula - no se puede desactivar"
        />
      );
    }
    return <input type="checkbox" checked={valor} onChange={(e) => editar(c.codigo, "activo", e.target.checked)} />;
  }

  // ------------------------------------------------------------------
  // Limites de tareo (migracion 040)
  // ------------------------------------------------------------------
  function editarLimite(campo: keyof LimitesTareo, valor: string) {
    setEdicionLimites((prev) => ({ ...prev, [campo]: valor }));
    setMensaje(null);
  }

  async function guardarLimitesTareo() {
    const horasMaxLunVie = Number(edicionLimites.horas_max_lun_vie);
    const minutosMaxLunVie = Number(edicionLimites.minutos_max_lun_vie);
    const horasMaxSabado = Number(edicionLimites.horas_max_sabado);
    const minutosMaxSabado = Number(edicionLimites.minutos_max_sabado);
    if (
      [horasMaxLunVie, horasMaxSabado].some((v) => Number.isNaN(v) || v < 0 || v > 24) ||
      [minutosMaxLunVie, minutosMaxSabado].some((v) => Number.isNaN(v) || v < 0 || v > 59)
    ) {
      setError("Revisa los valores: las horas deben estar entre 0 y 24, y los minutos entre 0 y 59.");
      return;
    }
    setGuardandoLimites(true);
    setError(null);
    try {
      const guardado = await apiPut<LimitesTareo>("/conceptos/limites-tareo", {
        horas_max_lun_vie: horasMaxLunVie,
        minutos_max_lun_vie: minutosMaxLunVie,
        horas_max_sabado: horasMaxSabado,
        minutos_max_sabado: minutosMaxSabado,
      });
      setLimitesTareo(guardado);
      setMensaje("Límites de tareo guardados correctamente.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar los límites de tareo");
    } finally {
      setGuardandoLimites(false);
    }
  }

  return (
    <>
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
        <div>
          <h2>Configuración de conceptos de planilla</h2>
          <p style={{ color: "#5a6172", maxWidth: 800 }}>
            Para cada concepto de ingreso, define a qué aportes/descuentos está afecto (igual que la Tabla 22
            de SUNAT — EsSalud, SCTR, SENATI, ONP, AFP, Renta 5ta, CONAFOVICER) y los factores/tasas legales de
            su fórmula (ej. 0.15 = 15%). La estructura de cada fórmula sigue fija en el sistema — solo los
            números dentro de ella son editables aquí. Las celdas marcadas "N/A" no se pueden activar: su
            efecto ya está incorporado de otra forma en el cálculo (ver la descripción del concepto).
          </p>
        </div>
        <button type="button" onClick={restaurarValoresOriginales} disabled={restaurando} className="no-imprimir">
          {restaurando ? "Restaurando..." : "Restaurar valores originales"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {mensaje && <p style={{ color: "#1a7f37" }}>{mensaje}</p>}
      {cargando && <p>Cargando...</p>}

      {!cargando && (
        <div className="tabla-scroll-horizontal">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>Concepto</th>
                <th>Factor 1</th>
                <th>Factor 2</th>
                <th>Factor 3</th>
                {COLUMNAS_AFECTO.map((col) => (
                  <th key={col.campo} style={{ textAlign: "center" }}>
                    {col.etiqueta}
                  </th>
                ))}
                <th style={{ textAlign: "center" }} title="Interruptor para desactivar temporalmente el concepto sin borrarlo">
                  Activo
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {conceptos.map((c) => (
                <tr key={c.codigo}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{c.nombre}</div>
                    {c.descripcion && (
                      <div style={{ fontSize: "0.78rem", color: "#8a90a0", maxWidth: 320 }}>{c.descripcion}</div>
                    )}
                  </td>
                  {celdaFactor(c, "factor1", "factor1_etiqueta")}
                  {celdaFactor(c, "factor2", "factor2_etiqueta")}
                  {celdaFactor(c, "factor3", "factor3_etiqueta")}
                  {COLUMNAS_AFECTO.map((col) => (
                    <td key={col.campo} style={{ textAlign: "center" }}>
                      {celdaAfecto(c, col.campo)}
                    </td>
                  ))}
                  <td style={{ textAlign: "center" }}>{celdaActivo(c)}</td>
                  <td>
                    {esFilaEditada(c.codigo) && (
                      <button
                        type="button"
                        className="primario"
                        onClick={() => guardarFila(c)}
                        disabled={guardando === c.codigo}
                      >
                        {guardando === c.codigo ? "..." : "Guardar"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>

    {!cargando && limitesTareo && (
      <div className="card" style={{ marginTop: 18 }}>
        <h2>Límites de tareo</h2>
        <p style={{ color: "#5a6172", maxWidth: 800 }}>
          Límite máximo de horas y minutos que se puede registrar por día en el Tareo Diario, distinto para
          días de lunes a viernes y para sábados (domingo no tiene límite configurable aquí — se paga aparte
          como "domingo trabajado"). El límite aplica a la SUMA de todas las columnas de horas de ese día
          (jornal normal + domingo + feriado + horas extra), y por separado a la suma de todos los minutos. Si
          se excede, el sistema no deja guardar ese día.
        </p>
        <div className="form-grid" style={{ maxWidth: 520 }}>
          <label>
            Horas máximas (lunes a viernes)
            <input
              type="number"
              min={0}
              max={24}
              step={1}
              value={edicionLimites.horas_max_lun_vie}
              onChange={(e) => editarLimite("horas_max_lun_vie", e.target.value)}
            />
          </label>
          <label>
            Minutos máximos (lunes a viernes)
            <input
              type="number"
              min={0}
              max={59}
              step={1}
              value={edicionLimites.minutos_max_lun_vie}
              onChange={(e) => editarLimite("minutos_max_lun_vie", e.target.value)}
            />
          </label>
          <label>
            Horas máximas (sábado)
            <input
              type="number"
              min={0}
              max={24}
              step={1}
              value={edicionLimites.horas_max_sabado}
              onChange={(e) => editarLimite("horas_max_sabado", e.target.value)}
            />
          </label>
          <label>
            Minutos máximos (sábado)
            <input
              type="number"
              min={0}
              max={59}
              step={1}
              value={edicionLimites.minutos_max_sabado}
              onChange={(e) => editarLimite("minutos_max_sabado", e.target.value)}
            />
          </label>
        </div>
        <button
          className="primario"
          type="button"
          onClick={guardarLimitesTareo}
          disabled={guardandoLimites}
          style={{ marginTop: 12 }}
        >
          {guardandoLimites ? "Guardando..." : "Guardar límites"}
        </button>
      </div>
    )}
    </>
  );
}
