import "server-only";
import type { KudeParsedFromXml, KudeItemRow } from "./parse-kude-from-signed-xml";
import type { SifenFacturaPayloadBase } from "./types";

/**
 * KuDE de vista previa, armado desde el borrador comercial.
 *
 * El KuDE real se arma leyendo el XML YA FIRMADO: de ahí salen el CDC, el QR y
 * el protocolo de autorización. Eso sirve para controlar el documento después
 * de emitirlo, que es justo cuando ya no se puede corregir nada.
 *
 * Esta versión se arma desde los mismos datos que irían al XML —emisor,
 * receptor, ítems, IVA y totales— pero SIN generar el XML, sin firmar, sin
 * CDC y sin tocar la numeración fiscal. Es para mirar antes de emitir.
 *
 * Por eso los campos que sólo existen en un documento emitido van vacíos: el
 * PDF los dibuja como lo que son, huecos, y arriba lleva el aviso de que no
 * tiene valor fiscal.
 */

const n2 = (v: number): string => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "0");

/** Tasa de IVA de una línea, deducida de sus montos. */
function tasaDe(subtotal: number, iva: number): 0 | 5 | 10 {
  if (iva <= 0 || subtotal <= 0) return 0;
  const r = iva / subtotal;
  // 10% sobre base = 0.1; 5% = 0.05. Se compara con holgura por el redondeo.
  return r > 0.075 ? 10 : 5;
}

export function kudeParsedDesdeBorrador(payload: SifenFacturaPayloadBase): KudeParsedFromXml {
  const { emisor, documento, receptor, items } = payload;

  let subExe = 0;
  let base5 = 0;
  let base10 = 0;
  let iva5 = 0;
  let iva10 = 0;

  const filas: KudeItemRow[] = items.map((it, i) => {
    const subtotal = Number(it.subtotal) || 0;
    const iva = Number(it.iva) || 0;
    const total = Number(it.total) || 0;
    const tasa = tasaDe(subtotal, iva);

    if (tasa === 10) {
      base10 += subtotal;
      iva10 += iva;
    } else if (tasa === 5) {
      base5 += subtotal;
      iva5 += iva;
    } else {
      subExe += total;
    }

    return {
      codigo: `L${i + 1}`,
      descripcion: it.descripcion,
      unidadMedida: "UNI",
      cantidad: n2(Number(it.cantidad) || 0),
      precioUnit: n2(Number(it.precio_unitario) || 0),
      totalLinea: n2(total),
      montoExenta: tasa === 0 ? n2(total) : "0",
      montoGrav5: tasa === 5 ? n2(total) : "0",
      montoGrav10: tasa === 10 ? n2(total) : "0",
    };
  });

  const totalOperacion = items.reduce((a, it) => a + (Number(it.total) || 0), 0);
  const [rucBase, dv] = String(emisor.ruc).split("-");

  return {
    /* Vacíos a propósito: sin CDC, sin QR y sin protocolo no hay forma de
       confundir esta hoja con un documento electrónico emitido. */
    cdc: "",
    dCarQR: null,
    dFeEmiDE: documento.fecha,
    monedaCodigo: documento.moneda === "USD" ? "USD" : "PYG",
    monedaDescripcion: documento.moneda === "USD" ? "Dólar" : "Guarani",
    timbrado: {
      dNumTim: emisor.timbrado_numero,
      dEst: emisor.establecimiento,
      dPunExp: emisor.punto_expedicion,
      /* El número de documento se asigna al emitir. Mostrar uno acá haría
         creer que esa numeración ya quedó tomada. */
      dNumDoc: "—",
      dFeIniT: emisor.timbrado_fecha_inicio_vigencia,
    },
    emisor: {
      dRucEm: rucBase ?? String(emisor.ruc),
      dDVEmi: dv ?? "",
      dNomEmi: emisor.razon_social,
      dDirEmi: emisor.direccion_fiscal,
      dTelEmi: "",
      dEmailE: "",
    },
    receptor: {
      nombre: receptor.nombre,
      docLabel: receptor.ruc ? "RUC" : "Documento",
      docValue: receptor.ruc || receptor.documento || "—",
      direccion: receptor.direccion || "",
      telefono: receptor.telefono || "",
    },
    operacion: {
      condicionVenta: documento.tipo === "credito" ? "Crédito" : "Contado",
      tipoOperacion: "Venta de mercadería y/o servicio",
    },
    totales: {
      dSubExe: n2(subExe),
      dSub5: n2(base5 + iva5),
      dSub10: n2(base10 + iva10),
      dTotOpe: n2(totalOperacion),
      dTotGralOpe: n2(totalOperacion),
      dIVA5: n2(iva5),
      dIVA10: n2(iva10),
      dBaseGrav5: n2(base5),
      dBaseGrav10: n2(base10),
      dTBasGraIVA: n2(base5 + base10),
      dTotIVA: n2(iva5 + iva10),
    },
    items: filas,
  };
}
