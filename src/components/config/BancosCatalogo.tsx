"use client";

import { useCallback, useEffect, useState } from "react";
import { GlobalConfigSubpageShell } from "@/components/config/GlobalConfigSubpageShell";
import {
  ConfigFormCard,
  ConfigHelpText,
  ConfigSectionTitle,
  F_INPUT,
  F_LABEL,
} from "@/components/config/global-config-primitives";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";

/**
 * Catálogo de entidades de cobro (cajas, bancos, tarjetas/POS, billeteras).
 *
 * Vive acá y no dentro de `app/configuracion` porque se publica desde DOS lados:
 * la tarjeta de Configuración Global y —para esta instancia, donde Configuración
 * no está en el menú— como sub-página de Cobranzas, que es donde se usa.
 * `volverA` decide a cuál de los dos vuelve el breadcrumb.
 *
 * La pantalla está tomada de `neura-erp-glacial`, que la resuelve como tabla:
 * una fila por entidad, con código, tipo, un interruptor para activar y las
 * acciones a la derecha. Antes era una barra por banco con el nombre y dos
 * enlaces, que ocupaba toda la pantalla para mostrar un dato.
 *
 * `codigo` y `tipo` los agrega el script 07 y puede no estar corrido: el GET
 * avisa en `meta.campos` qué existe y acá se muestran sólo esas columnas. Así
 * la pantalla anda igual antes y después de correrlo.
 */

type Banco = {
  id: string;
  nombre: string;
  activo: boolean;
  sort_order: number;
  codigo?: string | null;
  tipo?: string | null;
};

type Campos = { codigo: boolean; tipo: boolean };

type Resp = {
  success?: boolean;
  error?: string;
  data?: { bancos: Banco[]; meta: { can_edit: boolean; campos?: Campos } };
};

const TIPOS: { value: string; label: string }[] = [
  { value: "caja", label: "Caja" },
  { value: "banco", label: "Banco" },
  { value: "tarjeta", label: "Tarjeta / POS" },
  { value: "billetera", label: "Billetera" },
  { value: "otro", label: "Otro" },
];
const tipoLabel = (t: string | null | undefined) => TIPOS.find((x) => x.value === t)?.label ?? "Otro";

const BTN_PRIMARY =
  "rounded-lg bg-[#3F8E91] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#357a7d] disabled:opacity-50";

export default function BancosCatalogo({
  volverA = "/configuracion",
  volverLabel = "Configuración Global",
}: {
  volverA?: string;
  volverLabel?: string;
} = {}) {
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [campos, setCampos] = useState<Campos>({ codigo: false, tipo: false });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Alta
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoCodigo, setNuevoCodigo] = useState("");
  const [nuevoTipo, setNuevoTipo] = useState("banco");
  const [guardando, setGuardando] = useState(false);

  // Edición en la fila
  const [editId, setEditId] = useState<string | null>(null);
  const [eNombre, setENombre] = useState("");
  const [eCodigo, setECodigo] = useState("");
  const [eTipo, setETipo] = useState("banco");
  const [borrando, setBorrando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await apiFetch("/api/configuracion/bancos", { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as Resp;
      if (!r.ok || !j.success || !j.data) {
        setError(j.error ?? `Error ${r.status}`);
        return;
      }
      setBancos(j.data.bancos);
      setCanEdit(j.data.meta.can_edit);
      setCampos(j.data.meta.campos ?? { codigo: false, tipo: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    const nombre = nuevoNombre.trim();
    if (!nombre) return;
    setGuardando(true);
    setError(null);
    try {
      const cuerpo: Record<string, unknown> = { nombre };
      if (campos.codigo && nuevoCodigo.trim()) cuerpo.codigo = nuevoCodigo.trim();
      if (campos.tipo) cuerpo.tipo = nuevoTipo;
      const r = await apiFetch("/api/configuracion/bancos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!r.ok || !j.success) {
        setError(j.error ?? `Error ${r.status}`);
        return;
      }
      setNuevoNombre("");
      setNuevoCodigo("");
      setNuevoTipo("banco");
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    const r = await apiFetch(`/api/configuracion/bancos/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
    if (!r.ok || !j.success) {
      setError(j.error ?? `Error ${r.status}`);
      return;
    }
    setEditId(null);
    await cargar();
  }

  async function borrar(b: Banco) {
    if (!window.confirm(`¿Borrar «${b.nombre}» del catálogo?`)) return;
    setError(null);
    setBorrando(b.id);
    try {
      const r = await apiFetch(`/api/configuracion/bancos/${b.id}`, { method: "DELETE" });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!r.ok || !j.success) {
        setError(j.error ?? `Error ${r.status}`);
        return;
      }
      await cargar();
    } finally {
      setBorrando(null);
    }
  }

  function empezarEdicion(b: Banco) {
    setEditId(b.id);
    setENombre(b.nombre);
    setECodigo(b.codigo ?? "");
    setETipo(b.tipo ?? "banco");
  }

  function guardarEdicion() {
    if (!editId) return;
    const nombre = eNombre.trim();
    if (!nombre) {
      setError("El nombre no puede quedar vacío");
      return;
    }
    const cuerpo: Record<string, unknown> = { nombre };
    if (campos.codigo) cuerpo.codigo = eCodigo.trim();
    if (campos.tipo) cuerpo.tipo = eTipo;
    void patch(editId, cuerpo);
  }

  const columnas = 2 + (campos.codigo ? 1 : 0) + (campos.tipo ? 1 : 0) + (canEdit ? 1 : 0);

  return (
    <GlobalConfigSubpageShell
      title="Bancos"
      eyebrow="Finanzas"
      description="Cajas, bancos, tarjetas/POS y billeteras que se ofrecen al cobrar. Esta lista alimenta el desplegable “Banco de origen” de los botones de cobro."
      backHref={volverA}
      backLabel={volverLabel}
    >
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      {canEdit ? (
        <ConfigFormCard>
          <ConfigSectionTitle>Nueva entidad</ConfigSectionTitle>
          <ConfigHelpText>
            El nombre no se puede repetir. Las entidades desactivadas no aparecen en el desplegable de cobros.
            {campos.codigo ? " El código corto sirve para encontrarla tipeando tres letras." : null}
          </ConfigHelpText>
          <form onSubmit={agregar} className="mt-3 flex flex-wrap items-end gap-3">
            {campos.codigo ? (
              <div className="w-28">
                <label className={F_LABEL} htmlFor="nuevo-codigo">Código</label>
                <input
                  id="nuevo-codigo"
                  className={`${F_INPUT} uppercase`}
                  value={nuevoCodigo}
                  onChange={(e) => setNuevoCodigo(e.target.value)}
                  placeholder="BASA"
                  maxLength={20}
                />
              </div>
            ) : null}
            <div className="min-w-[240px] flex-1">
              <label className={F_LABEL} htmlFor="nuevo-banco">Nombre</label>
              <input
                id="nuevo-banco"
                className={F_INPUT}
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
                placeholder="Ej.: Banco Basa"
                required
              />
            </div>
            {campos.tipo ? (
              <div className="w-44">
                <label className={F_LABEL} htmlFor="nuevo-tipo">Tipo</label>
                <select
                  id="nuevo-tipo"
                  className={F_INPUT}
                  value={nuevoTipo}
                  onChange={(e) => setNuevoTipo(e.target.value)}
                >
                  {TIPOS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            ) : null}
            <button type="submit" className={BTN_PRIMARY} disabled={guardando || !nuevoNombre.trim()}>
              {guardando ? "Agregando…" : "Agregar"}
            </button>
          </form>
        </ConfigFormCard>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-slate-600">
              {campos.codigo ? <th className="px-4 py-3 font-semibold">Código</th> : null}
              <th className="px-4 py-3 font-semibold">Nombre</th>
              {campos.tipo ? <th className="px-4 py-3 font-semibold">Tipo</th> : null}
              <th className="px-4 py-3 font-semibold">Estado</th>
              {canEdit ? <th className="px-4 py-3 font-semibold text-right">Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr>
                <td colSpan={columnas} className="px-4 py-10 text-center text-slate-400">Cargando…</td>
              </tr>
            ) : bancos.length === 0 ? (
              <tr>
                <td colSpan={columnas} className="px-4 py-10 text-center text-slate-400">
                  Sin entidades cargadas.
                </td>
              </tr>
            ) : (
              bancos.map((b) => {
                const editando = editId === b.id;
                return (
                  <tr key={b.id} className="border-b border-slate-50 last:border-0 hover:bg-[#4FAEB2]/[0.04]">
                    {campos.codigo ? (
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">
                        {editando ? (
                          <input
                            className={`${F_INPUT} uppercase`}
                            value={eCodigo}
                            onChange={(e) => setECodigo(e.target.value)}
                            maxLength={20}
                            aria-label="Código"
                          />
                        ) : (b.codigo || "—")}
                      </td>
                    ) : null}

                    <td className="px-4 py-3">
                      {editando ? (
                        <input
                          className={F_INPUT}
                          value={eNombre}
                          onChange={(e) => setENombre(e.target.value)}
                          aria-label="Nombre"
                        />
                      ) : (
                        <span className="font-medium text-slate-800">{b.nombre}</span>
                      )}
                    </td>

                    {campos.tipo ? (
                      <td className="px-4 py-3 text-slate-600">
                        {editando ? (
                          <select
                            className={F_INPUT}
                            value={eTipo}
                            onChange={(e) => setETipo(e.target.value)}
                            aria-label="Tipo"
                          >
                            {TIPOS.map((t) => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        ) : tipoLabel(b.tipo)}
                      </td>
                    ) : null}

                    {/* Interruptor y no una palabra: con "Activo" escrito nadie
                        se da cuenta de que hay que apretarlo para cambiarlo. */}
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => canEdit && void patch(b.id, { activo: !b.activo })}
                        disabled={!canEdit}
                        role="switch"
                        aria-checked={b.activo}
                        aria-label={`${b.activo ? "Desactivar" : "Activar"} ${b.nombre}`}
                        title={
                          b.activo
                            ? "Activa — se ofrece al cobrar. Clic para desactivar."
                            : "Inactiva — no se ofrece al cobrar. Clic para activar."
                        }
                        className={`inline-flex items-center gap-2 rounded-full border px-1 py-1 pr-3 text-xs font-semibold transition-colors disabled:cursor-default ${
                          b.activo
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 enabled:hover:bg-emerald-100"
                            : "border-slate-200 bg-slate-50 text-slate-500 enabled:hover:bg-slate-100"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`relative h-5 w-9 rounded-full transition-colors ${b.activo ? "bg-emerald-500" : "bg-slate-300"}`}
                        >
                          <span
                            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${b.activo ? "left-[1.125rem]" : "left-0.5"}`}
                          />
                        </span>
                        {b.activo ? "Activa" : "Inactiva"}
                      </button>
                    </td>

                    {canEdit ? (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {editando ? (
                          <div className="flex justify-end gap-3">
                            <button type="button" onClick={guardarEdicion} className="text-xs font-semibold text-[#3F8E91] hover:underline">
                              Guardar
                            </button>
                            <button type="button" onClick={() => setEditId(null)} className="text-xs font-medium text-slate-500 hover:underline">
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-3">
                            <button type="button" onClick={() => empezarEdicion(b)} className="text-xs font-semibold text-[#3F8E91] hover:underline">
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => void borrar(b)}
                              disabled={borrando === b.id}
                              className="text-xs font-semibold text-rose-600 hover:underline disabled:opacity-40"
                            >
                              {borrando === b.id ? "Borrando…" : "Borrar"}
                            </button>
                          </div>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!campos.codigo || !campos.tipo ? (
        <p className="text-xs text-slate-400">
          El código corto y el tipo de entidad (caja, banco, tarjeta/POS, billetera) se habilitan
          corriendo <span className="font-mono">supabase/instancia/07_bancos_codigo_tipo.sql</span>.
        </p>
      ) : null}
    </GlobalConfigSubpageShell>
  );
}
