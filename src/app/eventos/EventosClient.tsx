"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RefreshCw, Route, Save, Plus, AlertCircle, Check } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Módulo Eventos: viajes y rallies del club.
 *
 * Modelo: Tour (`eventos`) → Salida (`salidas`) → Paquete (`paquetes`) →
 * Reserva (`reservas`). Esta primera versión edita el tour y muestra salidas y
 * reservas en modo lectura; el alta de salidas, paquetes y reservas va después.
 */

export type SeccionEventos = "viajes" | "salidas" | "reservas";

const SECCIONES: { id: SeccionEventos; label: string; href: string }[] = [
  { id: "viajes", label: "Viajes", href: "/eventos" },
  { id: "salidas", label: "Salidas", href: "/eventos/salidas" },
  { id: "reservas", label: "Reservas", href: "/eventos/reservas" },
];

const IDIOMAS = ["es", "pt", "en"] as const;

type Fila = Record<string, unknown>;

type Datos = { eventos: Fila[]; salidas: Fila[]; reservas: Fila[] };
const VACIO: Datos = { eventos: [], salidas: [], reservas: [] };

function textoDe(v: unknown, idioma: string): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const x = (v as Record<string, unknown>)[idioma];
    return typeof x === "string" ? x : "";
  }
  return "";
}

function ponerIdioma(v: unknown, idioma: string, texto: string): Record<string, string> {
  const base: Record<string, string> = {};
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (typeof x === "string") base[k] = x;
    }
  } else if (typeof v === "string") {
    base.es = v;
  }
  base[idioma] = texto;
  return base;
}

const input =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";
const lbl = "mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500";

export default function EventosClient({ seccion }: { seccion: SeccionEventos }) {
  const pathname = usePathname() ?? "/eventos";
  const [data, setData] = useState<Datos>(VACIO);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, Fila>>({});

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/eventos", { cache: "no-store" });
      const j = (await r.json()) as { success?: boolean; data?: Datos; error?: string };
      if (!j.success || !j.data) throw new Error(j.error ?? "No se pudieron cargar los eventos.");
      setData(j.data);
      setDraft({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const guardar = useCallback(
    async (id: string | null, valores: Fila, clave: string) => {
      setGuardando(clave);
      setError(null);
      setOkMsg(null);
      try {
        const r = await fetchWithSupabaseSession("/api/eventos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, valores }),
        });
        const j = (await r.json()) as { success?: boolean; error?: string };
        if (!j.success) throw new Error(j.error ?? "No se pudo guardar.");
        setOkMsg("Guardado.");
        await cargar();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      } finally {
        setGuardando(null);
      }
    },
    [cargar]
  );

  const setCampo = (clave: string, campo: string, valor: unknown) =>
    setDraft((d) => ({ ...d, [clave]: { ...(d[clave] ?? {}), [campo]: valor } }));
  const valorDe = (clave: string, fila: Fila | null, campo: string) =>
    draft[clave]?.[campo] !== undefined ? draft[clave][campo] : fila?.[campo];

  const nombreEvento = (id: unknown) => {
    const e = data.eventos.find((x) => String(x.id) === String(id));
    return e ? textoDe(e.nombre, "es") || String(e.slug ?? "") : "—";
  };

  const formEvento = (clave: string, e: Fila | null) => (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <div className={lbl}>Slug (URL)</div>
          <input
            className={input}
            placeholder="route-66"
            value={String(valorDe(clave, e, "slug") ?? "")}
            onChange={(ev) => setCampo(clave, "slug", ev.target.value)}
          />
        </div>
        <div>
          <div className={lbl}>País</div>
          <input
            className={input}
            value={String(valorDe(clave, e, "pais") ?? "")}
            onChange={(ev) => setCampo(clave, "pais", ev.target.value)}
          />
        </div>
        <div>
          <div className={lbl}>Estado</div>
          <select
            className={input}
            value={String(valorDe(clave, e, "estado") ?? "borrador")}
            onChange={(ev) => setCampo(clave, "estado", ev.target.value)}
          >
            <option value="borrador">Borrador</option>
            <option value="publicado">Publicado</option>
            <option value="cerrado">Cerrado</option>
          </select>
        </div>
      </div>

      <div>
        <div className={lbl}>Nombre</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {IDIOMAS.map((i) => (
            <input
              key={i}
              className={input}
              placeholder={i.toUpperCase()}
              value={textoDe(valorDe(clave, e, "nombre"), i)}
              onChange={(ev) =>
                setCampo(clave, "nombre", ponerIdioma(valorDe(clave, e, "nombre"), i, ev.target.value))
              }
            />
          ))}
        </div>
      </div>

      <div>
        <div className={lbl}>Resumen</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {IDIOMAS.map((i) => (
            <textarea
              key={i}
              rows={2}
              className={input}
              placeholder={i.toUpperCase()}
              value={textoDe(valorDe(clave, e, "resumen"), i)}
              onChange={(ev) =>
                setCampo(clave, "resumen", ponerIdioma(valorDe(clave, e, "resumen"), i, ev.target.value))
              }
            />
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <div className={lbl}>Días</div>
          <input
            type="number"
            className={input}
            value={String(valorDe(clave, e, "duracion_dias") ?? "")}
            onChange={(ev) =>
              setCampo(clave, "duracion_dias", ev.target.value ? Number(ev.target.value) : null)
            }
          />
        </div>
        <div>
          <div className={lbl}>Noches</div>
          <input
            type="number"
            className={input}
            value={String(valorDe(clave, e, "noches") ?? "")}
            onChange={(ev) => setCampo(clave, "noches", ev.target.value ? Number(ev.target.value) : null)}
          />
        </div>
        <div>
          <div className={lbl}>Km</div>
          <input
            type="number"
            className={input}
            value={String(valorDe(clave, e, "distancia_km") ?? "")}
            onChange={(ev) =>
              setCampo(clave, "distancia_km", ev.target.value ? Number(ev.target.value) : null)
            }
          />
        </div>
        <div>
          <div className={lbl}>Orden</div>
          <input
            type="number"
            className={input}
            value={Number(valorDe(clave, e, "orden") ?? 0)}
            onChange={(ev) => setCampo(clave, "orden", Number(ev.target.value))}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className={lbl}>Portada (URL)</div>
          <input
            className={input}
            placeholder="https://…"
            value={String(valorDe(clave, e, "portada_url") ?? "")}
            onChange={(ev) => setCampo(clave, "portada_url", ev.target.value)}
          />
        </div>
        <div className="flex items-end gap-4 pb-2">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={Boolean(valorDe(clave, e, "destacado"))}
              onChange={(ev) => setCampo(clave, "destacado", ev.target.checked)}
            />
            Destacado
          </label>
        </div>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[#4FAEB2]">
            <Route className="h-4 w-4" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">Eventos</span>
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Viajes y rallies
          </h1>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-slate-500">
            Un viaje puede tener varias salidas, y cada salida sus paquetes. Lo que esté en estado{" "}
            <strong>publicado</strong> es lo que muestra el sitio.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void cargar()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400"
        >
          <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      <nav className="mt-6 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {SECCIONES.map((s) => (
          <Link
            key={s.id}
            href={s.href}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              pathname === s.href ? "bg-[#4FAEB2] text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </nav>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {okMsg && !error && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <Check className="h-4 w-4 shrink-0" />
          <span>{okMsg}</span>
        </div>
      )}

      {cargando ? (
        <div className="py-20 text-center text-sm text-slate-500">Cargando…</div>
      ) : seccion === "viajes" ? (
        <div className="mt-6 space-y-4">
          {data.eventos.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
              Todavía no hay viajes cargados.
            </div>
          )}
          {data.eventos.map((e) => {
            const id = String(e.id);
            const clave = `ev:${id}`;
            return (
              <section key={id} className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">
                    {textoDe(e.nombre, "es") || String(e.slug ?? "sin nombre")}
                  </div>
                  <div className="text-xs text-slate-500">
                    {Number(e.salidas_count ?? 0)} salidas · {Number(e.reservas_count ?? 0)} reservas
                  </div>
                </div>
                {formEvento(clave, e)}
                <button
                  type="button"
                  disabled={guardando === clave}
                  onClick={() => void guardar(id, draft[clave] ?? {}, clave)}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  {guardando === clave ? "Guardando…" : "Guardar"}
                </button>
              </section>
            );
          })}

          <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-5">
            <div className="mb-4 text-sm font-semibold text-slate-700">Nuevo viaje</div>
            {formEvento("ev:nuevo", null)}
            <button
              type="button"
              disabled={guardando === "ev:nuevo"}
              onClick={() =>
                void guardar(null, { estado: "borrador", ...(draft["ev:nuevo"] ?? {}) }, "ev:nuevo")
              }
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {guardando === "ev:nuevo" ? "Creando…" : "Crear viaje"}
            </button>
          </section>
        </div>
      ) : seccion === "salidas" ? (
        <Tabla
          vacio="Todavía no hay salidas cargadas."
          filas={data.salidas}
          columnas={[
            { th: "Viaje", td: (f) => nombreEvento(f.evento_id) },
            { th: "Código", td: (f) => String(f.codigo ?? "—") },
            { th: "Desde", td: (f) => String(f.fecha_inicio ?? "—") },
            { th: "Hasta", td: (f) => String(f.fecha_fin ?? "—") },
            { th: "Cupo", td: (f) => String(f.cupo_total ?? "—") },
            { th: "Estado", td: (f) => String(f.estado ?? "—") },
          ]}
        />
      ) : (
        <Tabla
          vacio="Todavía no hay reservas."
          filas={data.reservas}
          columnas={[
            { th: "Código", td: (f) => String(f.codigo ?? "—") },
            { th: "Viaje", td: (f) => nombreEvento(f.evento_id) },
            { th: "Personas", td: (f) => String(f.cantidad_participantes ?? "—") },
            {
              th: "Precio",
              td: (f) => `${String(f.moneda ?? "")} ${String(f.precio_paquete ?? "—")}`,
            },
            { th: "Origen", td: (f) => String(f.origen ?? "—") },
            { th: "Estado", td: (f) => String(f.estado ?? "—") },
          ]}
        />
      )}
    </div>
  );
}

function Tabla({
  filas,
  columnas,
  vacio,
}: {
  filas: Fila[];
  columnas: { th: string; td: (f: Fila) => string }[];
  vacio: string;
}) {
  if (filas.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
        {vacio}
      </div>
    );
  }
  return (
    <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-left">
          <tr>
            {columnas.map((c) => (
              <th key={c.th} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {c.th}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={String(f.id ?? i)} className="border-b border-slate-100 last:border-0">
              {columnas.map((c) => (
                <td key={c.th} className="px-4 py-3 text-slate-700">
                  {c.td(f)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
