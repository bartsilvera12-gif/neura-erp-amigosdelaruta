import EventosClient from "../EventosClient";

export const dynamic = "force-dynamic";

/** Módulo Eventos — reservas recibidas. */
export default function Page() {
  return <EventosClient seccion="reservas" />;
}
