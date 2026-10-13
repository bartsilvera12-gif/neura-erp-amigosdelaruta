"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import { FancySelect } from "@/app/dashboard/proyectos/components/FancySelect";
// import { NuevaFacturaCajaModal } from "@/components/caja/NuevaFacturaCajaModal"; // Nueva factura — COMENTADO
import CajaControlPanel from "@/components/caja/CajaControlPanel";
import { getVentas } from "@/lib/ventas/storage";
import type { Venta, TipoVenta, TipoIvaVenta } from "@/lib/ventas/types";

/**
 * Caja: registro de ventas y salidas de inventario.
 *
 * Portada del módulo, copiada de la instancia instemaq y adaptada a los campos
 * que existen acá. Antes esta pantalla era sólo el botón "Nueva factura" y la
 * venta de verdad (`/ventas/nueva`, con productos y descuento de stock) no
 * estaba enlazada desde ningún lado en escritorio: había que escribir la URL.
 *
 * Lo que NO se copió de instemaq, porque esta instancia no tiene el dato y una
 * columna vacía o un enlace muerto es peor que no tenerla:
 *   - "Pago": `metodo_pago` no existe en el tipo `Venta` de acá.
 *   - "Factura" con estado SIFEN y el botón Imprimir: la venta no guarda
 *     `factura_id` ni `factura_numero`, y `/api/ventas/[id]/ticket` no existe.
 * Si más adelante se suman esos campos, las columnas se traen de instemaq.
 *
 * La factura rápida se conserva como acción secundaria: era lo único que tenía
 * el módulo y el documento funcional pide facturación.
 */

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatGs(valor: number) {
  return `Gs. ${Math.round(valor).toLocaleString("es-PY")}`;
}

function formatFecha(iso: string) {
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  } catch {
    return iso;
  }
}

const inputFilterClass =
  "border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-[#4FAEB2] focus:outline-none";

const tipoVentaBadge: Record<TipoVenta, string> = {
  CONTADO: "bg-blue-50 text-blue-700",
  CREDITO: "bg-orange-50 text-orange-700",
};

const ivaLabel: Record<TipoIvaVenta, string> = {
  EXENTA: "Exenta",
  "5%": "IVA 5%",
  "10%": "IVA 10%",
};

function esDeHoy(iso: string): boolean {
  try {
    const fecha = new Date(iso);
    const hoy = new Date();
    return (
      fecha.getFullYear() === hoy.getFullYear() &&
      fecha.getMonth() === hoy.getMonth() &&
      fecha.getDate() === hoy.getDate()
    );
  } catch {
    return false;
  }
}

interface MetricasHoy {
  facturacion: number;
  cantidadVentas: number;
  ticketPromedio: number;
  productosVendidos: number;
}

function calcularMetricas(ventas: Venta[]): MetricasHoy {
  const deHoy = ventas.filter((v) => esDeHoy(v.fecha));
  const facturacion = deHoy.reduce((s, v) => s + v.total, 0);
  const cantidadVentas = deHoy.length;
  const ticketPromedio = cantidadVentas > 0 ? facturacion / cantidadVentas : 0;
  const productosVendidos = deHoy.reduce(
    (s, v) => s + v.items.reduce((si, i) => si + i.cantidad, 0),
    0
  );
  return { facturacion, cantidadVentas, ticketPromedio, productosVendidos };
}

// ── Tarjeta métrica ───────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border px-5 py-4 flex flex-col gap-1 shadow-sm ${
        accent
          ? "bg-[#4FAEB2] border-[#4FAEB2] ring-1 ring-[#4FAEB2]/25"
          : "bg-white border-[#4FAEB2]/30 ring-1 ring-[#4FAEB2]/10"
      }`}
    >
      <span
        className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${
          accent ? "text-white/90" : "text-[#4FAEB2]"
        }`}
      >
        {label}
      </span>
      <span
        className={`text-2xl font-bold tabular-nums leading-tight ${
          accent ? "text-white" : "text-[#3F8E91]"
        }`}
      >
        {value}
      </span>
      {sub && <span className={`text-xs ${accent ? "text-white/80" : "text-slate-500"}`}>{sub}</span>}
    </div>
  );
}

// ── Helpers de fila ───────────────────────────────────────────────────────────

/** Muestra el primer producto de la venta y un badge con el resto. */
function ResumenProductos({ v }: { v: Venta }) {
  const primero = v.items[0];
  if (!primero) {
    return <span className="text-xs text-gray-400">Sin líneas cargadas</span>;
  }
  const extra = v.items.length - 1;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium text-gray-800 leading-tight">{primero.producto_nombre}</span>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="font-mono text-xs text-gray-400">{primero.sku}</span>
        {extra > 0 && (
          <span className="bg-gray-100 text-gray-500 text-xs px-1.5 py-0.5 rounded-full font-medium">
            +{extra} más
          </span>
        )}
      </div>
    </div>
  );
}

/** Qué mostrar en la celda IVA cuando la venta mezcla tasas. */
function ivaResumen(v: Venta): string {
  const tipos = [...new Set(v.items.map((i) => i.tipo_iva))];
  if (tipos.length === 1) return ivaLabel[tipos[0]];
  return "Mixto";
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function VentasDesktop() {
  const [todas, setTodas] = useState<Venta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<TipoVenta | "">("");
  const [filtroIva, setFiltroIva] = useState<TipoIvaVenta | "">("");
  // const [facturaOpen, setFacturaOpen] = useState(false); // Nueva factura — COMENTADO

  useEffect(() => {
    let cancelled = false;
    getVentas()
      .then((data) => {
        if (cancelled) return;
        const ordenadas = [...data].sort((a, b) => {
          const ta = new Date(a.fecha).getTime();
          const tb = new Date(b.fecha).getTime();
          return tb - ta || b.numero_control.localeCompare(a.numero_control);
        });
        setTodas(ordenadas);
      })
      .finally(() => {
        if (!cancelled) setCargando(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const metricas = calcularMetricas(todas);

  const filtradas = todas.filter((v) => {
    // Búsqueda global: número de control, nombre o SKU de cualquier ítem.
    if (busqueda.trim() !== "") {
      const t = busqueda.toLowerCase().trim();
      const coincide =
        v.numero_control.toLowerCase().includes(t) ||
        v.items.some(
          (i) => i.producto_nombre.toLowerCase().includes(t) || i.sku.toLowerCase().includes(t)
        );
      if (!coincide) return false;
    }
    if (filtroTipo !== "" && v.tipo_venta !== filtroTipo) return false;
    // IVA: coincide si al menos un ítem tiene esa tasa.
    if (filtroIva !== "" && !v.items.some((i) => i.tipo_iva === filtroIva)) return false;
    return true;
  });

  const hayFiltros = busqueda || filtroTipo || filtroIva;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
              style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }}
            />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">
              Operaciones
            </p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Caja</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Turno de caja, cobro y registro de ventas
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* ── «Nueva factura» (factura suelta por RUC) — COMENTADO ──────────────
              Se saca de la pantalla a pedido: no toca inventario y convivía raro al
              lado de la venta real, que sí descuenta stock.

              Queda comentado y no borrado porque el documento funcional pide un
              módulo de Facturación; si se arma, esto es el punto de partida. Para
              reactivarlo hay que descomentar cuatro cosas, todas rotuladas igual en
              este archivo: el import, el estado, el botón y el modal.

              La ruta /api/caja/cliente-por-ruc que usa este modal sigue existiendo
              (es la que crea clientes con origen CAJA): sólo se quitó la entrada.
              ──────────────────────────────────────────────────────────────────── */}
          {/* <button
            type="button"
            onClick={() => setFacturaOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2]"
            title="Factura suelta, sin productos del inventario"
          >
            <FileText className="h-4 w-4" />
            Nueva factura
          </button> */}
          <Link
            href="/ventas/nueva"
            className="inline-flex items-center gap-2 rounded-xl bg-[#4FAEB2] px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91]"
          >
            <Plus className="h-4 w-4" />
            Nueva venta
          </Link>
        </div>
      </div>

      {/* El turno de caja: abrir, movimientos, arqueo y cierre. Portado de
          ferretodo. Se muestra arriba de todo porque condiciona lo demás: sin
          caja abierta, una venta en efectivo no entra en ningún arqueo. */}
      <CajaControlPanel />

      {/* ── Métricas del día ──────────────────────────────────────────────────── */}
      <div>
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-400">
          Resumen de hoy —{" "}
          {new Date().toLocaleDateString("es-PY", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Facturación de hoy"
            value={formatGs(metricas.facturacion)}
            sub="Total incl. IVA"
            accent
          />
          <MetricCard
            label="Ventas de hoy"
            value={String(metricas.cantidadVentas)}
            sub={metricas.cantidadVentas === 1 ? "orden registrada" : "órdenes registradas"}
          />
          <MetricCard
            label="Ticket promedio"
            value={metricas.ticketPromedio > 0 ? formatGs(metricas.ticketPromedio) : "—"}
            sub="Por orden de venta"
          />
          <MetricCard
            label="Unidades vendidas"
            value={String(metricas.productosVendidos)}
            sub="Unidades despachadas"
          />
        </div>
      </div>

      {/* ── Tabla de ventas ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-[#4FAEB2]/15">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Órdenes de venta</h2>
        </div>

        {/* Filtros */}
        <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-gray-100 pb-5">
          <input
            type="text"
            placeholder="Buscar por número, producto o SKU..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className={`${inputFilterClass} min-w-64`}
          />
          <FancySelect
            value={filtroTipo}
            onChange={(v) => setFiltroTipo(v as TipoVenta | "")}
            ariaLabel="Filtrar por tipo de venta"
            className="w-44"
            size="sm"
            options={[
              { value: "", label: "Todos los tipos" },
              { value: "CONTADO", label: "Contado" },
              { value: "CREDITO", label: "Crédito" },
            ]}
          />
          <FancySelect
            value={filtroIva}
            onChange={(v) => setFiltroIva(v as TipoIvaVenta | "")}
            ariaLabel="Filtrar por IVA"
            className="w-44"
            size="sm"
            options={[
              { value: "", label: "Todos los IVA" },
              { value: "EXENTA", label: "Exenta" },
              { value: "5%", label: "IVA 5%" },
              { value: "10%", label: "IVA 10%" },
            ]}
          />
          {hayFiltros && (
            <button
              onClick={() => {
                setBusqueda("");
                setFiltroTipo("");
                setFiltroIva("");
              }}
              className="px-2 text-sm text-gray-400 transition-colors hover:text-gray-600"
            >
              Limpiar filtros
            </button>
          )}
          <span className="ml-auto text-sm text-gray-400">
            {filtradas.length} de {todas.length} ventas
          </span>
        </div>

        {/* Tabla */}
        <EdgeScrollArea>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-sm font-semibold text-slate-600">
                <th className="py-3 pr-4 font-medium">Número</th>
                <th className="py-3 pr-4 font-medium">Productos</th>
                <th className="py-3 pr-4 text-center font-medium">Ítems</th>
                <th className="py-3 pr-4 text-right font-medium">Cant. total</th>
                <th className="py-3 pr-4 font-medium">IVA</th>
                <th className="py-3 pr-4 text-right font-medium">Total</th>
                <th className="py-3 pr-4 font-medium">Tipo</th>
                <th className="py-3 font-medium">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-400">
                    Cargando ventas…
                  </td>
                </tr>
              ) : filtradas.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-400">
                    {todas.length === 0
                      ? "No hay ventas registradas"
                      : "Ninguna venta coincide con los filtros"}
                  </td>
                </tr>
              ) : (
                filtradas.map((v) => {
                  const cantTotal = v.items.reduce((s, i) => s + i.cantidad, 0);
                  return (
                    <tr
                      key={v.id}
                      className="border-b border-slate-200 transition-colors last:border-0 hover:bg-[#4FAEB2]/[0.04]"
                    >
                      <td className="py-4 pr-4 align-middle font-mono text-xs text-gray-500">
                        {v.numero_control}
                      </td>
                      <td className="py-4 pr-4 align-middle">
                        <ResumenProductos v={v} />
                      </td>
                      <td className="py-4 pr-4 text-center align-middle">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
                          {v.items.length}
                        </span>
                      </td>
                      <td className="py-4 pr-4 text-right align-middle tabular-nums text-gray-700">
                        {cantTotal}
                      </td>
                      <td className="py-4 pr-4 align-middle">
                        <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">
                          {ivaResumen(v)}
                        </span>
                      </td>
                      <td className="py-4 pr-4 text-right align-middle font-semibold tabular-nums text-gray-800">
                        {formatGs(v.total)}
                      </td>
                      <td className="py-4 pr-4 align-middle">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-semibold ${tipoVentaBadge[v.tipo_venta]}`}
                        >
                          {v.tipo_venta === "CONTADO" ? "Contado" : `Crédito ${v.plazo_dias ?? ""}d`}
                        </span>
                      </td>
                      <td className="py-4 align-middle text-xs tabular-nums text-gray-500">
                        {formatFecha(v.fecha)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </EdgeScrollArea>
      </div>

      {/* Nueva factura — COMENTADO
      <NuevaFacturaCajaModal open={facturaOpen} onClose={() => setFacturaOpen(false)} /> */}
    </div>
  );
}
