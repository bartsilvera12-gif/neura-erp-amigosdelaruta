import BancosCatalogo from "@/components/config/BancosCatalogo";

/** Bancos, desde Configuración Global. La pantalla vive en `BancosCatalogo`
 *  porque también se publica como sub-página de Cobranzas. */
export default function Page() {
  return <BancosCatalogo />;
}
