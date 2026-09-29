// Estilos reutilizados entre distintos componentes de boleta (Boleta.tsx,
// BoletaVacaciones.tsx), extraidos a un solo lugar en la migracion 040 para
// que ambos queden visualmente identicos (antes: Boleta.tsx ya tenia fondo
// azul/letra blanca en sus 3 encabezados de columna, pero BoletaVacaciones.tsx
// los mostraba en texto plano sin fondo - misma etiqueta, 2 apariencias
// distintas, justo la inconsistencia que el usuario pidio corregir).

// Encabezados de las 3 columnas (Ingresos/Descuentos/Aportes del empleador):
// fondo azul y texto blanco, pedido explicito del usuario (antes eran un
// simple <h3> en texto negro sin fondo, poco visibles al imprimir en blanco
// y negro/fotocopiar).
export const estiloTituloSeccionBoleta = {
  fontSize: "0.85rem",
  margin: "0 0 3px",
  padding: "3px 10px",
  background: "#2f6fed",
  color: "#ffffff",
  borderRadius: 4,
};
