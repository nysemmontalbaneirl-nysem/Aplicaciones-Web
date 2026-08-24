import { useState } from "react";
import Trabajadores from "./components/Trabajadores";
import Periodos from "./components/Periodos";
import Tareo from "./components/Tareo";
import Calculo from "./components/Calculo";
import Boletas from "./components/Boletas";
import Parametros from "./components/Parametros";
import Importar from "./components/Importar";
import { PeriodoPlanilla } from "./types";

type Pestana = "trabajadores" | "importar" | "periodos" | "tareo" | "calculo" | "boletas" | "parametros";

export default function App() {
  const [pestana, setPestana] = useState<Pestana>("trabajadores");
  const [periodoSeleccionado, setPeriodoSeleccionado] = useState<PeriodoPlanilla | null>(null);

  function irATareo(periodo: PeriodoPlanilla) {
    setPeriodoSeleccionado(periodo);
    setPestana("tareo");
  }

  function irACalculo(periodo: PeriodoPlanilla) {
    setPeriodoSeleccionado(periodo);
    setPestana("calculo");
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
          className={`tab-button ${pestana === "tareo" ? "activo" : ""}`}
          onClick={() => setPestana("tareo")}
          disabled={!periodoSeleccionado}
        >
          Tareo
        </button>
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
          className={`tab-button ${pestana === "parametros" ? "activo" : ""}`}
          onClick={() => setPestana("parametros")}
        >
          Parametros
        </button>
      </div>

      {pestana === "trabajadores" && <Trabajadores />}
      {pestana === "importar" && <Importar />}
      {pestana === "periodos" && <Periodos onCargarTareo={irATareo} onCalcular={irACalculo} />}
      {pestana === "tareo" && periodoSeleccionado && (
        <Tareo periodo={periodoSeleccionado} onIrACalcular={() => setPestana("calculo")} />
      )}
      {pestana === "calculo" && periodoSeleccionado && (
        <Calculo periodo={periodoSeleccionado} onVerBoletas={() => setPestana("boletas")} />
      )}
      {pestana === "boletas" && <Boletas periodoInicial={periodoSeleccionado} />}
      {pestana === "parametros" && <Parametros />}
    </div>
  );
}
