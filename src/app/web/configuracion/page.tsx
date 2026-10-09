import WebClient from "../WebClient";

export const dynamic = "force-dynamic";

/** Módulo Web — Configuración del sitio. */
export default function Page() {
  return <WebClient seccion="configuracion" />;
}
