import EventosClient from "../EventosClient";

export const dynamic = "force-dynamic";

/** Módulo Eventos — paquetes: qué se reserva de cada viaje y a qué precio. */
export default function Page() {
  return <EventosClient seccion="paquetes" />;
}
