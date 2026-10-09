import EventosClient from "../EventosClient";

export const dynamic = "force-dynamic";

/** Módulo Eventos — salidas programadas. */
export default function Page() {
  return <EventosClient seccion="salidas" />;
}
