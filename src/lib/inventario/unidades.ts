/** Unidades de medida que ofrece el alta/edición de productos (se guardan en mayúsculas). */
export const UNIDADES_MEDIDA: { value: string; label: string }[] = [
  { value: "UNIDAD", label: "Unidad" },
  { value: "KG", label: "Kilogramo (KG)" },
  { value: "GR", label: "Gramo (GR)" },
  { value: "LT", label: "Litro (LT)" },
  { value: "ML", label: "Mililitro (ML)" },
  { value: "MT", label: "Metro (MT)" },
  { value: "CM", label: "Centímetro (CM)" },
  { value: "M2", label: "Metro cuadrado (M2)" },
  { value: "M3", label: "Metro cúbico (M3)" },
  { value: "CAJA", label: "Caja" },
  { value: "PAQUETE", label: "Paquete" },
  { value: "DOCENA", label: "Docena" },
  { value: "PAR", label: "Par" },
  { value: "ROLLO", label: "Rollo" },
  { value: "BOLSA", label: "Bolsa" },
  { value: "BOTELLA", label: "Botella" },
  { value: "LATA", label: "Lata" },
  { value: "SERVICIO", label: "Servicio" },
  { value: "HORA", label: "Hora" },
];

/**
 * Opciones para el select: si el producto ya tiene una unidad que no está en la lista
 * (cargada antes o por importación Excel), se agrega para no perderla al editar.
 */
export function opcionesUnidad(actual: string): { value: string; label: string }[] {
  const v = actual.trim().toUpperCase();
  if (!v || UNIDADES_MEDIDA.some((u) => u.value === v)) return UNIDADES_MEDIDA;
  return [{ value: v, label: v }, ...UNIDADES_MEDIDA];
}
