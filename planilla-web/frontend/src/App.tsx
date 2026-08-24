import { useState } from "react";
import { useAuth } from "./AuthContext";
import Login from "./components/Login";
import CambiarPassword from "./components/CambiarPassword";
import Sidebar, { Pestana } from "./components/Sidebar";
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
    <div className="app-layout">
      <Sidebar
        usuario={usuario}
        pestana={pestana}
        setPestana={setPestana}
        periodoSeleccionado={!!periodoSeleccionado}
        esAdmin={esAdmin}
        puedeCalcular={puedeCalcular}
        onCambiarPassword={() => setCambiandoPassword((v) => !v)}
        onCerrarSesion={cerrarSesion}
      />

      <div className="main-content">
        {cambiandoPassword && <CambiarPassword onListo={() => setCambiandoPassword(false)} />}

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
    </div>
  );
}
