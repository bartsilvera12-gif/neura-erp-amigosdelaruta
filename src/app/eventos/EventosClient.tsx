"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RefreshCw, Route, Save, Plus, AlertCircle, Check } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import CampoImagen from "@/components/web/CampoImagen";

/**
 * Módulo Eventos: viajes y rallies del club.
 *
 * Modelo: Tour (`eventos`) → Salida (`salidas`) → Paquete (`paquetes`) →
 * Reserva (`reservas`). Esta primera versión edita el tour y muestra salidas y
 * reservas en modo lectura; el alta de salidas, paquetes y reservas va después.
 */

export type SeccionEventos = "viajes" | "salidas" | "paquetes" | "reservas";

/*
 * Los estados de `salidas`, repetidos acá a propósito: la lista también vive en
 * `eventos-data.ts`, pero ese módulo es `server-only` e importarlo desde una
 * pantalla rompe el build de producción. Tiene que coincidir con
 * `salidas_estado_chk`.
 */
const SALIDA_ESTADOS = [
  { value: "borrador", label: "Borrador" },
  { value: "abierta", label: "Abierta" },
  { value: "confirmada", label: "Confirmada" },
  { value: "lista_espera", label: "Lista de espera" },
  { value: "cerrada", label: "Cerrada" },
  { value: "finalizada", label: "Finalizada" },
] as const;

const SECCIONES: { id: SeccionEventos; label: string; href: string }[] = [
  { id: "viajes", label: "Viajes", href: "/eventos" },
  { id: "salidas", label: "Salidas", href: "/eventos/salidas" },
  { id: "paquetes", label: "Paquetes", href: "/eventos/paquetes" },
  { id: "reservas", label: "Reservas", href: "/eventos/reservas" },
];

const IDIOMAS = ["es", "pt", "en"] as const;

type Fila = Record<string, unknown>;

type Datos = { eventos: Fila[]; salidas: Fila[]; reservas: Fila[]; participantes: Fila[]; paquetes: Fila[] };
const VACIO: Datos = { eventos: [], salidas: [], reservas: [], participantes: [], paquetes: [] };

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
    async (id: string | null, valores: Fila, clave: string, tipo: "evento" | "salida" | "paquete" = "evento") => {
      setGuardando(clave);
      setError(null);
      setOkMsg(null);
      try {
        const r = await fetchWithSupabaseSession("/api/eventos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tipo, id, valores }),
        });
        const j = (await r.json()) as { success?: boolean; error?: string };
        if (!j.success) throw new Error(j.error ?? "No se pudo guardar.");
        setOkMsg("Guardado.");
        setDraft((d) => {
          const { [clave]: _ya, ...resto } = d;
          return resto;
        });
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

  /*
   * La base exige que el slug sea `^[a-z0-9]+(-[a-z0-9]+)*$`. Escribirlo a mano
   * terminaba casi siempre en un error de Postgres sin traducir
   * («violates check constraint "eventos_slug_chk"»), porque cualquier
   * mayúscula, acento o espacio lo rompe. Se normaliza mientras se escribe.
   */
  const aSlug = (v: string): string =>
    v
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")   // saca los acentos: «Ñ» → «N», «á» → «a»
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

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
            onChange={(ev) => setCampo(clave, "slug", aSlug(ev.target.value))}
            onBlur={() => {
              // Vacío al salir: se deduce del nombre en castellano.
              if (String(valorDe(clave, e, "slug") ?? "").trim()) return;
              const nom = valorDe(clave, e, "nombre");
              const es = nom && typeof nom === "object" ? (nom as Record<string, unknown>).es : nom;
              const auto = aSlug(typeof es === "string" ? es : "");
              if (auto) setCampo(clave, "slug", auto);
            }}
          />
          <p className="mt-1 text-[11px] text-slate-400">
            Sólo minúsculas, números y guiones. Si lo dejás vacío se arma con el nombre.
          </p>
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
            /* Sin `Number()` sobre el valor mostrado: con el campo en 0, borrar
               el 0 daba "" y `Number("")` lo devolvia a 0, asi que no habia
               forma de vaciarlo y todo lo que se escribia quedaba detras del
               cero. Se guarda el texto y se convierte al salir. */
            value={String(valorDe(clave, e, "orden") ?? "")}
            onChange={(ev) => setCampo(clave, "orden", ev.target.value)}
            onBlur={(ev) => setCampo(clave, "orden", ev.target.value === "" ? 0 : Number(ev.target.value))}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <CampoImagen
          label="Portada"
          coleccion="evento"
          idFila={e ? String(e.id) : null}
          valor={String(valorDe(clave, e, "portada_url") ?? "")}
          onChange={(url) => setCampo(clave, "portada_url", url)}
        />
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
        <div className="space-y-6">
          <Tabla
            vacio="Todavía no hay salidas cargadas. Creá la primera acá abajo."
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

          {/* Alta de salidas. Sin esto, Operación no tenía de qué colgarse. */}
          <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-5">
            <div className="mb-1 text-sm font-semibold text-slate-700">Nueva salida</div>
            <p className="mb-4 text-xs text-slate-500">
              La fecha concreta de un viaje. De ella cuelgan las reservas y la preparación en
              Operación.
            </p>

            {data.eventos.length === 0 ? (
              <p className="text-sm text-slate-500">
                Primero creá un viaje en la pestaña <b>Viajes</b>.
              </p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <div className={lbl}>Viaje *</div>
                    <select
                      className={input}
                      value={String(valorDe("sal:nuevo", null, "evento_id") ?? "")}
                      onChange={(ev) => setCampo("sal:nuevo", "evento_id", ev.target.value)}
                    >
                      <option value="">Elegí un viaje…</option>
                      {data.eventos.map((e) => (
                        <option key={String(e.id)} value={String(e.id)}>
                          {textoDe(e.nombre, "es") || String(e.slug ?? "sin nombre")}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className={lbl}>Desde *</div>
                    <input
                      type="date"
                      className={input}
                      value={String(valorDe("sal:nuevo", null, "fecha_inicio") ?? "")}
                      onChange={(ev) => setCampo("sal:nuevo", "fecha_inicio", ev.target.value)}
                    />
                  </div>
                  <div>
                    <div className={lbl}>Hasta</div>
                    <input
                      type="date"
                      className={input}
                      value={String(valorDe("sal:nuevo", null, "fecha_fin") ?? "")}
                      onChange={(ev) => setCampo("sal:nuevo", "fecha_fin", ev.target.value)}
                    />
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <div>
                    <div className={lbl}>Código</div>
                    <input
                      className={input}
                      placeholder="R66-2027-07"
                      value={String(valorDe("sal:nuevo", null, "codigo") ?? "")}
                      onChange={(ev) => setCampo("sal:nuevo", "codigo", ev.target.value)}
                    />
                  </div>
                  <div>
                    <div className={lbl}>Cupo</div>
                    <input
                      type="number"
                      min={0}
                      className={input}
                      value={String(valorDe("sal:nuevo", null, "cupo_total") ?? "")}
                      onChange={(ev) => setCampo("sal:nuevo", "cupo_total", ev.target.value)}
                    />
                  </div>
                  <div>
                    <div className={lbl}>Cierre de inscripción</div>
                    <input
                      type="date"
                      className={input}
                      value={String(valorDe("sal:nuevo", null, "fecha_limite_inscripcion") ?? "")}
                      onChange={(ev) =>
                        setCampo("sal:nuevo", "fecha_limite_inscripcion", ev.target.value)
                      }
                    />
                  </div>
                  <div>
                    <div className={lbl}>Estado</div>
                    <select
                      className={input}
                      value={String(valorDe("sal:nuevo", null, "estado") ?? "borrador")}
                      onChange={(ev) => setCampo("sal:nuevo", "estado", ev.target.value)}
                    >
                      {SALIDA_ESTADOS.map((e) => (
                        <option key={e.value} value={e.value}>
                          {e.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={guardando === "sal:nuevo"}
                  onClick={() =>
                    void guardar(
                      null,
                      { estado: "borrador", ...(draft["sal:nuevo"] ?? {}) },
                      "sal:nuevo",
                      "salida"
                    )
                  }
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  {guardando === "sal:nuevo" ? "Creando…" : "Crear salida"}
                </button>
              </>
            )}
          </section>
        </div>
      ) : seccion === "paquetes" ? (
        <div className="space-y-6">
          <Tabla
            vacio="Todavía no hay paquetes. Sin al menos uno, el viaje no se puede reservar desde el sitio."
            filas={data.paquetes}
            columnas={[
              { th: "Viaje", td: (f) => nombreEvento(f.evento_id) },
              { th: "Paquete", td: (f) => textoDe(f.nombre, "es") || "—" },
              { th: "Personas", td: (f) => String(f.personas ?? "—") },
              { th: "Motos", td: (f) => String(f.motos ?? "—") },
              {
                th: "Precio",
                td: (f) =>
                  `${String(f.moneda ?? "USD")} ${Number(f.precio ?? 0).toLocaleString("es-PY")}`,
              },
              { th: "Activo", td: (f) => (f.activo === false ? "No" : "Sí") },
            ]}
          />

          {/* Alta de paquetes. Sin paquete no hay precio, y sin precio el sitio
              no ofrece el viaje para reservar. */}
          <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-5">
            <div className="mb-1 text-sm font-semibold text-slate-700">Nuevo paquete</div>
            <p className="mb-4 text-xs text-slate-500">
              Qué incluye la reserva y cuánto sale. Un viaje necesita al menos uno para poder
              reservarse desde el sitio.
            </p>

            {data.eventos.length === 0 ? (
              <p className="text-sm text-slate-500">
                Primero creá un viaje en la pestaña <b>Viajes</b>.
              </p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <div className={lbl}>Viaje *</div>
                    <select
                      className={input}
                      value={String(valorDe("paq:nuevo", null, "evento_id") ?? "")}
                      onChange={(ev) => setCampo("paq:nuevo", "evento_id", ev.target.value)}
                    >
                      <option value="">Elegí un viaje…</option>
                      {data.eventos.map((e) => (
                        <option key={String(e.id)} value={String(e.id)}>
                          {textoDe(e.nombre, "es") || String(e.slug ?? "sin nombre")}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <div className={lbl}>Nombre del paquete *</div>
                    <input
                      className={input}
                      placeholder="Piloto solo · Piloto + acompañante"
                      value={String(valorDe("paq:nuevo", null, "nombre_es") ?? "")}
                      onChange={(ev) => setCampo("paq:nuevo", "nombre_es", ev.target.value)}
                    />
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <div>
                    <div className={lbl}>Personas</div>
                    <input
                      type="number"
                      min={1}
                      className={input}
                      value={String(valorDe("paq:nuevo", null, "personas") ?? "1")}
                      onChange={(ev) => setCampo("paq:nuevo", "personas", ev.target.value)}
                    />
                  </div>
                  <div>
                    <div className={lbl}>Motos</div>
                    <input
                      type="number"
                      min={0}
                      className={input}
                      value={String(valorDe("paq:nuevo", null, "motos") ?? "1")}
                      onChange={(ev) => setCampo("paq:nuevo", "motos", ev.target.value)}
                    />
                  </div>
                  <div>
                    <div className={lbl}>Precio *</div>
                    <input
                      type="number"
                      min={0}
                      className={input}
                      placeholder="7900"
                      value={String(valorDe("paq:nuevo", null, "precio") ?? "")}
                      onChange={(ev) => setCampo("paq:nuevo", "precio", ev.target.value)}
                    />
                  </div>
                  <div>
                    <div className={lbl}>Moneda</div>
                    <select
                      className={input}
                      value={String(valorDe("paq:nuevo", null, "moneda") ?? "USD")}
                      onChange={(ev) => setCampo("paq:nuevo", "moneda", ev.target.value)}
                    >
                      <option value="USD">USD</option>
                      <option value="PYG">PYG</option>
                      <option value="BRL">BRL</option>
                    </select>
                  </div>
                </div>

                <div className="mt-3">
                  <div className={lbl}>Qué incluye</div>
                  <input
                    className={input}
                    placeholder="2 personas · 2 motos · 1 habitación doble"
                    value={String(valorDe("paq:nuevo", null, "detalle_es") ?? "")}
                    onChange={(ev) => setCampo("paq:nuevo", "detalle_es", ev.target.value)}
                  />
                </div>

                <button
                  type="button"
                  disabled={guardando === "paq:nuevo"}
                  onClick={() => {
                    const d = draft["paq:nuevo"] ?? {};
                    const nom = String(d.nombre_es ?? "").trim();
                    if (!nom) {
                      setError("El paquete necesita un nombre.");
                      return;
                    }
                    /* Los textos del sitio son multilingües; se carga el
                       castellano y el sitio usa ese como respaldo para los
                       otros idiomas. */
                    void guardar(
                      null,
                      {
                        evento_id: d.evento_id,
                        nombre: { es: nom },
                        detalle: d.detalle_es ? { es: String(d.detalle_es) } : {},
                        personas: d.personas ?? 1,
                        motos: d.motos ?? 0,
                        precio: d.precio ?? 0,
                        moneda: d.moneda ?? "USD",
                        activo: true,
                      },
                      "paq:nuevo",
                      "paquete"
                    );
                  }}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  {guardando === "paq:nuevo" ? "Creando…" : "Crear paquete"}
                </button>
              </>
            )}
          </section>
        </div>
      ) : (
        <Tabla
          vacio="Todavía no hay reservas."
          filas={data.reservas}
          columnas={[
            { th: "Código", td: (f) => String(f.codigo ?? "—") },
            { th: "Viaje", td: (f) => nombreEvento(f.evento_id) },
            {
              th: "Personas",
              td: (f) => {
                /* Quiénes son, no cuántos: son los que viajan y a los que hay
                   que reservarles hotel, moto y seguro. */
                const suyos = data.participantes.filter(
                  (p) => String(p.reserva_id) === String(f.id)
                );
                if (suyos.length === 0) return String(f.cantidad_participantes ?? "—");
                return (
                  <div className="space-y-0.5">
                    {suyos.map((p) => (
                      <div key={String(p.id)} className="leading-tight">
                        <span className="text-slate-800">
                          {[p.nombre, p.apellido].filter(Boolean).join(" ")}
                        </span>
                        {p.documento ? (
                          <span className="ml-2 font-mono text-[11px] text-slate-400">
                            {String(p.documento)}
                          </span>
                        ) : null}
                        {p.licencia_numero ? (
                          <span className="ml-2 text-[11px] text-slate-400">
                            lic. {String(p.licencia_numero)}
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                );
              },
            },
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
  columnas: { th: string; td: (f: Fila) => React.ReactNode }[];
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
