"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RefreshCw, Plus, Trash2, Save, Globe, AlertCircle, Check } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import CampoImagen from "@/components/web/CampoImagen";

/**
 * Módulo Web: administra el contenido del sitio público
 * (amigos-de-la-ruta-web) que no es ni evento ni producto de inventario.
 *
 * Los viajes se administran en el módulo Eventos. El precio, el stock y la
 * imagen de los productos se administran en Inventario: acá solo se edita el
 * copy de tienda y si el producto se publica o no.
 */

export type SeccionWeb = "tienda" | "motos" | "faq" | "configuracion";

const SECCIONES: { id: SeccionWeb; label: string; href: string }[] = [
  { id: "tienda", label: "Tienda", href: "/web" },
  { id: "motos", label: "Motos", href: "/web/motos" },
  { id: "faq", label: "FAQ", href: "/web/faq" },
  { id: "configuracion", label: "Configuración", href: "/web/configuracion" },
];

const IDIOMAS = [
  { cod: "es", label: "Español" },
  { cod: "pt", label: "Português" },
  { cod: "en", label: "English" },
] as const;

type Fila = Record<string, unknown>;

type ProductoTienda = {
  producto_id: string;
  sku: string;
  nombre_erp: string;
  precio_venta: number;
  stock_actual: number;
  stock_minimo: number;
  imagen_url: string | null;
  web: Fila | null;
};

type Contenido = {
  productos: ProductoTienda[];
  motos: Fila[];
  faqs: Fila[];
  encuentros: Fila[];
  config: Fila[];
};

const VACIO: Contenido = { productos: [], motos: [], faqs: [], encuentros: [], config: [] };

/** Lee un jsonb {es,pt,en} que puede venir null, string suelto u objeto. */
function textoDe(v: unknown, idioma: string): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const x = o[idioma];
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

/** Tres inputs, uno por idioma, sobre un mismo campo jsonb. */
function CampoMultilingue({
  label,
  valor,
  onChange,
  textarea,
}: {
  label: string;
  valor: unknown;
  onChange: (nuevo: Record<string, string>) => void;
  textarea?: boolean;
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="grid gap-2 sm:grid-cols-3">
        {IDIOMAS.map((i) => (
          <div key={i.cod}>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">{i.label}</div>
            {textarea ? (
              <textarea
                rows={3}
                className={input}
                value={textoDe(valor, i.cod)}
                onChange={(e) => onChange(ponerIdioma(valor, i.cod, e.target.value))}
              />
            ) : (
              <input
                className={input}
                value={textoDe(valor, i.cod)}
                onChange={(e) => onChange(ponerIdioma(valor, i.cod, e.target.value))}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WebClient({ seccion }: { seccion: SeccionWeb }) {
  const pathname = usePathname() ?? "/web";
  const [data, setData] = useState<Contenido>(VACIO);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  /** Borradores por fila: id (o "nuevo") -> valores editados sin guardar. */
  const [draft, setDraft] = useState<Record<string, Fila>>({});

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/web/contenido", { cache: "no-store" });
      const j = (await r.json()) as { success?: boolean; data?: Contenido; error?: string };
      if (!j.success || !j.data) throw new Error(j.error ?? "No se pudo cargar el contenido.");
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
    async (coleccion: string, id: string | null, valores: Fila, clave: string) => {
      setGuardando(clave);
      setError(null);
      setOkMsg(null);
      try {
        const r = await fetchWithSupabaseSession("/api/web/contenido", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coleccion, id, valores }),
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

  const borrar = useCallback(
    async (coleccion: string, id: string) => {
      if (!window.confirm("¿Borrar esta fila? No se puede deshacer.")) return;
      setGuardando(id);
      setError(null);
      try {
        const r = await fetchWithSupabaseSession("/api/web/contenido", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coleccion, id }),
        });
        const j = (await r.json()) as { success?: boolean; error?: string };
        if (!j.success) throw new Error(j.error ?? "No se pudo borrar.");
        await cargar();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      } finally {
        setGuardando(null);
      }
    },
    [cargar]
  );

  const setDraftCampo = (clave: string, campo: string, valor: unknown) =>
    setDraft((d) => ({ ...d, [clave]: { ...(d[clave] ?? {}), [campo]: valor } }));

  const valorDe = (clave: string, fila: Fila | null, campo: string) =>
    draft[clave]?.[campo] !== undefined ? draft[clave][campo] : fila?.[campo];

  const publicados = useMemo(
    () => data.productos.filter((p) => Boolean(p.web?.publicado)).length,
    [data.productos]
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[#4FAEB2]">
            <Globe className="h-4 w-4" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">Sitio web</span>
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Contenido del sitio
          </h1>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-slate-500">
            Lo que se edita acá es lo que publica amigosdelaruta.neura.com.py. Los viajes van en{" "}
            <Link href="/eventos" className="text-[#4FAEB2] underline-offset-2 hover:underline">
              Eventos
            </Link>
            ; el precio y el stock de los productos, en{" "}
            <Link href="/inventario" className="text-[#4FAEB2] underline-offset-2 hover:underline">
              Inventario
            </Link>
            .
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
        {SECCIONES.map((s) => {
          const activo = pathname === s.href;
          return (
            <Link
              key={s.id}
              href={s.href}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                activo ? "bg-[#4FAEB2] text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {s.label}
            </Link>
          );
        })}
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
      ) : (
        <div className="mt-6 space-y-4">
          {seccion === "tienda" && (
            <>
              <p className="text-sm text-slate-500">
                {data.productos.length} productos activos en Inventario · {publicados} publicados en
                el sitio. Un producto sin texto cargado no se publica.
              </p>
              {data.productos.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
                  No hay productos activos en Inventario todavía.
                </div>
              )}
              {data.productos.map((p) => {
                const clave = `prod:${p.producto_id}`;
                const idFila = p.web?.id ? String(p.web.id) : null;
                return (
                  <section
                    key={p.producto_id}
                    className="rounded-2xl border border-slate-200 bg-white p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">{p.nombre_erp}</div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {p.sku} · {p.precio_venta} · stock {p.stock_actual}
                          {p.stock_actual <= p.stock_minimo && (
                            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
                              stock bajo
                            </span>
                          )}
                        </div>
                      </div>
                      <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={Boolean(valorDe(clave, p.web, "publicado"))}
                          onChange={(e) => setDraftCampo(clave, "publicado", e.target.checked)}
                        />
                        Publicado
                      </label>
                    </div>

                    <div className="mt-4 space-y-4">
                      <CampoMultilingue
                        label="Nombre en el sitio"
                        valor={valorDe(clave, p.web, "nombre")}
                        onChange={(v) => setDraftCampo(clave, "nombre", v)}
                      />
                      <CampoMultilingue
                        label="Descripción"
                        textarea
                        valor={valorDe(clave, p.web, "descripcion")}
                        onChange={(v) => setDraftCampo(clave, "descripcion", v)}
                      />
                      <CampoMultilingue
                        label="Variantes (color, material…)"
                        valor={valorDe(clave, p.web, "variantes")}
                        onChange={(v) => setDraftCampo(clave, "variantes", v)}
                      />
                      <div className="flex flex-wrap items-end gap-3">
                        <div>
                          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Orden
                          </div>
                          <input
                            type="number"
                            className={`${input} w-24`}
                            value={Number(valorDe(clave, p.web, "orden") ?? 0)}
                            onChange={(e) => setDraftCampo(clave, "orden", Number(e.target.value))}
                          />
                        </div>
                        <button
                          type="button"
                          disabled={guardando === clave}
                          onClick={() =>
                            void guardar(
                              "producto",
                              idFila,
                              { producto_id: p.producto_id, ...(draft[clave] ?? {}) },
                              clave
                            )
                          }
                          className="inline-flex items-center gap-2 rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          <Save className="h-4 w-4" />
                          {guardando === clave ? "Guardando…" : "Guardar"}
                        </button>
                      </div>
                    </div>
                  </section>
                );
              })}
            </>
          )}

          {seccion === "motos" && (
            <ListaSimple
              coleccion="moto"
              filas={data.motos}
              draft={draft}
              guardando={guardando}
              onCampo={setDraftCampo}
              onGuardar={guardar}
              onBorrar={borrar}
              valorDe={valorDe}
              render={(clave, fila) => (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Nombre
                      </div>
                      <input
                        className={input}
                        value={String(valorDe(clave, fila, "nombre") ?? "")}
                        onChange={(e) => setDraftCampo(clave, "nombre", e.target.value)}
                      />
                    </div>
                    <div>
                      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Año
                      </div>
                      <input
                        type="number"
                        className={input}
                        value={String(valorDe(clave, fila, "anio") ?? "")}
                        onChange={(e) =>
                          setDraftCampo(clave, "anio", e.target.value ? Number(e.target.value) : null)
                        }
                      />
                    </div>
                  </div>
                  <CampoMultilingue
                    label="Descripción"
                    textarea
                    valor={valorDe(clave, fila, "descripcion")}
                    onChange={(v) => setDraftCampo(clave, "descripcion", v)}
                  />
                  <CampoImagen
                    coleccion="moto"
                    idFila={fila ? String(fila.id) : null}
                    valor={String(valorDe(clave, fila, "imagen_url") ?? "")}
                    onChange={(url) => setDraftCampo(clave, "imagen_url", url)}
                  />
                </>
              )}
            />
          )}

          {seccion === "faq" && (
            <ListaSimple
              coleccion="faq"
              filas={data.faqs}
              draft={draft}
              guardando={guardando}
              onCampo={setDraftCampo}
              onGuardar={guardar}
              onBorrar={borrar}
              valorDe={valorDe}
              render={(clave, fila) => (
                <>
                  <CampoMultilingue
                    label="Pregunta"
                    valor={valorDe(clave, fila, "pregunta")}
                    onChange={(v) => setDraftCampo(clave, "pregunta", v)}
                  />
                  <CampoMultilingue
                    label="Respuesta"
                    textarea
                    valor={valorDe(clave, fila, "respuesta")}
                    onChange={(v) => setDraftCampo(clave, "respuesta", v)}
                  />
                </>
              )}
            />
          )}

          {seccion === "configuracion" && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-sm text-slate-500">
                WhatsApp, teléfono, redes, medios de pago, cotizaciones y la seña. El valor se
                guarda como JSON: un texto va entre comillas, un objeto entre llaves.
              </p>
              <div className="mt-4 space-y-3">
                {data.config.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                    Todavía no hay claves cargadas.
                  </div>
                )}
                {data.config.map((c) => {
                  const clave = `cfg:${String(c.id)}`;
                  return (
                    <div key={String(c.id)} className="rounded-xl border border-slate-200 p-4">
                      <div className="text-sm font-semibold text-slate-900">{String(c.clave)}</div>
                      {c.nota ? (
                        <div className="mt-0.5 text-xs text-slate-500">{String(c.nota)}</div>
                      ) : null}
                      <textarea
                        rows={3}
                        className={`${input} mt-2 font-mono text-xs`}
                        value={
                          draft[clave]?.valor !== undefined
                            ? String(draft[clave].valor)
                            : JSON.stringify(c.valor ?? null, null, 2)
                        }
                        onChange={(e) => setDraftCampo(clave, "valor", e.target.value)}
                      />
                      <button
                        type="button"
                        disabled={guardando === clave}
                        onClick={() => {
                          const crudo = String(draft[clave]?.valor ?? JSON.stringify(c.valor ?? null));
                          let parsed: unknown;
                          try {
                            parsed = JSON.parse(crudo);
                          } catch {
                            setError(`El valor de ${String(c.clave)} no es JSON válido.`);
                            return;
                          }
                          void guardar("config", String(c.id), { valor: parsed }, clave);
                        }}
                        className="mt-2 inline-flex items-center gap-2 rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        <Save className="h-4 w-4" />
                        {guardando === clave ? "Guardando…" : "Guardar"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/** Lista editable con alta, edición y borrado, común a motos y FAQ. */
function ListaSimple({
  coleccion,
  filas,
  draft,
  guardando,
  onCampo,
  onGuardar,
  onBorrar,
  valorDe,
  render,
}: {
  coleccion: string;
  filas: Fila[];
  draft: Record<string, Fila>;
  guardando: string | null;
  onCampo: (clave: string, campo: string, valor: unknown) => void;
  onGuardar: (coleccion: string, id: string | null, valores: Fila, clave: string) => Promise<void>;
  onBorrar: (coleccion: string, id: string) => Promise<void>;
  valorDe: (clave: string, fila: Fila | null, campo: string) => unknown;
  render: (clave: string, fila: Fila | null) => React.ReactNode;
}) {
  const claveNueva = `${coleccion}:nuevo`;
  return (
    <>
      {filas.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
          Todavía no hay nada cargado.
        </div>
      )}
      {filas.map((f) => {
        const id = String(f.id);
        const clave = `${coleccion}:${id}`;
        return (
          <section key={id} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
            {render(clave, f)}
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Orden
                </div>
                <input
                  type="number"
                  className={`${input} w-24`}
                  value={Number(valorDe(clave, f, "orden") ?? 0)}
                  onChange={(e) => onCampo(clave, "orden", Number(e.target.value))}
                />
              </div>
              <label className="inline-flex items-center gap-2 pb-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(valorDe(clave, f, "publicado"))}
                  onChange={(e) => onCampo(clave, "publicado", e.target.checked)}
                />
                Publicado
              </label>
              <button
                type="button"
                disabled={guardando === clave}
                onClick={() => void onGuardar(coleccion, id, draft[clave] ?? {}, clave)}
                className="inline-flex items-center gap-2 rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {guardando === clave ? "Guardando…" : "Guardar"}
              </button>
              <button
                type="button"
                disabled={guardando === id}
                onClick={() => void onBorrar(coleccion, id)}
                className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                Borrar
              </button>
            </div>
          </section>
        );
      })}

      <section className="space-y-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-5">
        <div className="text-sm font-semibold text-slate-700">Agregar</div>
        {render(claveNueva, null)}
        <button
          type="button"
          disabled={guardando === claveNueva}
          onClick={() =>
            void onGuardar(coleccion, null, { publicado: true, ...(draft[claveNueva] ?? {}) }, claveNueva)
          }
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {guardando === claveNueva ? "Agregando…" : "Agregar"}
        </button>
      </section>
    </>
  );
}
