import BancosCatalogo from "@/components/config/BancosCatalogo";

/**
 * Bancos, colgado de Cobranzas.
 *
 * En esta instancia Configuración no está en el menú, así que el catálogo de
 * bancos era inalcanzable: QA no tenía por dónde crear uno. Desde acá se llega
 * con el permiso del módulo Cobranzas, que es además donde se usan (alimentan
 * el desplegable «Banco de origen» de los cobros por transferencia).
 */
export default function Page() {
  return <BancosCatalogo volverA="/cobranzas" volverLabel="Cobranzas" />;
}
