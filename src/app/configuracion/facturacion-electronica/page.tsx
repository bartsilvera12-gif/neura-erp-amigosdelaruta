"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { AmbienteSifen, EmpresaSifenConfigDTO, KudeLogoDTO } from "@/lib/sifen/types";
import type { ActividadEconomica } from "@/lib/sifen/actividades-economicas";
import { FechaSelect } from "@/components/ui/FechaSelect";

const fLabel = "block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1";
const fInput =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4FAEB2] bg-white";
const fSelect = fInput;

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">{children}</div>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4 pb-2 border-b border-gray-100">
      {children}
    </h4>
  );
}

function isoToDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/** Valor para `<input type="date">` desde API (date o ISO). */
function ymdToDateInput(v: string | null | undefined): string {
  if (!v) return "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v).trim());
  return m ? m[1]! : "";
}

/** Config “completa” según datos persistidos (no borrador en curso). */
function isSifenConfigCompleta(c: EmpresaSifenConfigDTO): boolean {
  const datos =
    Boolean(c.ruc?.trim()) &&
    Boolean(c.razon_social?.trim()) &&
    Boolean(c.direccion_fiscal?.trim()) &&
    Boolean(c.timbrado_numero?.trim()) &&
    Boolean(c.timbrado_fecha_inicio_vigencia?.trim()) &&
    Boolean(c.actividad_economica_codigo?.trim()) &&
    Boolean(c.actividad_economica_descripcion?.trim()) &&
    Boolean(c.establecimiento?.trim()) &&
    Boolean(c.punto_expedicion?.trim());
  return (
    datos &&
    c.activo === true &&
    Boolean(c.certificado_path?.trim()) &&
    c.has_certificado_password === true
  );
}

export default function FacturacionElectronicaSifenPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [cfg, setCfg] = useState<EmpresaSifenConfigDTO | null>(null);

  const [ambiente, setAmbiente] = useState<AmbienteSifen>("test");
  const [ruc, setRuc] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  const [direccionFiscal, setDireccionFiscal] = useState("");
  const [timbradoNumero, setTimbradoNumero] = useState("");
  const [timbradoFechaIni, setTimbradoFechaIni] = useState("");
  const [actEcoCodigo, setActEcoCodigo] = useState("");
  const [actEcoDescripcion, setActEcoDescripcion] = useState("");
  /** Actividades económicas secundarias del RUC (además de la principal). */
  const [actividadesSec, setActividadesSec] = useState<ActividadEconomica[]>([]);
  const [establecimiento, setEstablecimiento] = useState("");
  const [puntoExpedicion, setPuntoExpedicion] = useState("");
  const [csc, setCsc] = useState("");
  /* Cual de los CSC del contribuyente es: la SET entrega cada codigo con su
     numero (0001, 0002) y verifica el hash del QR contra ese. */
  const [idCsc, setIdCsc] = useState("");
  const [activo, setActivo] = useState(true);
  /** Horas desde aprobación SET para permitir cancelación del DE en ERP (config por empresa). */
  const [plazoCancelacionHoras, setPlazoCancelacionHoras] = useState(48);
  const [certVenc, setCertVenc] = useState("");
  const [nuevaPassword, setNuevaPassword] = useState("");
  const [limpiarPassword, setLimpiarPassword] = useState(false);

  const certFileInputId = useId();
  const certFileInputRef = useRef<HTMLInputElement>(null);
  /** Nombre del .p12 elegido en el diálogo (se limpia tras subida OK). */
  const [nombreArchivoCert, setNombreArchivoCert] = useState<string | null>(null);
  /** Si la config está completa, permite colapsar el formulario (opción A). */
  const [editarFormulario, setEditarFormulario] = useState(false);

  /**
   * Branding KuDE/PDF opcional. NO afecta XML, firma, envío SET ni CDC.
   * - Vacío → renderer usa logo Neura y color #4FAEB2.
   * - Con color → renderer usa color personalizado para bordes/acentos del PDF.
   * - Con logo → renderer embebe ese PNG en el header.
   */
  const [kudeColorPrimario, setKudeColorPrimario] = useState("");
  const [kudeColorPrimarioFill, setKudeColorPrimarioFill] = useState("");
  const [kudeLogoPathActual, setKudeLogoPathActual] = useState<string | null>(null);
  /** Logos adicionales (con nombre) para elegir al facturar. */
  const [kudeLogos, setKudeLogos] = useState<KudeLogoDTO[]>([]);
  const [nombreNuevoLogo, setNombreNuevoLogo] = useState("");
  const [subiendoLogoExtra, setSubiendoLogoExtra] = useState(false);
  const [eliminandoLogoId, setEliminandoLogoId] = useState<string | null>(null);
  const logoExtraInputRef = useRef<HTMLInputElement>(null);
  const [subiendoLogo, setSubiendoLogo] = useState(false);
  const [eliminandoLogo, setEliminandoLogo] = useState(false);
  const [derivarFill, setDerivarFill] = useState(true);
  const kudeLogoInputId = useId();
  const kudeLogoInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession("/api/configuracion/sifen");
      const j = (await res.json()) as { success?: boolean; data?: EmpresaSifenConfigDTO | null; error?: string };
      if (!res.ok || !j.success) {
        setError(j.error ?? "No se pudo cargar la configuración");
        return;
      }
      const d = j.data ?? null;
      setCfg(d);
      if (d) {
        setAmbiente(d.ambiente);
        setRuc(d.ruc);
        setRazonSocial(d.razon_social);
        setDireccionFiscal(d.direccion_fiscal ?? "");
        setTimbradoNumero(d.timbrado_numero);
        setTimbradoFechaIni(ymdToDateInput(d.timbrado_fecha_inicio_vigencia));
        setActEcoCodigo(d.actividad_economica_codigo ?? "");
        setActEcoDescripcion(d.actividad_economica_descripcion ?? "");
        setActividadesSec(
          Array.isArray(d.actividades_economicas_secundarias)
            ? d.actividades_economicas_secundarias.map((a) => ({ codigo: a.codigo, descripcion: a.descripcion }))
            : []
        );
        setEstablecimiento(d.establecimiento);
        setPuntoExpedicion(d.punto_expedicion);
        setCsc(d.csc ?? "");
        setIdCsc(d.id_csc ?? "");
        setActivo(d.activo);
        setPlazoCancelacionHoras(
          typeof d.sifen_plazo_cancelacion_horas === "number" && Number.isFinite(d.sifen_plazo_cancelacion_horas)
            ? d.sifen_plazo_cancelacion_horas
            : 48
        );
        setCertVenc(isoToDateInput(d.certificado_vencimiento));
        setKudeLogoPathActual(d.kude_logo_path ?? null);
        setKudeLogos(Array.isArray(d.kude_logos) ? d.kude_logos : []);
        setKudeColorPrimario(d.kude_color_primario ?? "");
        setKudeColorPrimarioFill(d.kude_color_primario_fill ?? "");
        setDerivarFill(!d.kude_color_primario_fill);
      }
    } catch {
      setError("Error de red al cargar SIFEN");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (cfg != null && !isSifenConfigCompleta(cfg)) setEditarFormulario(true);
  }, [cfg]);

  /**
   * Vencimiento: obligatorio solo si ya hay .p12 en storage (certificado_path).
   * Crear config sin certificado → no enviar fecha (omitir en POST).
   * PATCH sin cert y fecha vacía → null en servidor.
   */
  function resolveCertificadoVencimiento(): { ok: true; iso: string | null } | { ok: false; message: string } {
    const t = certVenc.trim();
    const tieneCertificado = Boolean(cfg?.certificado_path?.trim());

    if (!t) {
      if (tieneCertificado) {
        return {
          ok: false,
          message: "Indicá la fecha de vencimiento del certificado .p12 cargado.",
        };
      }
      return { ok: true, iso: null };
    }

    const d = new Date(t + "T12:00:00");
    if (Number.isNaN(d.getTime())) {
      return { ok: false, message: "Fecha de vencimiento del certificado no válida" };
    }
    return { ok: true, iso: d.toISOString() };
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const vencRes = resolveCertificadoVencimiento();
      if (!vencRes.ok) {
        setError(vencRes.message);
        setSaving(false);
        return;
      }
      const { iso: venc } = vencRes;

      /** Solo filas con código Y descripción (las a medio cargar se descartan). */
      const actividadesSecLimpias = actividadesSec
        .map((a) => ({ codigo: a.codigo.trim(), descripcion: a.descripcion.trim() }))
        .filter((a) => a.codigo !== "" && a.descripcion !== "");

      if (!cfg) {
        const body: Record<string, unknown> = {
          ambiente,
          ruc: ruc.trim(),
          razon_social: razonSocial.trim(),
          direccion_fiscal: direccionFiscal.trim() || null,
          timbrado_numero: timbradoNumero.trim(),
          timbrado_fecha_inicio_vigencia: timbradoFechaIni.trim(),
          actividad_economica_codigo: actEcoCodigo.trim(),
          actividad_economica_descripcion: actEcoDescripcion.trim(),
          actividades_economicas_secundarias: actividadesSecLimpias,
          establecimiento: establecimiento.trim(),
          punto_expedicion: puntoExpedicion.trim(),
          csc: csc.trim() || null,
          id_csc: idCsc.trim() || null,
          activo,
          sifen_plazo_cancelacion_horas: Math.min(8760, Math.max(1, Math.floor(Number(plazoCancelacionHoras)) || 48)),
        };
        if (venc != null) body.certificado_vencimiento = venc;
        if (nuevaPassword.trim()) body.certificado_password = nuevaPassword.trim();

        const res = await fetchWithSupabaseSession("/api/configuracion/sifen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = (await res.json()) as { success?: boolean; data?: EmpresaSifenConfigDTO; error?: string };
        if (!res.ok || !j.success) {
          setError(j.error ?? "No se pudo crear la configuración");
          return;
        }
        setCfg(j.data!);
        setNuevaPassword("");
        setSuccess("Configuración SIFEN creada correctamente.");
        if (j.data != null && isSifenConfigCompleta(j.data)) setEditarFormulario(false);
      } else {
        const body: Record<string, unknown> = {
          ambiente,
          ruc: ruc.trim(),
          razon_social: razonSocial.trim(),
          direccion_fiscal: direccionFiscal.trim() || null,
          timbrado_numero: timbradoNumero.trim(),
          timbrado_fecha_inicio_vigencia: timbradoFechaIni.trim(),
          actividad_economica_codigo: actEcoCodigo.trim(),
          actividad_economica_descripcion: actEcoDescripcion.trim(),
          actividades_economicas_secundarias: actividadesSecLimpias,
          establecimiento: establecimiento.trim(),
          punto_expedicion: puntoExpedicion.trim(),
          csc: csc.trim() || null,
          id_csc: idCsc.trim() || null,
          activo,
          certificado_vencimiento: venc,
          sifen_plazo_cancelacion_horas: Math.min(8760, Math.max(1, Math.floor(Number(plazoCancelacionHoras)) || 48)),
        };
        if (limpiarPassword) body.certificado_password = null;
        else if (nuevaPassword.trim()) body.certificado_password = nuevaPassword.trim();

        const res = await fetchWithSupabaseSession("/api/configuracion/sifen", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = (await res.json()) as { success?: boolean; data?: EmpresaSifenConfigDTO; error?: string };
        if (!res.ok || !j.success) {
          setError(j.error ?? "No se pudo actualizar");
          return;
        }
        setCfg(j.data!);
        setNuevaPassword("");
        setLimpiarPassword(false);
        setSuccess("Cambios guardados.");
        if (j.data != null && isSifenConfigCompleta(j.data)) setEditarFormulario(false);
      }
      await load();
    } catch {
      setError("Error de red");
    } finally {
      setSaving(false);
    }
  }

  function isHexColor(s: string): boolean {
    return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(s.trim());
  }

  async function guardarBrandingColores() {
    setError(null);
    setSuccess(null);
    const color = kudeColorPrimario.trim();
    const colorFill = kudeColorPrimarioFill.trim();
    if (color && !isHexColor(color)) {
      setError("Color primario inválido. Formato esperado: #RRGGBB (ej. #0ea5e9).");
      return;
    }
    if (!derivarFill && colorFill && !isHexColor(colorFill)) {
      setError("Color de acento inválido. Formato esperado: #RRGGBB.");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        kude_color_primario: color ? color : null,
        kude_color_primario_fill: derivarFill ? null : colorFill ? colorFill : null,
      };
      const res = await fetchWithSupabaseSession("/api/configuracion/sifen", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as { success?: boolean; data?: EmpresaSifenConfigDTO; error?: string };
      if (!res.ok || !j.success || !j.data) {
        setError(j.error ?? "No se pudo guardar la personalización KuDE");
        return;
      }
      setCfg(j.data);
      setKudeColorPrimario(j.data.kude_color_primario ?? "");
      setKudeColorPrimarioFill(j.data.kude_color_primario_fill ?? "");
      setSuccess("Personalización KuDE guardada. Solo afecta al PDF/KuDE.");
    } catch {
      setError("Error de red al guardar la personalización KuDE");
    } finally {
      setSaving(false);
    }
  }

  async function onKudeLogoFileChange(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;

    if (file.type && file.type !== "image/png") {
      setError("Solo se acepta logo en formato PNG.");
      return;
    }
    if (file.size > 1 * 1024 * 1024) {
      setError("El logo supera el máximo permitido (1 MB).");
      return;
    }

    setError(null);
    setSuccess(null);
    setSubiendoLogo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetchWithSupabaseSession("/api/configuracion/sifen/kude-logo", {
        method: "POST",
        body: fd,
      });
      const j = (await res.json()) as {
        success?: boolean;
        data?: { config?: EmpresaSifenConfigDTO; kude_logo_path?: string };
        error?: string;
      };
      if (!res.ok || !j.success) {
        setError(j.error ?? "No se pudo subir el logo KuDE");
        return;
      }
      if (j.data?.config) {
        setCfg(j.data.config);
        setKudeLogoPathActual(j.data.config.kude_logo_path ?? null);
      } else if (j.data?.kude_logo_path) {
        setKudeLogoPathActual(j.data.kude_logo_path);
      }
      setSuccess("Logo KuDE actualizado. Solo afecta al PDF/KuDE.");
    } catch {
      setError("Error de red al subir el logo KuDE");
    } finally {
      setSubiendoLogo(false);
    }
  }

  async function restaurarLogoKude() {
    setError(null);
    setSuccess(null);
    setEliminandoLogo(true);
    try {
      const res = await fetchWithSupabaseSession("/api/configuracion/sifen/kude-logo", {
        method: "DELETE",
      });
      const j = (await res.json()) as { success?: boolean; data?: { config?: EmpresaSifenConfigDTO }; error?: string };
      if (!res.ok || !j.success) {
        setError(j.error ?? "No se pudo restaurar el logo por defecto");
        return;
      }
      if (j.data?.config) {
        setCfg(j.data.config);
        setKudeLogoPathActual(j.data.config.kude_logo_path ?? null);
      } else {
        setKudeLogoPathActual(null);
      }
      setSuccess("Logo personalizado eliminado. Se usará el logo Neura por defecto.");
    } catch {
      setError("Error de red al restaurar el logo");
    } finally {
      setEliminandoLogo(false);
    }
  }

  /** Sube un logo ADICIONAL (con nombre) para poder elegirlo al facturar. */
  async function onLogoExtraFileChange(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0] ?? null;
    if (ev.target) ev.target.value = "";
    if (!file) return;
    const nombre = nombreNuevoLogo.trim();
    if (!nombre) {
      setError("Primero escribí un nombre para el logo (p. ej. «BLB» o «ADR»).");
      return;
    }
    if (file.type && file.type !== "image/png") {
      setError("Solo se acepta logo en formato PNG.");
      return;
    }
    if (file.size > 1024 * 1024) {
      setError("El logo supera el máximo permitido (1 MB).");
      return;
    }
    setError(null);
    setSuccess(null);
    setSubiendoLogoExtra(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("nombre", nombre);
      const res = await fetchWithSupabaseSession("/api/configuracion/sifen/kude-logos", {
        method: "POST",
        body: fd,
      });
      const j = (await res.json()) as { success?: boolean; data?: { config?: EmpresaSifenConfigDTO }; error?: string };
      if (!res.ok || !j.success) {
        setError(j.error ?? "No se pudo subir el logo");
        return;
      }
      if (j.data?.config) {
        setCfg(j.data.config);
        setKudeLogos(j.data.config.kude_logos ?? []);
      }
      setNombreNuevoLogo("");
      setSuccess("Logo agregado. Podés elegirlo al facturar. Solo afecta el KuDE/PDF.");
    } catch {
      setError("Error de red al subir el logo");
    } finally {
      setSubiendoLogoExtra(false);
    }
  }

  async function eliminarLogoExtra(logoId: string) {
    setError(null);
    setSuccess(null);
    setEliminandoLogoId(logoId);
    try {
      const res = await fetchWithSupabaseSession(
        `/api/configuracion/sifen/kude-logos?logo_id=${encodeURIComponent(logoId)}`,
        { method: "DELETE" }
      );
      const j = (await res.json()) as { success?: boolean; data?: { config?: EmpresaSifenConfigDTO }; error?: string };
      if (!res.ok || !j.success) {
        setError(j.error ?? "No se pudo eliminar el logo");
        return;
      }
      if (j.data?.config) {
        setCfg(j.data.config);
        setKudeLogos(j.data.config.kude_logos ?? []);
      }
      setSuccess("Logo eliminado.");
    } catch {
      setError("Error de red al eliminar el logo");
    } finally {
      setEliminandoLogoId(null);
    }
  }

  async function onCertFileChange(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) {
      setNombreArchivoCert(null);
      return;
    }
    setNombreArchivoCert(file.name);
    setError(null);
    setSuccess(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetchWithSupabaseSession("/api/configuracion/sifen/certificado", { method: "POST", body: fd });
      const j = (await res.json()) as {
        success?: boolean;
        data?: { config?: EmpresaSifenConfigDTO };
        error?: string;
      };
      if (!res.ok || !j.success) {
        setError(j.error ?? "No se pudo subir el certificado");
        return;
      }
      if (j.data?.config) setCfg(j.data.config);
      setNombreArchivoCert(null);
      setSuccess("Certificado .p12 cargado correctamente.");
      await load();
      const c = j.data?.config as EmpresaSifenConfigDTO | undefined;
      if (c && isSifenConfigCompleta(c)) setEditarFormulario(false);
    } catch {
      setError("Error de red al subir certificado");
    } finally {
      setUploading(false);
    }
  }

  const datosMinimosOk =
    Boolean(ruc.trim()) &&
    Boolean(razonSocial.trim()) &&
    Boolean(direccionFiscal.trim()) &&
    Boolean(timbradoNumero.trim()) &&
    Boolean(timbradoFechaIni.trim()) &&
    Boolean(actEcoCodigo.trim()) &&
    Boolean(actEcoDescripcion.trim()) &&
    Boolean(establecimiento.trim()) &&
    Boolean(puntoExpedicion.trim());

  const tieneCert = Boolean(cfg?.certificado_path);
  const tieneCertificadoCargado = Boolean(cfg?.certificado_path?.trim());
  const tienePw = Boolean(cfg?.has_certificado_password);

  const configCompleta = cfg != null && isSifenConfigCompleta(cfg);
  const mostrarFormulario = cfg == null || !configCompleta || editarFormulario;

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-24 text-center text-sm text-slate-400">Cargando configuración SIFEN…</div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <div className="flex flex-col gap-1">
        <Link href="/configuracion" className="text-xs font-medium text-[#4FAEB2] hover:underline w-fit">
          ← Volver a configuración global
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Facturación electrónica (SIFEN)</h1>
        <p className="text-sm text-gray-500">
          Datos del emisor y certificado digital. Las empresas sin SIFEN siguen usando facturas normales.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3">{error}</div>
      )}
      {success && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-4 py-3">
          {success}
        </div>
      )}

      {configCompleta && !mostrarFormulario && cfg && (
        <Card>
          <div className="rounded-xl border border-emerald-200 bg-gradient-to-b from-emerald-50/90 to-white px-5 py-5 space-y-4">
            <div className="flex flex-wrap items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-lg" aria-hidden>
                ✅
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <h2 className="text-lg font-bold text-emerald-950">Configuración SIFEN lista para operar</h2>
                <p className="text-sm text-emerald-900/80 leading-relaxed">
                  Ya completaste los datos del emisor, el certificado y la contraseña. Podés generar documentos electrónicos en el flujo de
                  facturas cuando corresponda.
                </p>
              </div>
            </div>
            <ul className="text-sm text-slate-700 space-y-1.5 border-t border-emerald-100 pt-4">
              <li>
                <span className="text-slate-500">Ambiente:</span>{" "}
                <span className="font-medium">{cfg.ambiente === "produccion" ? "Producción" : "Test"}</span>
              </li>
              <li>
                <span className="text-slate-500">RUC:</span> <span className="font-mono font-medium">{cfg.ruc}</span>
              </li>
              <li>
                <span className="text-slate-500">Razón social:</span> <span className="font-medium">{cfg.razon_social}</span>
              </li>
              <li>
                <span className="text-slate-500">Dirección fiscal (SIFEN):</span>{" "}
                <span className="font-medium">{cfg.direccion_fiscal ?? "—"}</span>
              </li>
              <li>
                <span className="text-slate-500">Inicio vigencia timbrado (dFeIniT):</span>{" "}
                <span className="font-mono font-medium">{cfg.timbrado_fecha_inicio_vigencia ?? "—"}</span>
              </li>
              <li>
                <span className="text-slate-500">Actividad económica (cActEco):</span>{" "}
                <span className="font-mono font-medium">{cfg.actividad_economica_codigo ?? "—"}</span>
                {cfg.actividad_economica_descripcion ? (
                  <span className="block text-slate-600 mt-0.5">{cfg.actividad_economica_descripcion}</span>
                ) : null}
                {cfg.actividades_economicas_secundarias?.length ? (
                  <span className="block text-slate-500 mt-0.5 text-xs">
                    + {cfg.actividades_economicas_secundarias.length} actividad(es) secundaria(s) en la factura
                  </span>
                ) : null}
              </li>
              {cfg.kude_logos?.length ? (
                <li>
                  <span className="text-slate-500">Logos KuDE adicionales:</span>{" "}
                  <span className="font-medium text-slate-700">
                    {cfg.kude_logos.map((l) => l.nombre).join(", ")}
                  </span>
                </li>
              ) : null}
              <li>
                <span className="text-slate-500">Certificado .p12:</span>{" "}
                <span className="font-medium text-emerald-800">Cargado</span>
              </li>
              <li>
                <span className="text-slate-500">Contraseña del certificado:</span>{" "}
                <span className="font-medium text-emerald-800">Configurada</span>
              </li>
              <li>
                <span className="text-slate-500">SIFEN:</span>{" "}
                <span className="font-semibold text-emerald-800">Activo</span>
              </li>
            </ul>
            <button
              type="button"
              onClick={() => {
                setEditarFormulario(true);
                setSuccess(null);
              }}
              className="w-full sm:w-auto rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
            >
              Editar configuración
            </button>
          </div>
        </Card>
      )}

      {mostrarFormulario && (
      <Card>
        <SectionTitle>Estado</SectionTitle>
        <div className="flex flex-wrap gap-2">
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
              datosMinimosOk ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-amber-50 text-amber-800 border-amber-200"
            }`}
          >
            {datosMinimosOk ? "Datos obligatorios completos" : "Configuración incompleta"}
          </span>
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
              datosMinimosOk && activo
                ? "bg-[#4FAEB2]/8 text-[#3F8E91] border-[#4FAEB2]/30"
                : "bg-slate-100 text-slate-600 border-slate-200"
            }`}
          >
            {datosMinimosOk && activo ? "Lista para operar (activo)" : activo ? "Revisá campos obligatorios" : "Inactivo — no se generan DE"}
          </span>
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
              tieneCert ? "bg-[#4FAEB2]/10 text-[#3F8E91] border-[#4FAEB2]/30" : "bg-slate-100 text-slate-500 border-slate-200"
            }`}
          >
            Certificado: {tieneCert ? "Cargado" : "No cargado"}
          </span>
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
              tienePw ? "bg-violet-50 text-violet-900 border-violet-200" : "bg-slate-100 text-slate-500 border-slate-200"
            }`}
          >
            Contraseña .p12: {tienePw ? "Configurada" : "No configurada"}
          </span>
        </div>
      </Card>
      )}

      <form onSubmit={guardar} className={`space-y-5 ${mostrarFormulario ? "" : "hidden"}`} aria-hidden={!mostrarFormulario}>
        <Card>
          <SectionTitle>Datos del emisor</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={fLabel}>Ambiente</label>
              <select
                className={fSelect}
                value={ambiente}
                onChange={(e) => setAmbiente(e.target.value as AmbienteSifen)}
              >
                <option value="test">Test</option>
                <option value="produccion">Producción</option>
              </select>
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={activo}
                  onChange={(e) => setActivo(e.target.checked)}
                  className="rounded border-slate-300"
                />
                SIFEN activo para esta empresa
              </label>
            </div>
            <div>
              <label className={fLabel}>Plazo cancelación DE (horas)</label>
              <input
                type="number"
                min={1}
                max={8760}
                className={fInput}
                value={plazoCancelacionHoras}
                onChange={(e) => setPlazoCancelacionHoras(parseInt(e.target.value, 10) || 1)}
              />
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                Ventana desde la marca de aprobación SET (<span className="font-mono">sifen_aprobado_at</span>) en la que se permite anular el DE en el ERP sin pagos registrados. Por defecto en base de datos: 48 h.
              </p>
            </div>
            <div>
              <label className={fLabel}>RUC</label>
              <input className={fInput} value={ruc} onChange={(e) => setRuc(e.target.value)} required />
            </div>
            <div>
              <label className={fLabel}>Razón social</label>
              <input className={fInput} value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} required />
            </div>
            <div className="sm:col-span-2">
              <label className={fLabel}>Dirección fiscal (calle / domicilio)</label>
              <input
                className={fInput}
                value={direccionFiscal}
                onChange={(e) => setDireccionFiscal(e.target.value)}
                placeholder="Ej: Av. España 1234, piso 2"
                required
              />
              <p className="text-xs text-slate-500 mt-1.5">
                Va al XML SIFEN como <span className="font-mono">dDirEmi</span>. No uses la razón social aquí.
              </p>
            </div>
            <div>
              <label className={fLabel}>Timbrado (número)</label>
              <input className={fInput} value={timbradoNumero} onChange={(e) => setTimbradoNumero(e.target.value)} required />
            </div>
            <div>
              <label className={fLabel}>Inicio vigencia del timbrado</label>
              <FechaSelect
                className={fInput}
                value={timbradoFechaIni}
                onChange={(e) => setTimbradoFechaIni(e.target.value)}
                required
/>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                Misma fecha que <span className="font-medium">«Fecha Inicio Vigencia»</span> en la resolución DNIT del timbrado. Va al XML como{" "}
                <span className="font-mono">dFeIniT</span>. Si no coincide, SET devuelve error 1107.
              </p>
            </div>
            <div>
              <label className={fLabel}>Código actividad económica (cActEco)</label>
              <input
                className={fInput}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Ej: 70209"
                value={actEcoCodigo}
                onChange={(e) => setActEcoCodigo(e.target.value.replace(/\D/g, "").slice(0, 8))}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className={fLabel}>Descripción actividad económica (dDesActEco)</label>
              <textarea
                className={`${fInput} min-h-[4rem] resize-y`}
                value={actEcoDescripcion}
                onChange={(e) => setActEcoDescripcion(e.target.value)}
                placeholder="Texto exacto del catálogo SET / e-kuatia para ese código"
                required
                rows={3}
              />
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                Debe ser la <span className="font-medium">actividad principal declarada para tu RUC</span>. Copiá código y descripción del
                catálogo en e-kuatia o de tu constancia. Si no coinciden con lo que tiene la SET, devuelve error <span className="font-mono">1261</span>.
              </p>
            </div>

            {/* ── Actividades económicas secundarias ───────────────────────── */}
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <label className={fLabel}>Actividades económicas secundarias</label>
                <button
                  type="button"
                  className="text-xs font-semibold text-[#2563eb] hover:underline disabled:opacity-40"
                  disabled={actividadesSec.length >= 8}
                  onClick={() => setActividadesSec((prev) => [...prev, { codigo: "", descripcion: "" }])}
                >
                  + Agregar actividad
                </button>
              </div>
              <p className="text-xs text-slate-500 mb-2 leading-relaxed">
                Las demás actividades que figuran en tu constancia de RUC ante la DNIT. Se incluyen todas en la misma factura
                (grupos <span className="font-mono">gActEco</span> del XML), así no hay que cambiar el rubro en cada emisión. Máx. 8.
              </p>
              {actividadesSec.length === 0 ? (
                <p className="text-xs text-slate-400 italic">
                  Sin actividades secundarias. La factura mostrará solo la actividad principal.
                </p>
              ) : (
                <div className="space-y-2">
                  {actividadesSec.map((a, i) => (
                    <div key={i} className="flex flex-col sm:flex-row gap-2 items-start">
                      <input
                        className={`${fInput} sm:w-32`}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="Código"
                        value={a.codigo}
                        onChange={(e) => {
                          const v = e.target.value.replace(/\D/g, "").slice(0, 8);
                          setActividadesSec((prev) => prev.map((x, j) => (j === i ? { ...x, codigo: v } : x)));
                        }}
                      />
                      <input
                        className={`${fInput} flex-1`}
                        placeholder="Descripción exacta del catálogo SET"
                        value={a.descripcion}
                        onChange={(e) => {
                          const v = e.target.value;
                          setActividadesSec((prev) => prev.map((x, j) => (j === i ? { ...x, descripcion: v } : x)));
                        }}
                      />
                      <button
                        type="button"
                        className="text-xs font-semibold text-red-600 hover:underline px-2 py-2 shrink-0"
                        onClick={() => setActividadesSec((prev) => prev.filter((_, j) => j !== i))}
                      >
                        Quitar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className={fLabel}>Establecimiento</label>
              <input className={fInput} value={establecimiento} onChange={(e) => setEstablecimiento(e.target.value)} required />
            </div>
            <div>
              <label className={fLabel}>Punto de expedición</label>
              <input className={fInput} value={puntoExpedicion} onChange={(e) => setPuntoExpedicion(e.target.value)} required />
            </div>
            <div>
              <label className={fLabel}>CSC</label>
              <input
                className={fInput}
                value={csc}
                onChange={(e) => setCsc(e.target.value)}
                placeholder="Opcional"
                autoComplete="off"
              />
            </div>
            <div>
              <label className={fLabel}>N° de CSC (IdCSC)</label>
              <input
                className={fInput}
                value={idCsc}
                onChange={(e) => setIdCsc(e.target.value)}
                placeholder="0001"
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-slate-500">
                Cuál de los CSC del contribuyente es el de arriba. La SET entrega cada código con
                su número y verifica el hash del QR contra ése: si acá dice <code>0001</code> y el
                código es el <code>0002</code>, devuelve «hash del código QR inválido». Vacío = 0001.
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <SectionTitle>Certificado digital (.p12)</SectionTitle>
          <p className="text-xs text-slate-500 mb-3">
            El archivo se guarda de forma privada. No se muestra la contraseña ni datos cifrados.
          </p>
          <div className="space-y-3">
            <div>
              <label className={fLabel}>Ruta en almacenamiento (solo lectura)</label>
              <input
                className={`${fInput} bg-slate-50 text-slate-600`}
                readOnly
                value={cfg?.certificado_path ?? "—"}
              />
            </div>
            <div>
              <label className={fLabel}>Vencimiento del certificado</label>
              <FechaSelect className={fInput} value={certVenc} onChange={(e) => setCertVenc(e.target.value)} />
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                {tieneCertificadoCargado ? (
                  <>
                    <span className="font-medium text-slate-600">Obligatorio</span> mientras tengas un .p12 cargado.
                  </>
                ) : (
                  <>Opcional hasta que subas el certificado; podés guardar la configuración base antes.</>
                )}
              </p>
            </div>
            <div>
              <label htmlFor={certFileInputId} className={`${fLabel} block`}>
                Subir / reemplazar .p12
              </label>
              <input
                ref={certFileInputRef}
                id={certFileInputId}
                type="file"
                accept=".p12,.pfx,application/x-pkcs12,application/octet-stream"
                disabled={!cfg || uploading}
                onChange={onCertFileChange}
                className="sr-only"
              />
              <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <button
                  type="button"
                  disabled={!cfg || uploading}
                  onClick={() => certFileInputRef.current?.click()}
                  className="w-fit rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Seleccionar archivo
                </button>
                {nombreArchivoCert && (
                  <span className="text-xs text-slate-600 truncate max-w-full sm:max-w-xs" title={nombreArchivoCert}>
                    Archivo: <span className="font-mono font-medium text-slate-800">{nombreArchivoCert}</span>
                  </span>
                )}
              </div>
              {!cfg && (
                <p className="text-xs text-amber-700 mt-2">Guardá primero la configuración base para habilitar la subida del certificado.</p>
              )}
              {uploading && <p className="text-xs text-slate-500 mt-1">Subiendo…</p>}
            </div>
            <div>
              <label className={fLabel}>Contraseña del certificado</label>
              <input
                type="password"
                className={fInput}
                autoComplete="new-password"
                value={nuevaPassword}
                onChange={(e) => setNuevaPassword(e.target.value)}
                placeholder={cfg ? "Nueva contraseña (dejar vacío para no cambiar)" : "Opcional al crear"}
              />
              {cfg && (
                <label className="mt-2 flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={limpiarPassword}
                    onChange={(e) => setLimpiarPassword(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Eliminar contraseña guardada en el servidor
                </label>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <SectionTitle>Personalización KuDE</SectionTitle>
          <p className="text-xs text-slate-500 mb-4 leading-relaxed">
            Logo y color para la representación gráfica (KuDE/PDF) de la factura electrónica.
            <span className="font-medium text-slate-700"> Esto solo afecta el PDF/KuDE; no cambia XML, firma ni envío a SET.</span>{" "}
            Si no configurás nada se usa el diseño Neura por defecto.
          </p>
          <div className="space-y-5">
            <div>
              <label className={fLabel}>Logo (PNG, máx. 1 MB)</label>
              <input
                ref={kudeLogoInputRef}
                id={kudeLogoInputId}
                type="file"
                accept="image/png"
                disabled={!cfg || subiendoLogo || eliminandoLogo}
                onChange={onKudeLogoFileChange}
                className="sr-only"
              />
              <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <button
                  type="button"
                  disabled={!cfg || subiendoLogo || eliminandoLogo}
                  onClick={() => kudeLogoInputRef.current?.click()}
                  className="w-fit rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {subiendoLogo ? "Subiendo…" : kudeLogoPathActual ? "Reemplazar logo" : "Subir logo"}
                </button>
                {kudeLogoPathActual && (
                  <button
                    type="button"
                    disabled={!cfg || eliminandoLogo || subiendoLogo}
                    onClick={restaurarLogoKude}
                    className="w-fit rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 shadow-sm hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {eliminandoLogo ? "Restaurando…" : "Restaurar logo por defecto"}
                  </button>
                )}
                <span className="text-xs text-slate-600">
                  {kudeLogoPathActual ? (
                    <>
                      Estado: <span className="font-medium text-emerald-800">Logo personalizado cargado</span>
                    </>
                  ) : (
                    <>
                      Estado: <span className="font-medium text-slate-700">Logo Neura por defecto</span>
                    </>
                  )}
                </span>
              </div>
              {!cfg && (
                <p className="text-xs text-amber-700 mt-2">
                  Guardá primero la configuración SIFEN base para habilitar la subida del logo.
                </p>
              )}
            </div>

            {/* ── Logos adicionales (se elige cuál usar al facturar) ───────── */}
            <div className="border-t border-slate-100 pt-4">
              <label className={fLabel}>Logos adicionales (para elegir al facturar)</label>
              <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                Cargá otros logos con un nombre (p. ej. «BLB», «ADR») y al emitir cada factura elegís cuál usar en el KuDE.
                Los datos fiscales del emisor no cambian: siguen los del RUC configurado. Solo afecta el PDF/KuDE.
              </p>

              {kudeLogos.length > 0 && (
                <ul className="mb-3 space-y-2">
                  {kudeLogos.map((l) => (
                    <li
                      key={l.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <span className="text-sm font-medium text-slate-800 truncate">{l.nombre}</span>
                      <button
                        type="button"
                        disabled={eliminandoLogoId === l.id}
                        onClick={() => eliminarLogoExtra(l.id)}
                        className="text-xs font-semibold text-rose-700 hover:underline disabled:opacity-40 shrink-0"
                      >
                        {eliminandoLogoId === l.id ? "Eliminando…" : "Eliminar"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  className={`${fInput} sm:w-48`}
                  placeholder="Nombre del logo"
                  maxLength={60}
                  value={nombreNuevoLogo}
                  disabled={!cfg || subiendoLogoExtra}
                  onChange={(e) => setNombreNuevoLogo(e.target.value)}
                />
                <input
                  ref={logoExtraInputRef}
                  type="file"
                  accept="image/png"
                  disabled={!cfg || subiendoLogoExtra}
                  onChange={onLogoExtraFileChange}
                  className="sr-only"
                />
                <button
                  type="button"
                  disabled={!cfg || subiendoLogoExtra || !nombreNuevoLogo.trim() || kudeLogos.length >= 8}
                  onClick={() => logoExtraInputRef.current?.click()}
                  className="w-fit rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {subiendoLogoExtra ? "Subiendo…" : "Agregar logo (PNG, máx. 1 MB)"}
                </button>
              </div>
              {kudeLogos.length >= 8 && (
                <p className="text-xs text-amber-700 mt-2">Alcanzaste el máximo de 8 logos adicionales.</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={fLabel}>Color principal (bordes, acentos)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    className="h-10 w-12 cursor-pointer rounded border border-slate-200 bg-white p-1"
                    value={isHexColor(kudeColorPrimario) ? kudeColorPrimario : "#0ea5e9"}
                    onChange={(e) => setKudeColorPrimario(e.target.value)}
                  />
                  <input
                    className={fInput}
                    value={kudeColorPrimario}
                    onChange={(e) => setKudeColorPrimario(e.target.value)}
                    placeholder="#0ea5e9 (vacío = default Neura)"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  Dejá vacío para usar el azul Neura por defecto.
                </p>
              </div>

              <div>
                <label className={fLabel}>Color de acento (fondo suave)</label>
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer mb-2">
                  <input
                    type="checkbox"
                    checked={derivarFill}
                    onChange={(e) => setDerivarFill(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Derivar automáticamente del color principal
                </label>
                <div className={`flex items-center gap-2 ${derivarFill ? "opacity-50 pointer-events-none" : ""}`}>
                  <input
                    type="color"
                    disabled={derivarFill}
                    className="h-10 w-12 cursor-pointer rounded border border-slate-200 bg-white p-1 disabled:cursor-not-allowed"
                    value={isHexColor(kudeColorPrimarioFill) ? kudeColorPrimarioFill : "#eaf6fc"}
                    onChange={(e) => setKudeColorPrimarioFill(e.target.value)}
                  />
                  <input
                    className={fInput}
                    disabled={derivarFill}
                    value={kudeColorPrimarioFill}
                    onChange={(e) => setKudeColorPrimarioFill(e.target.value)}
                    placeholder="Solo si querés sobreescribir el acento"
                  />
                </div>
              </div>
            </div>

            <div>
              <button
                type="button"
                disabled={!cfg || saving}
                onClick={guardarBrandingColores}
                className="rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Guardar colores"}
              </button>
              <p className="text-xs text-slate-500 mt-2">
                El logo se guarda automáticamente al subirlo. Los colores se persisten al pulsar «Guardar colores».
              </p>
            </div>
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="bg-[#4FAEB2] hover:bg-[#3F8E91] text-white px-5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Guardando…" : cfg ? "Guardar cambios" : "Crear configuración SIFEN"}
          </button>
          {configCompleta && editarFormulario && (
            <button
              type="button"
              onClick={() => {
                setEditarFormulario(false);
                setError(null);
                setSuccess(null);
                if (cfg) {
                  setAmbiente(cfg.ambiente);
                  setRuc(cfg.ruc);
                  setRazonSocial(cfg.razon_social);
                  setDireccionFiscal(cfg.direccion_fiscal ?? "");
                  setTimbradoNumero(cfg.timbrado_numero);
                  setTimbradoFechaIni(ymdToDateInput(cfg.timbrado_fecha_inicio_vigencia));
                  setActEcoCodigo(cfg.actividad_economica_codigo ?? "");
                  setActEcoDescripcion(cfg.actividad_economica_descripcion ?? "");
                  setEstablecimiento(cfg.establecimiento);
                  setPuntoExpedicion(cfg.punto_expedicion);
                  setCsc(cfg.csc ?? "");
                  setIdCsc(cfg.id_csc ?? "");
                  setActivo(cfg.activo);
                  setCertVenc(isoToDateInput(cfg.certificado_vencimiento));
                }
                setNuevaPassword("");
                setLimpiarPassword(false);
              }}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancelar edición
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
