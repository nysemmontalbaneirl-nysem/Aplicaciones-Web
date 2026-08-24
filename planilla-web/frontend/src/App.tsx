import { useState } from "react";
import { useAuth } from "./AuthContext";
import Login from "./components/Login";
import CambiarPassword from "./components/CambiarPassword";
import Trabajadores from "./components/Trabajadores";
import Periodos from "./components/Periodos";
import Tareo from "./components/Tareo";
import Calculo from "./components/Calculo";
import Boletas from "./components/Boletas";
import Reportes from "./components/Reportes";
import Parametros from "./components/Parametros";
import Importar from "./components/Importar";
import Usuarios from "./components/Usuarios";
import Empresa from "./components/Empresa";
import Proyectos from "./components/Proyectos";
import { PeriodoPlanilla } from "./types";

type Pestana =
  | "trabajadores"
  | "importar"
  | "periodos"
  | "tareo"
  | "calculo"
  | "boletas"
  | "reportes"
  | "parametros"
  | "usuarios"
  | "empresa"
  | "proyectos";

export default function App() {
  const { usuario, cargando, cerrarSesion } = useAuth();
  const [pestana, setPestana] = useState<Pestana>("trabajadores");
  const [periodoSeleccionado, setPeriodoSeleccionado] = useState<PeriodoPlanilla | null>(null);
  const [cambiandoPassword, setCambiandoPassword] = useState(false);

  function irATareo(periodo: PeriodoPlanilla) {
    setPeriodoSeleccionado(periodo);
    setPestana("tareo");
  }

  function irACalculo(periodo: PeriodoPlanilla) {
    setPeriodoSeleccionado(periodo);
    setPestana("calculo");
  }

  if (cargando) {
    return null;
  }

  if (!usuario) {
    return <Login />;
  }

  const esAdmin = usuario.rol === "ADMIN";
  // TAREADOR solo carga tareo, no calcula ni ve boletas/reportes.
  const puedeCalcular = esAdmin || usuario.rol === "RESPONSABLE_PLANILLA";

  return (
    <div className="app-shell">
      <div className="app-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Sistema de Planillas — JHCR</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: "0.88rem" }}>
          <span>
            {usuario.nombre} — {usuario.rol}
          </span>
          <button type="button" onClick={() => setCambiandoPassword((v) => !v)}>
            Cambiar contraseña
          </button>
          <button type="button" onClick={cerrarSesion}>
            Cerrar sesión
          </button>
        </div>
      </div>

      {cambiandoPassword && (
        <CambiarPassword onListo={() => setCambiandoPassword(false)} />
      )}

      <div className="tabs">
        <button
          className={`tab-button ${pestana === "trabajadores" ? "activo" : ""}`}
          onClick={() => setPestana("trabajadores")}
        >
          Trabajadores
        </button>
        {esAdmin && (
          <button
            className={`tab-button ${pestana === "importar" ? "activo" : ""}`}
            onClick={() => setPestana("importar")}
          >
            Importar
          </button>
        )}
        <button
          className={`tab-button ${pestana === "periodos" ? "activo" : ""}`}
          onClick={() => setPestana("periodos")}
        >
          Periodos
        </button>
        <button
          className={`tab-button ${pestana === "tareo" ? "activo" : ""}`}
          onClick={() => setPestana("tareo")}
          disabled={!periodoSeleccionado}
        >
          Tareo
        </button>
        {puedeCalcular && (
          <>
            <button
              className={`tab-button ${pestana === "calculo" ? "activo" : ""}`}
              onClick={() => setPestana("calculo")}
              disabled={!periodoSeleccionado}
            >
              Calcular
            </button>
            <button
              className={`tab-button ${pestana === "boletas" ? "activo" : ""}`}
              onClick={() => setPestana("boletas")}
            >
              Boletas
            </button>
            <button
              className={`tab-button ${pestana === "reportes" ? "activo" : ""}`}
              onClick={() => setPestana("reportes")}
            >
              Reportes
            </button>
          </>
        )}
        {esAdmin && (
          <>
            <button
              className={`tab-button ${pestana === "parametros" ? "activo" : ""}`}
              onClick={() => setPestana("parametros")}
            >
              Parametros
            </button>
            <button
              className={`tab-button ${pestana === "proyectos" ? "activo" : ""}`}
              onClick={() => setPestana("proyectos")}
            >
              Proyectos
            </button>
            <button
              className={`tab-button ${pestana === "usuarios" ? "activo" : ""}`}
              onClick={() => setPestana("usuarios")}
            >
              Usuarios
            </button>
            <button
              className={`tab-button ${pestana === "empresa" ? "activo" : ""}`}
              onClick={() => setPestana("empresa")}
            >
              Empresa
            </button>
          </>
        )}
      </div>

      {pestana === "trabajadores" && <Trabajadores />}
      {pestana === "importar" && esAdmin && <Importar />}
      {pestana === "periodos" && (
        <Periodos onCargarTareo={irATareo} onCalcular={puedeCalcular ? irACalculo : undefined} />
      )}
      {pestana === "tareo" && periodoSeleccionado && (
        <Tareo periodo={periodoSeleccionado} onIrACalcular={() => setPestana("calculo")} />
      )}
      {pestana === "calculo" && periodoSeleccionado && puedeCalcular && (
        <Calculo periodo={periodoSeleccionado} onVerBoletas={() => setPestana("boletas")} />
      )}
      {pestana === "boletas" && puedeCalcular && <Boletas periodoInicial={periodoSeleccionado} />}
      {pestana === "reportes" && puedeCalcular && <Reportes />}
      {pestana === "parametros" && esAdmin && <Parametros />}
      {pestana === "proyectos" && esAdmin && <Proyectos />}
      {pestana === "usuarios" && esAdmin && <Usuarios />}
      {pestana === "empresa" && esAdmin && <Empresa />}
    </div>
  );
}
