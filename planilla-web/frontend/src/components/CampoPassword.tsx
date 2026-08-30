import { useState } from "react";

// Campo de contraseña con boton para mostrar/ocultar el texto mientras se
// escribe. Se usa en Login y CambiarPassword para poder verificar que se
// escribio correctamente antes de enviar el formulario.
export default function CampoPassword({
  value,
  onChange,
  required,
  minLength,
  autoComplete,
}: {
  value: string;
  onChange: (valor: string) => void;
  required?: boolean;
  minLength?: number;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div style={{ display: "flex", gap: 6 }}>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        style={{ flex: 1 }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        title={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        style={{
          padding: "0 12px",
          border: "1px solid #d5d9e0",
          borderRadius: 6,
          background: "#f5f6f8",
          color: "#454c5c",
          fontSize: "0.82rem",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {visible ? "Ocultar" : "Mostrar"}
      </button>
    </div>
  );
}
