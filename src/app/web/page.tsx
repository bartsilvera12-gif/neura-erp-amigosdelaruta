import WebClient from "./WebClient";

export const dynamic = "force-dynamic";

/** Módulo Web — Tienda del sitio. */
export default function Page() {
  return <WebClient seccion="tienda" />;
}
