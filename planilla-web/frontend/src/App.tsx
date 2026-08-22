import { useState } from "react";
import Trabajadores from "./components/Trabajadores";
import Periodos from "./components/Periodos";
import Planilla from "./components/Planilla";
import Parametros from "./components/Parametros";
import Importar from "./components/Importar";
import { PeriodoPlanilla } from "./types";

type Pestana = "trabajadores" | "periodos" | "planilla" | "parametros" | "importar";

export default function App() {
  const [pestana, setPestana] = useState<Pestana>("trabajadores");
  const [periodoSeleccionado, setPeriodoSeleccionado] = useState<PeriodoPlanilla | null>(null);

  function irACalcularPlanilla(periodo: PeriodoPlanilla) {
    setPeriodoSeleccionado(periodo);
    setPestana("planilla");
  }

  return (
    <div className="app-shell">
      <div className="app-header">
        <h1>Sistema de Planillas — JHCR</h1>
      </div>

      <div className="tabs">
        <button
          className={`tab-button ${pestana === "trabajadores" ? "activo" : ""}`}
          onClick={() => setPestana("trabajadores")}
        >
          Trabajadores
        </button>
        <button
          className={`tab-button ${pestana === "importar" ? "activo" : ""}`}
          onClick={() => setPestana("importar")}
        >
          Importar
        </button>
        <button
          className={`tab-button ${pestana === "periodos" ? "activo" : ""}`}
          onClick={() => setPestana("periodos")}
        >
          Periodos
        </button>
        <button
          className={`tab-button ${pestana === "planilla" ? "activo" : ""}`}
          onClick={() => setPestana("planilla")}
          disabled={!periodoSeleccionado}
        >
          Planilla
        </button>
        <button
          className={`tab-button ${pestana === "parametros" ? "activo" : ""}`}
          onClick={() => setPestana("parametros")}
        >
          Parametros
        </button>
      </div>

      {pestana === "trabajadores" && <Trabajadores />}
      {pestana === "importar" && <Importar />}
      {pestana === "periodos" && <Periodos onSeleccionar={irACalcularPlanilla} />}
      {pestana === "planilla" && periodoSeleccionado && <Planilla periodo={periodoSeleccionado} />}
      {pestana === "parametros" && <Parametros />}
    </div>
  );
}
