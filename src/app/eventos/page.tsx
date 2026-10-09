import EventosClient from "./EventosClient";

export const dynamic = "force-dynamic";

/** Módulo Eventos — viajes y rallies. */
export default function Page() {
  return <EventosClient seccion="viajes" />;
}
