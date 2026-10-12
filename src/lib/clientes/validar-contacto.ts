/**
 * Validación y filtrado de los datos de contacto de clientes y proveedores.
 *
 * Los filtros (`solo*`) se aplican mientras se tipea; las validaciones (`error*`) al guardar.
 * El email NO se transforma tecla a tecla: un input type="email" no expone la posición del
 * cursor, así que cualquier cambio del valor (p. ej. pasarlo a minúsculas) lo manda al final
 * y lo que se escribe delante de "@gmail.com" termina pegado detrás. Se normaliza al guardar.
 */

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

/** Email listo para guardar: sin espacios y en minúsculas. */
export function normalizarEmail(v: string): string {
  return v.replace(/\s/g, "").toLowerCase();
}

/** Nombres de persona, ciudad y país: sin dígitos. */
export function soloSinDigitos(v: string): string {
  return v.replace(/[0-9]/g, "");
}

/** RUC: dígitos y un guión antes del dígito verificador. */
export function soloRuc(v: string): string {
  return v.replace(/[^0-9-]/g, "");
}

/** Cédula / documento: dígitos y letras (pasaportes extranjeros), sin símbolos. */
export function soloDocumento(v: string): string {
  return v.replace(/[^0-9A-Za-z]/g, "");
}

/** Proveedores de correo conocidos y el dominio que realmente usan (detecta "gmail.commpresa"). */
const DOMINIOS_CONOCIDOS: Record<string, RegExp> = {
  gmail: /^gmail\.com$/,
  hotmail: /^hotmail\.(com|es)(\.[a-z]{2})?$/,
  outlook: /^outlook\.(com|es)(\.[a-z]{2})?$/,
  yahoo: /^yahoo\.(com|es)(\.[a-z]{2})?$/,
  icloud: /^icloud\.com$/,
  live: /^live\.com(\.[a-z]{2})?$/,
};

export function errorEmail(v: string, etiqueta = "El email"): string | null {
  const e = normalizarEmail(v);
  if (!e) return null;
  if (!EMAIL_RE.test(e)) return `${etiqueta} no es válido (ej.: nombre@empresa.com).`;
  const dominio = e.slice(e.indexOf("@") + 1);
  const proveedor = dominio.split(".")[0];
  const esperado = DOMINIOS_CONOCIDOS[proveedor];
  if (esperado && !esperado.test(dominio)) {
    return `${etiqueta} tiene el dominio mal escrito («${dominio}»). Revisá lo que va después de la @.`;
  }
  return null;
}

export function errorRuc(v: string, etiqueta = "El RUC"): string | null {
  const r = v.trim();
  if (!r) return null;
  return /^\d{3,9}-\d$/.test(r) ? null : `${etiqueta} debe tener el formato 00000000-0.`;
}

export function errorTelefono(v: string, etiqueta = "El teléfono"): string | null {
  const d = v.replace(/\D/g, "");
  if (!d) return null;
  return d.length >= 7 && d.length <= 15 ? null : `${etiqueta} está incompleto.`;
}

/** Nombre de persona: al menos una letra y sin dígitos. */
export function errorNombrePersona(v: string, etiqueta = "El nombre"): string | null {
  const n = v.trim();
  if (!n) return null;
  if (/[0-9]/.test(n)) return `${etiqueta} no puede tener números.`;
  if (!/\p{L}/u.test(n)) return `${etiqueta} debe tener letras.`;
  return null;
}

/** Nombre de empresa: puede llevar números ("ESTACIÓN 24 S.A."), pero no puede ser solo números. */
export function errorNombreEmpresa(v: string, etiqueta = "El nombre de empresa"): string | null {
  const n = v.trim();
  if (!n) return null;
  return /\p{L}/u.test(n) ? null : `${etiqueta} debe tener letras, no solo números.`;
}

/**
 * Tras transformar el valor de un input controlado (mayúsculas, quitar dígitos), React lo
 * reescribe y el cursor salta al final. Esto lo devuelve a donde estaba, descontando lo que
 * el filtro haya quitado. No aplica a type="email"/"number", que no exponen la selección.
 */
export function mantenerCursor(
  input: EventTarget & { selectionStart?: number | null; setSelectionRange?: (a: number, b: number) => void },
  antes: string,
  despues: string
): void {
  if (antes === despues) return;
  let pos: number | null | undefined;
  try {
    pos = input.selectionStart;
  } catch {
    return;
  }
  if (pos == null || !input.setSelectionRange) return;
  const p = Math.max(0, pos - (antes.length - despues.length));
  requestAnimationFrame(() => {
    try {
      input.setSelectionRange?.(p, p);
    } catch {
      /* el input ya no está montado */
    }
  });
}
