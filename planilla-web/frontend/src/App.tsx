import { useState } from "react";
import { useAuth } from "./AuthContext";
import Login from "./components/Login";
import CambiarPassword from "./components/CambiarPassword";
import Topbar from "./components/Topbar";
import Sidebar, { Pestana } from "./components/Sidebar";
import Trabajadores from "./components/Trabajadores";
import Periodos from "./components/Periodos";
import Tareo from "./components/Tareo";
import TareoDiario from "./components/TareoDiario";
import Calculo from "./components/Calculo";
import Boletas from "./components/Boletas";
import Reportes from "./components/Reportes";
import Vacaciones from "./components/Vacaciones";
import Configuracion from "./components/Configuracion";
import Bitacora from "./components/Bitacora";
import Parametros from "./components/Parametros";
import Importar from "./components/Importar";
import Usuarios from "./components/Usuarios";
import Empresa from "./components/Empresa";
import Proyectos from "./components/Proyectos";
import Roles from "./components/Roles";
import Dashboard from "./components/Dashboard";
import { PeriodoPlanilla, tienePermiso } from "./types";

export default function App() {
  const { usuario, cargando, cerrarSesion } = useAuth();
  const [pestana, setPestana] = useState<Pestana>("inicio");
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

  function irATareoDiario(periodo: PeriodoPlanilla) {
    setPeriodoSeleccionado(periodo);
    setPestana("tareoDiario");
  }

  if (cargando) {
    return null;
  }

  if (!usuario) {
    return <Login />;
  }

  const esAdmin = usuario.rol === "ADMIN";
  // Ver boletas/calcular/reportes/vacaciones ya no depende del nombre del
  // rol, sino de los permisos que el Administrador le haya marcado desde la
  // pestaña Roles (para que un rol nuevo que creado desde ahi funcione de
  // verdad, no solo quede como una casilla marcada sin efecto).
  const puedeCalcular = tienePermiso(usuario, "planilla.calcular");
  const puedeVerBoletas = tienePermiso(usuario, "boletas.ver");
  const puedeVerReportes = tienePermiso(usuario, "reportes.ver");
  const puedeVerVacaciones = tienePermiso(usuario, "vacaciones.gestionar");
  const puedeImportarMasivo = tienePermiso(usuario, "importacion.masiva");
  const puedeVerParametros = tienePermiso(usuario, "parametros.editar");
  const puedeVerConfiguracion = tienePermiso(usuario, "conceptos.editar");
  const puedeVerProyectos = tienePermiso(usuario, "proyectos.gestionar");
  const puedeVerEmpresa = tienePermiso(usuario, "empresa.editar");
  const puedeVerBitacora = tienePermiso(usuario, "bitacora.ver");

  return (
    <div className="app-shell">
      <Topbar
        usuario={usuario}
        onCambiarPassword={() => setCambiandoPassword((v) => !v)}
        onCerrarSesion={cerrarSesion}
      />

      <div className="app-layout">
        <Sidebar
          pestana={pestana}
          setPestana={setPestana}
          periodoSeleccionado={!!periodoSeleccionado}
          esAdmin={esAdmin}
          puedeCalcular={puedeCalcular}
          puedeVerBoletas={puedeVerBoletas}
          puedeVerReportes={puedeVerReportes}
          puedeVerVacaciones={puedeVerVacaciones}
          puedeImportarMasivo={puedeImportarMasivo}
          puedeVerParametros={puedeVerParametros}
          puedeVerConfiguracion={puedeVerConfiguracion}
          puedeVerProyectos={puedeVerProyectos}
          puedeVerEmpresa={puedeVerEmpresa}
          puedeVerBitacora={puedeVerBitacora}
        />

        <div className="main-content">
          {cambiandoPassword && <CambiarPassword onListo={() => setCambiandoPassword(false)} />}

          {pestana === "inicio" && <Dashboard nombreUsuario={usuario.nombre} />}
          {pestana === "trabajadores" && <Trabajadores />}
          {pestana === "importar" && puedeImportarMasivo && <Importar />}
          {pestana === "periodos" && (
            <Periodos
              onCargarTareo={irATareo}
              onTareoDiario={irATareoDiario}
              onCalcular={puedeCalcular ? irACalculo : undefined}
            />
          )}
          {pestana === "tareo" && periodoSeleccionado && (
            <Tareo periodo={periodoSeleccionado} onIrACalcular={() => setPestana("calculo")} />
          )}
          {pestana === "tareoDiario" && periodoSeleccionado && <TareoDiario periodo={periodoSeleccionado} />}
          {pestana === "calculo" && periodoSeleccionado && puedeCalcular && (
            <Calculo periodo={periodoSeleccionado} onVerBoletas={() => setPestana("boletas")} />
          )}
          {pestana === "boletas" && puedeVerBoletas && <Boletas periodoInicial={periodoSeleccionado} />}
          {pestana === "reportes" && puedeVerReportes && <Reportes />}
          {pestana === "vacaciones" && puedeVerVacaciones && <Vacaciones />}
          {pestana === "parametros" && puedeVerParametros && <Parametros />}
          {pestana === "configuracion" && puedeVerConfiguracion && <Configuracion />}
          {pestana === "bitacora" && puedeVerBitacora && <Bitacora />}
          {pestana === "proyectos" && puedeVerProyectos && <Proyectos />}
          {pestana === "usuarios" && esAdmin && <Usuarios />}
          {pestana === "roles" && esAdmin && <Roles />}
          {pestana === "empresa" && puedeVerEmpresa && <Empresa />}
        </div>
      </div>
    </div>
  );
}
