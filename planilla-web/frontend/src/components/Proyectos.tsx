import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut } from "../api";
import { Catalogos, CatalogoItem, Proyecto } from "../types";

const TIPOS_ESTABLECIMIENTO = ["DOMICILIO FISCAL", "ESTABLECIMIENTO ANEXO"] as const;

// Mismo patron que Trabajadores.tsx (selector generico codigo+nombre para
// los catalogos de ubigeo) - se repite aca en vez de importarlo porque no
// esta exportado desde ese archivo.
function SelectorCatalogo({
  value,
  onChange,
  opciones,
  vacioTexto,
}: {
  value: string;
  onChange: (v: string) => void;
  opciones: CatalogoItem[];
  vacioTexto?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {vacioTexto !== undefined && <option value="">{vacioTexto}</option>}
      {opciones.map((o) => (
        <option key={o.codigo} value={o.codigo}>
          {o.codigo} - {o.nombre}
        </option>
      ))}
    </select>
  );
}

export default function Proyectos() {
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [nombre, setNombre] = useState("");
  const [ubicacion, setUbicacion] = useState("");
  const [cuotaSindical, setCuotaSindical] = useState("0");
  const [codigoEstablecimiento, setCodigoEstablecimiento] = useState("0000");
  const [tipoEstablecimiento, setTipoEstablecimiento] = useState<(typeof TIPOS_ESTABLECIMIENTO)[number]>("ESTABLECIMIENTO ANEXO");
  // Ubicacion geografica (migracion_042) - departamento/provincia/distrito
  // del catalogo UBIGEO, para que los feriados REGIONAL/LOCAL sepan si
  // aplican a este proyecto o no.
  const [ubigeoDepartamento, setUbigeoDepartamento] = useState("");
  const [ubigeoProvincia, setUbigeoProvincia] = useState("");
  const [ubigeoDistrito, setUbigeoDistrito] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [cuotasEdicion, setCuotasEdicion] = useState<Record<number, string>>({});
  const [establecimientosEdicion, setEstablecimientosEdicion] = useState<
    Record<number, { codigo_establecimiento: string; tipo_establecimiento: string }>
  >({});
  const [ubicacionEdicion, setUbicacionEdicion] = useState<
    Record<number, { departamento: string; provincia: string; distrito: string }>
  >({});
  const [guardandoId, setGuardandoId] = useState<number | null>(null);

  const provinciasDisponibles = useMemo(
    () => catalogos?.ubigeo_provincia.filter((p) => p.departamento_codigo === ubigeoDepartamento) ?? [],
    [catalogos, ubigeoDepartamento]
  );
  const distritosDisponibles = useMemo(
    () => catalogos?.ubigeo_distrito.filter((d) => d.provincia_codigo === ubigeoProvincia) ?? [],
    [catalogos, ubigeoProvincia]
  );

  async function cargar() {
    const lista = await apiGet<Proyecto[]>("/proyectos");
    setProyectos(lista);
    setCuotasEdicion(Object.fromEntries(lista.map((p) => [p.id, String(p.cuota_sindical_semanal)])));
    setEstablecimientosEdicion(
      Object.fromEntries(
        lista.map((p) => [
          p.id,
          {
            codigo_establecimiento: p.codigo_establecimiento ?? "0000",
            tipo_establecimiento: p.tipo_establecimiento ?? "ESTABLECIMIENTO ANEXO",
          },
        ])
      )
    );
    setUbicacionEdicion(
      Object.fromEntries(
        lista.map((p) => [
          p.id,
          {
            departamento: p.ubigeo_departamento_codigo ?? "",
            provincia: p.ubigeo_provincia_codigo ?? "",
            distrito: p.ubigeo_distrito_codigo ?? "",
          },
        ])
      )
    );
  }

  useEffect(() => {
    cargar().catch((e) => setError((e as Error).message));
    apiGet<Catalogos>("/catalogos").then(setCatalogos).catch((e) => setError((e as Error).message));
  }, []);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreando(true);
    try {
      await apiPost("/proyectos", {
        nombre,
        ubicacion,
        cuota_sindical_semanal: Number(cuotaSindical) || 0,
        codigo_establecimiento: codigoEstablecimiento || "0000",
        tipo_establecimiento: tipoEstablecimiento,
        ubigeo_departamento_codigo: ubigeoDepartamento || null,
        ubigeo_provincia_codigo: ubigeoProvincia || null,
        ubigeo_distrito_codigo: ubigeoDistrito || null,
      });
      setNombre("");
      setUbicacion("");
      setCuotaSindical("0");
      setCodigoEstablecimiento("0000");
      setTipoEstablecimiento("ESTABLECIMIENTO ANEXO");
      setUbigeoDepartamento("");
      setUbigeoProvincia("");
      setUbigeoDistrito("");
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreando(false);
    }
  }

  async function cambiarEstado(p: Proyecto) {
    setError(null);
    try {
      await apiPut(`/proyectos/${p.id}`, {
        nombre: p.nombre,
        ubicacion: p.ubicacion,
        estado: p.estado === "ACTIVO" ? "CERRADO" : "ACTIVO",
        cuota_sindical_semanal: p.cuota_sindical_semanal,
        codigo_establecimiento: p.codigo_establecimiento ?? "0000",
        tipo_establecimiento: p.tipo_establecimiento ?? "ESTABLECIMIENTO ANEXO",
        ubigeo_departamento_codigo: p.ubigeo_departamento_codigo ?? null,
        ubigeo_provincia_codigo: p.ubigeo_provincia_codigo ?? null,
        ubigeo_distrito_codigo: p.ubigeo_distrito_codigo ?? null,
      });
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function guardarCuota(p: Proyecto) {
    setError(null);
    setGuardandoId(p.id);
    try {
      const establecimiento = establecimientosEdicion[p.id] ?? {
        codigo_establecimiento: "0000",
        tipo_establecimiento: "ESTABLECIMIENTO ANEXO",
      };
      const ubicacionGeo = ubicacionEdicion[p.id] ?? { departamento: "", provincia: "", distrito: "" };
      await apiPut(`/proyectos/${p.id}`, {
        nombre: p.nombre,
        ubicacion: p.ubicacion,
        estado: p.estado,
        cuota_sindical_semanal: Number(cuotasEdicion[p.id]) || 0,
        codigo_establecimiento: establecimiento.codigo_establecimiento,
        tipo_establecimiento: establecimiento.tipo_establecimiento,
        ubigeo_departamento_codigo: ubicacionGeo.departamento || null,
        ubigeo_provincia_codigo: ubicacionGeo.provincia || null,
        ubigeo_distrito_codigo: ubicacionGeo.distrito || null,
      });
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardandoId(null);
    }
  }

  function provinciasDe(departamento: string) {
    return catalogos?.ubigeo_provincia.filter((p) => p.departamento_codigo === departamento) ?? [];
  }
  function distritosDe(provincia: string) {
    return catalogos?.ubigeo_distrito.filter((d) => d.provincia_codigo === provincia) ?? [];
  }

  return (
    <div>
      <div className="card">
        <h2>Nuevo proyecto</h2>
        <p style={{ color: "#5a6172", fontSize: "0.88rem" }}>
          El nombre debe escribirse exactamente igual a como aparece en los contratos de los
          trabajadores (ej. "P013-Tecnologico La Union-Piura"), para que coincida al asignar
          usuarios a proyectos.
        </p>
        {error && <div className="mensaje-error">{error}</div>}
        <form onSubmit={crear}>
          <div className="form-grid">
            <label>
              Nombre
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} required />
            </label>
            <label>
              Ubicación
              <input value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} placeholder="Ej. Piura-Piura" />
            </label>
            <label>
              Cuota sindical (S/. por semana)
              <input
                type="number"
                step="0.01"
                min="0"
                value={cuotaSindical}
                onChange={(e) => setCuotaSindical(e.target.value)}
              />
            </label>
            <label>
              Código de establecimiento (SUNAT)
              <input value={codigoEstablecimiento} onChange={(e) => setCodigoEstablecimiento(e.target.value)} placeholder="0000" />
            </label>
            <label>
              Tipo de establecimiento (SUNAT)
              <select value={tipoEstablecimiento} onChange={(e) => setTipoEstablecimiento(e.target.value as (typeof TIPOS_ESTABLECIMIENTO)[number])}>
                {TIPOS_ESTABLECIMIENTO.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>
          <h3 className="seccion-titulo">Ubicación geográfica (para feriados regionales/locales)</h3>
          <p style={{ color: "#5a6172", fontSize: "0.85rem", marginTop: -8 }}>
            Opcional, pero necesaria para que los feriados de ámbito Regional o Local se apliquen
            correctamente a los trabajadores de este proyecto. Un proyecto sin esta ubicación solo
            recibe los feriados Nacionales.
          </p>
          <div className="form-grid">
            <label>
              Departamento
              {catalogos && (
                <SelectorCatalogo
                  value={ubigeoDepartamento}
                  onChange={(v) => {
                    setUbigeoDepartamento(v);
                    setUbigeoProvincia("");
                    setUbigeoDistrito("");
                  }}
                  opciones={catalogos.ubigeo_departamento}
                  vacioTexto="Sin especificar"
                />
              )}
            </label>
            <label>
              Provincia
              {catalogos && (
                <SelectorCatalogo
                  value={ubigeoProvincia}
                  onChange={(v) => {
                    setUbigeoProvincia(v);
                    setUbigeoDistrito("");
                  }}
                  opciones={provinciasDisponibles}
                  vacioTexto={ubigeoDepartamento ? "Sin especificar" : "Elige un departamento primero"}
                />
              )}
            </label>
            <label>
              Distrito (opcional)
              {catalogos && (
                <SelectorCatalogo
                  value={ubigeoDistrito}
                  onChange={setUbigeoDistrito}
                  opciones={distritosDisponibles}
                  vacioTexto={ubigeoProvincia ? "Sin especificar" : "Elige una provincia primero"}
                />
              )}
            </label>
          </div>
          <button className="primario" type="submit" disabled={creando}>
            {creando ? "Creando..." : "Crear proyecto"}
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Proyectos ({proyectos.length})</h2>
        <p style={{ color: "#5a6172", fontSize: "0.88rem" }}>
          La cuota sindical es una tarifa FIJA semanal por trabajador sindicalizado (no un
          porcentaje del sueldo) y varía por proyecto/obra. Se descuenta solo a los trabajadores
          marcados como "Sindicalizado" en su ficha.
        </p>
        <p style={{ color: "#5a6172", fontSize: "0.88rem" }}>
          Cada proyecto/obra es su propio establecimiento ante SUNAT (T-Registro): el código y
          tipo de establecimiento se declaran junto con el trabajador al darlo de alta.
        </p>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Ubicación</th>
              <th>Estado</th>
              <th>Cuota sindical (S/. semana)</th>
              <th>Establecimiento SUNAT</th>
              <th>Ubicación geográfica (feriados)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {proyectos.map((p) => (
              <tr key={p.id}>
                <td>{p.nombre}</td>
                <td>{p.ubicacion ?? "—"}</td>
                <td>{p.estado}</td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    style={{ width: 90 }}
                    value={cuotasEdicion[p.id] ?? "0"}
                    onChange={(e) => setCuotasEdicion((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  />
                </td>
                <td style={{ display: "flex", gap: 6 }}>
                  <input
                    style={{ width: 70 }}
                    value={establecimientosEdicion[p.id]?.codigo_establecimiento ?? "0000"}
                    onChange={(e) =>
                      setEstablecimientosEdicion((prev) => ({
                        ...prev,
                        [p.id]: { ...(prev[p.id] ?? { tipo_establecimiento: "ESTABLECIMIENTO ANEXO" }), codigo_establecimiento: e.target.value },
                      }))
                    }
                  />
                  <select
                    value={establecimientosEdicion[p.id]?.tipo_establecimiento ?? "ESTABLECIMIENTO ANEXO"}
                    onChange={(e) =>
                      setEstablecimientosEdicion((prev) => ({
                        ...prev,
                        [p.id]: { ...(prev[p.id] ?? { codigo_establecimiento: "0000" }), tipo_establecimiento: e.target.value },
                      }))
                    }
                  >
                    {TIPOS_ESTABLECIMIENTO.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => guardarCuota(p)}
                    disabled={guardandoId === p.id}
                  >
                    {guardandoId === p.id ? "..." : "Guardar"}
                  </button>
                </td>
                <td style={{ display: "flex", gap: 6 }}>
                  {catalogos && (
                    <>
                      <SelectorCatalogo
                        value={ubicacionEdicion[p.id]?.departamento ?? ""}
                        onChange={(v) =>
                          setUbicacionEdicion((prev) => ({
                            ...prev,
                            [p.id]: { departamento: v, provincia: "", distrito: "" },
                          }))
                        }
                        opciones={catalogos.ubigeo_departamento}
                        vacioTexto="Sin especificar"
                      />
                      <SelectorCatalogo
                        value={ubicacionEdicion[p.id]?.provincia ?? ""}
                        onChange={(v) =>
                          setUbicacionEdicion((prev) => ({
                            ...prev,
                            [p.id]: { departamento: prev[p.id]?.departamento ?? "", provincia: v, distrito: "" },
                          }))
                        }
                        opciones={provinciasDe(ubicacionEdicion[p.id]?.departamento ?? "")}
                        vacioTexto="Sin especificar"
                      />
                      <SelectorCatalogo
                        value={ubicacionEdicion[p.id]?.distrito ?? ""}
                        onChange={(v) =>
                          setUbicacionEdicion((prev) => ({
                            ...prev,
                            [p.id]: { ...(prev[p.id] ?? { departamento: "", provincia: "" }), distrito: v },
                          }))
                        }
                        opciones={distritosDe(ubicacionEdicion[p.id]?.provincia ?? "")}
                        vacioTexto="Sin especificar"
                      />
                    </>
                  )}
                </td>
                <td>
                  <button type="button" onClick={() => cambiarEstado(p)}>
                    {p.estado === "ACTIVO" ? "Cerrar" : "Reactivar"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
