"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import {
  COSTO_CATEGORIAS,
  TAREA_CATEGORIAS,
  TAREA_ESTADOS,
  type Costo,
  type SalidaOperacion,
  type Tarea,
} from "@/lib/operacion/operacion-data";

/**
 * Operación de las salidas.
 *
 * Ocupa el lugar del módulo Proyectos, que servía para gestionar desarrollos de
 * software y no tenía nada que ver con una operadora de viajes. Esto responde a
 * lo que pide el documento funcional: preparar cada salida (hoteles, motos,
 * seguros, guías, kits) y saber el margen estimado y real por evento.
 */

const PANEL =
  "min-w-0 rounded-2xl border border-[#4FAEB2]/45 bg-white p-5 shadow-sm shadow-slate-200/50 sm:p-6";
const TITULO =
  "flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600";
const INPUT =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

const ESTADO_TONO: Record<string, string> = {
  pendiente: "border-slate-200 bg-slate-50 text-slate-600",
  en_proceso: "border-sky-200 bg-sky-50 text-sky-700",
  hecha: "border-emerald-200 bg-emerald-50 text-emerald-700",
  bloqueada: "border-rose-200 bg-rose-50 text-rose-700",
};

const etiqueta = (v: string, lista: readonly { value: string; label: string }[]) =>
  lista.find((x) => x.value === v)?.label ?? v;

function plata(n: number, moneda: string): string {
  const entero = Math.round(n);
  return `${moneda} ${entero.toLocaleString("es-PY")}`;
}

function fecha(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

type Datos = { salidas: SalidaOperacion[]; tareas: Tarea[]; costos: Costo[] };

export default function OperacionClient() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Alta rápida
  const [tareaNueva, setTareaNueva] = useState({ titulo: "", categoria: "hotel", fecha_limite: "" });
  const [costoNuevo, setCostoNuevo] = useState({ concepto: "", categoria: "hotel", monto_estimado: "" });

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/operacion", { cache: "no-store" });
      const j = (await r.json()) as { success?: boolean; data?: Datos; error?: string };
      if (!r.ok || !j.success || !j.data) throw new Error(j.error ?? `Error ${r.status}`);
      setDatos(j.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function guardar(cuerpo: Record<string, unknown>) {
    setGuardando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/operacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const j = (await r.json()) as { success?: boolean; error?: string };
      if (!r.ok || !j.success) throw new Error(j.error ?? `Error ${r.status}`);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(tipo: "tarea" | "costo", id: string, que: string) {
    if (!window.confirm(`¿Borrar «${que}»?`)) return;
    setError(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/operacion?tipo=${tipo}&id=${id}`, { method: "DELETE" });
      const j = (await r.json()) as { success?: boolean; error?: string };
      if (!r.ok || !j.success) throw new Error(j.error ?? `Error ${r.status}`);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo borrar");
    }
  }

  const salida = useMemo(
    () => datos?.salidas.find((s) => s.id === abierta) ?? null,
    [datos, abierta]
  );
  const tareas = useMemo(
    () => (datos && abierta ? datos.tareas.filter((t) => t.salida_id === abierta) : []),
    [datos, abierta]
  );
  const costos = useMemo(
    () => (datos && abierta ? datos.costos.filter((c) => c.salida_id === abierta) : []),
    [datos, abierta]
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <header>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
            style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }}
          />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">
            Viajes
          </p>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Operación</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Lo que hay que dejar listo antes de cada salida, y lo que esa salida cuesta.
        </p>
      </header>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
          {error}
        </div>
      )}

      {cargando ? (
        <div className="py-20 text-center text-slate-400">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      ) : !datos || datos.salidas.length === 0 ? (
        <div className={PANEL}>
          <p className="py-10 text-center text-sm text-slate-400">
            Todavía no hay salidas cargadas. Creá un viaje y su salida en <b>Eventos</b>, y después
            volvé acá para preparar la operación.
          </p>
        </div>
      ) : (
        <>
          {/* ── Lista de salidas ─────────────────────────────────────────── */}
          <div className={PANEL}>
            <h2 className={TITULO}>
              <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]" />
              Salidas
            </h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60 text-slate-600">
                    <th className="px-3 py-2.5 font-semibold">Viaje</th>
                    <th className="px-3 py-2.5 font-semibold">Salida</th>
                    <th className="px-3 py-2.5 font-semibold">Preparación</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Ingresos</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Costos</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Margen</th>
                    <th className="px-3 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {datos.salidas.map((s) => {
                    const pct = s.tareas_total > 0 ? (s.tareas_hechas / s.tareas_total) * 100 : 0;
                    const abiertaEsta = abierta === s.id;
                    return (
                      <tr
                        key={s.id}
                        onClick={() => setAbierta(abiertaEsta ? null : s.id)}
                        className={`cursor-pointer border-b border-slate-50 transition-colors last:border-0 ${
                          abiertaEsta ? "bg-[#4FAEB2]/[0.06]" : "hover:bg-[#4FAEB2]/[0.04]"
                        }`}
                      >
                        <td className="px-3 py-3 font-medium text-slate-800">{s.evento_nombre}</td>
                        <td className="px-3 py-3 text-slate-600">
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                            <CalendarDays className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                            {fecha(s.fecha_inicio)}
                          </span>
                          <span className="ml-2 text-xs text-slate-400">
                            {s.reservas} {s.reservas === 1 ? "reserva" : "reservas"} · {s.participantes} pax
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          {s.tareas_total === 0 ? (
                            <span className="text-xs text-slate-400">Sin tareas</span>
                          ) : (
                            <div className="min-w-[120px]">
                              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className="h-full rounded-full bg-[#4FAEB2]"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-[11px] text-slate-500">
                                {s.tareas_hechas} de {s.tareas_total}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-700">
                          {plata(s.ingresos, s.moneda)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-700">
                          {plata(s.costo_vigente, s.moneda)}
                          {s.costo_real > 0 && s.costo_real !== s.costo_vigente ? null : null}
                        </td>
                        <td
                          className={`px-3 py-3 text-right font-semibold tabular-nums ${
                            s.margen < 0 ? "text-rose-600" : "text-emerald-700"
                          }`}
                        >
                          {plata(s.margen, s.moneda)}
                          {s.margen_pct != null && (
                            <span className="ml-1 text-[11px] font-normal text-slate-400">
                              {s.margen_pct.toFixed(0)}%
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <ChevronRight
                            className={`inline h-4 w-4 text-slate-400 transition-transform ${abiertaEsta ? "rotate-90" : ""}`}
                            aria-hidden
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] text-slate-400">
              Los ingresos son las reservas que ya cuentan como venta: la cotización no suma. El
              costo de cada línea usa el monto real si ya está facturado, y el estimado mientras
              tanto.
            </p>
          </div>

          {/* ── Detalle de la salida elegida ─────────────────────────────── */}
          {salida && (
            <div className="grid gap-5 lg:grid-cols-2">
              {/* Tareas */}
              <div className={PANEL}>
                <h2 className={TITULO}>
                  <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]" />
                  Preparación · {salida.evento_nombre}
                </h2>
                <p className="mt-1 text-[11px] text-slate-500">Salida del {fecha(salida.fecha_inicio)}</p>

                <div className="mt-4 space-y-2">
                  {tareas.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">
                      Sin tareas todavía.
                    </p>
                  ) : (
                    tareas.map((t) => (
                      <div
                        key={t.id}
                        className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5"
                      >
                        <select
                          value={t.estado}
                          onChange={(e) => void guardar({ tipo: "tarea", id: t.id, estado: e.target.value })}
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ESTADO_TONO[t.estado] ?? ESTADO_TONO.pendiente}`}
                          aria-label={`Estado de ${t.titulo}`}
                        >
                          {TAREA_ESTADOS.map((e) => (
                            <option key={e.value} value={e.value}>{e.label}</option>
                          ))}
                        </select>
                        <span className="min-w-0 flex-1 text-sm text-slate-800">{t.titulo}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                          {etiqueta(t.categoria, TAREA_CATEGORIAS)}
                        </span>
                        {t.fecha_limite && (
                          <span className="text-[11px] text-slate-400">{fecha(t.fecha_limite)}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => void borrar("tarea", t.id, t.titulo)}
                          className="text-slate-300 transition-colors hover:text-rose-600"
                          aria-label={`Borrar ${t.titulo}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
                  <div className="min-w-[180px] flex-1">
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Nueva tarea</label>
                    <input
                      className={INPUT}
                      value={tareaNueva.titulo}
                      onChange={(e) => setTareaNueva((f) => ({ ...f, titulo: e.target.value }))}
                      placeholder="Ej.: Reservar hotel de Chicago"
                    />
                  </div>
                  <select
                    className={`${INPUT} w-36`}
                    value={tareaNueva.categoria}
                    onChange={(e) => setTareaNueva((f) => ({ ...f, categoria: e.target.value }))}
                    aria-label="Categoría de la tarea"
                  >
                    {TAREA_CATEGORIAS.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                  <input
                    type="date"
                    className={`${INPUT} w-40`}
                    value={tareaNueva.fecha_limite}
                    onChange={(e) => setTareaNueva((f) => ({ ...f, fecha_limite: e.target.value }))}
                    aria-label="Fecha límite"
                  />
                  <button
                    type="button"
                    disabled={guardando || !tareaNueva.titulo.trim()}
                    onClick={async () => {
                      await guardar({ tipo: "tarea", salida_id: salida.id, ...tareaNueva, orden: tareas.length });
                      setTareaNueva({ titulo: "", categoria: "hotel", fecha_limite: "" });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3F8E91] disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    Agregar
                  </button>
                </div>
              </div>

              {/* Costos */}
              <div className={PANEL}>
                <h2 className={TITULO}>
                  <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]" />
                  Costos
                </h2>
                <p className="mt-1 text-[11px] text-slate-500">
                  Cargá el estimado al planificar y el real cuando llegue la factura.
                </p>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-600">
                        <th className="py-2 pr-2 text-[11px] font-semibold uppercase tracking-wide">Concepto</th>
                        <th className="py-2 pr-2 text-right text-[11px] font-semibold uppercase tracking-wide">Estimado</th>
                        <th className="py-2 pr-2 text-right text-[11px] font-semibold uppercase tracking-wide">Real</th>
                        <th className="py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {costos.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-6 text-center text-xs text-slate-400">
                            Sin costos cargados.
                          </td>
                        </tr>
                      ) : (
                        costos.map((c) => (
                          <tr key={c.id} className="border-b border-slate-50 last:border-0">
                            <td className="py-2.5 pr-2">
                              <span className="text-slate-800">{c.concepto}</span>
                              <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                                {etiqueta(c.categoria, COSTO_CATEGORIAS)}
                              </span>
                            </td>
                            <td className="py-2.5 pr-2 text-right tabular-nums text-slate-600">
                              {plata(c.monto_estimado, c.moneda)}
                            </td>
                            <td className="py-2.5 pr-2 text-right">
                              <input
                                type="number"
                                min={0}
                                defaultValue={c.monto_real ?? ""}
                                onBlur={(e) => {
                                  const v = e.target.value;
                                  if (String(c.monto_real ?? "") !== v) {
                                    void guardar({ tipo: "costo", id: c.id, monto_real: v });
                                  }
                                }}
                                placeholder="—"
                                className="w-28 rounded-lg border border-slate-200 px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-[#4FAEB2]"
                                aria-label={`Monto real de ${c.concepto}`}
                              />
                            </td>
                            <td className="py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => void borrar("costo", c.id, c.concepto)}
                                className="text-slate-300 transition-colors hover:text-rose-600"
                                aria-label={`Borrar ${c.concepto}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
                  <div className="min-w-[160px] flex-1">
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Nuevo costo</label>
                    <input
                      className={INPUT}
                      value={costoNuevo.concepto}
                      onChange={(e) => setCostoNuevo((f) => ({ ...f, concepto: e.target.value }))}
                      placeholder="Ej.: 15 noches hotel"
                    />
                  </div>
                  <select
                    className={`${INPUT} w-32`}
                    value={costoNuevo.categoria}
                    onChange={(e) => setCostoNuevo((f) => ({ ...f, categoria: e.target.value }))}
                    aria-label="Categoría del costo"
                  >
                    {COSTO_CATEGORIAS.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    className={`${INPUT} w-32`}
                    value={costoNuevo.monto_estimado}
                    onChange={(e) => setCostoNuevo((f) => ({ ...f, monto_estimado: e.target.value }))}
                    placeholder="Estimado"
                    aria-label="Monto estimado"
                  />
                  <button
                    type="button"
                    disabled={guardando || !costoNuevo.concepto.trim()}
                    onClick={async () => {
                      await guardar({
                        tipo: "costo",
                        salida_id: salida.id,
                        ...costoNuevo,
                        monto_estimado: costoNuevo.monto_estimado || 0,
                        moneda: salida.moneda,
                      });
                      setCostoNuevo({ concepto: "", categoria: "hotel", monto_estimado: "" });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3F8E91] disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    Agregar
                  </button>
                </div>

                <div className="mt-4 space-y-1 border-t border-slate-100 pt-4 text-sm">
                  <div className="flex justify-between text-slate-600">
                    <span>Ingresos</span>
                    <span className="tabular-nums">{plata(salida.ingresos, salida.moneda)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Costos</span>
                    <span className="tabular-nums">− {plata(salida.costo_vigente, salida.moneda)}</span>
                  </div>
                  <div
                    className={`flex justify-between border-t border-slate-200 pt-2 font-semibold ${
                      salida.margen < 0 ? "text-rose-600" : "text-emerald-700"
                    }`}
                  >
                    <span>Margen</span>
                    <span className="tabular-nums">
                      {plata(salida.margen, salida.moneda)}
                      {salida.margen_pct != null && ` · ${salida.margen_pct.toFixed(0)}%`}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
