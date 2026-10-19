/**
 * Consulta de RUC en SIFEN (servicio `consulta-ruc`).
 *
 * Contesta la pregunta que de otro modo depende de que alguien la averigüe en
 * Marangatú: **si ese RUC está habilitado como facturador electrónico**. La
 * SET devuelve `dRUCFactElec` = S/N, junto con el nombre y el estado del
 * contribuyente.
 *
 * Sirve, sobre todo, para distinguir dos causas del código 1264 («RUC del
 * emisor no está habilitado para utilizar este tipo de servicio»): que el RUC
 * no esté adherido al régimen, o que el problema sea otro.
 *
 * Mismo patrón que `consulta-lote`: SOAP 1.2 sobre mTLS con el .p12 de la
 * empresa, POST a la ruta `.wsdl`.
 */
import * as https from "node:https";
import { URL } from "node:url";
import type { AmbienteSifen } from "./types";
import { extractKeyAndCertFromP12 } from "./sign-xml";
import { urlConsultaRuc } from "./sifen-ws-urls";

const SIFEN_NS = "http://ekuatia.set.gov.py/sifen/xsd";
const SOAP_ENV = "http://www.w3.org/2003/05/soap-envelope";
const SOAP_ACTION_CONSULTA_RUC = "http://ekuatia.set.gov.py/sifen/xsd/SiConsRUC/consultaRUC";

export interface ConsultaRucParams {
  /** RUC sin dígito verificador. */
  ruc: string;
  empresaConfig: {
    ambiente?: AmbienteSifen;
    certificadoP12: Buffer;
    certificadoPassword: string;
  };
  dId?: number;
}

export interface ConsultaRucResultado {
  httpStatus: number;
  soapFault: boolean;
  faultString: string | null;
  /** Código de resultado de la consulta (0502 = RUC encontrado). */
  dCodRes: string | null;
  dMsgRes: string | null;
  /** RUC devuelto por la SET. */
  dRUCCons: string | null;
  razonSocial: string | null;
  /** Estado del contribuyente ante la SET. */
  dCodEstCons: string | null;
  dDesEstCons: string | null;
  /**
   * `S` si el contribuyente es facturador electrónico, `N` si no.
   * `null` si la respuesta no trae el campo.
   */
  esFacturadorElectronico: "S" | "N" | null;
  cuerpoSoapCrudo: string;
}

function generarDId(): number {
  const mod = BigInt("999999999999999");
  let n = Number(BigInt(Date.now()) % mod);
  if (!Number.isFinite(n) || n < 1) n = 1;
  return n;
}

function escaparXmlTexto(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function construirSoapConsultaRuc(dId: number, ruc: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap12:Envelope xmlns:soap12="${SOAP_ENV}" xmlns:xsd="${SIFEN_NS}">` +
    `<soap12:Header/>` +
    `<soap12:Body>` +
    `<xsd:rEnviConsRUC>` +
    `<xsd:dId>${dId}</xsd:dId>` +
    `<xsd:dRUCCons>${escaparXmlTexto(ruc)}</xsd:dRUCCons>` +
    `</xsd:rEnviConsRUC>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

/* La SET devuelve el texto con entidades XML: «SOCIEDAD AN&#211;NIMA». */
function decodificarEntidades(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function extraerTextoElemento(xml: string, local: string): string | null {
  const re = new RegExp(
    `<(?:[^\\s/>:]+:)?${local}\\b[^>]*>([\\s\\S]*?)</(?:[^\\s/>:]+:)?${local}\\b[^>]*>`,
    "i"
  );
  const m = xml.match(re);
  if (!m?.[1]) return null;
  const inner = decodificarEntidades(m[1].replace(/<[^>]+>/g, "")).trim();
  return inner.length > 0 ? inner : null;
}

function postHttpsMtls(
  urlStr: string,
  body: string,
  certPem: string,
  keyPem: string,
  contentType: string
): Promise<{ status: number; body: string }> {
  const url = new URL(urlStr);
  const port = url.port ? Number(url.port) : 443;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        cert: certPem,
        key: keyPem,
        rejectUnauthorized: true,
        headers: {
          "Content-Type": contentType,
          "Content-Length": Buffer.byteLength(body, "utf8"),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (ch) => chunks.push(ch as Buffer));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
        });
      }
    );
    req.on("error", reject);
    req.write(body, "utf8");
    req.end();
  });
}

export async function consultarRucSifen(
  params: ConsultaRucParams
): Promise<ConsultaRucResultado> {
  const ambiente: AmbienteSifen = params.empresaConfig.ambiente ?? "test";
  if (ambiente !== "test" && ambiente !== "produccion") {
    throw new Error('ambiente debe ser "test" o "produccion".');
  }

  /* La SET espera el RUC SIN dígito verificador: `80176053-4` se consulta como
     `80176053`. Mandarlo con el guion devuelve "no encontrado" y confunde. */
  const ruc = params.ruc.trim().split("-")[0]!.replace(/[^0-9]/g, "");
  if (!ruc) throw new Error("RUC inválido.");

  const soap = construirSoapConsultaRuc(params.dId ?? generarDId(), ruc);
  const { privateKeyPem, certificatePem } = extractKeyAndCertFromP12(
    params.empresaConfig.certificadoP12,
    params.empresaConfig.certificadoPassword
  );

  const res = await postHttpsMtls(
    urlConsultaRuc(ambiente),
    soap,
    certificatePem,
    privateKeyPem,
    `application/soap+xml; charset=utf-8; action="${SOAP_ACTION_CONSULTA_RUC}"`
  );

  const xml = res.body ?? "";
  if (/<faultstring>/i.test(xml) || /<(?:[a-z0-9]+:)?fault\b/i.test(xml)) {
    return {
      httpStatus: res.status,
      soapFault: true,
      faultString: extraerTextoElemento(xml, "faultstring") ?? "SOAP Fault",
      dCodRes: null,
      dMsgRes: null,
      dRUCCons: null,
      razonSocial: null,
      dCodEstCons: null,
      dDesEstCons: null,
      esFacturadorElectronico: null,
      cuerpoSoapCrudo: xml,
    };
  }

  const fe = (extraerTextoElemento(xml, "dRUCFactElec") ?? "").trim().toUpperCase();

  return {
    httpStatus: res.status,
    soapFault: false,
    faultString: null,
    dCodRes: extraerTextoElemento(xml, "dCodRes"),
    dMsgRes: extraerTextoElemento(xml, "dMsgRes"),
    dRUCCons: extraerTextoElemento(xml, "dRUCCons"),
    razonSocial: extraerTextoElemento(xml, "dRazCons"),
    dCodEstCons: extraerTextoElemento(xml, "dCodEstCons"),
    dDesEstCons: extraerTextoElemento(xml, "dDesEstCons"),
    esFacturadorElectronico: fe === "S" ? "S" : fe === "N" ? "N" : null,
    cuerpoSoapCrudo: xml,
  };
}
