"use client";

import { useRef, useState } from "react";
import { ImageUp, Loader2, X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Campo de imagen para el contenido del sitio: sube al bucket `web-imagenes`
 * y deja la URL pública en el campo.
 *
 * Sigue aceptando una URL escrita a mano: muchas fotos del sitio hoy vienen de
 * Pexels y de otros lados, y obligar a subirlas todas sería un retroceso.
 *
 * La subida necesita que la fila ya exista, porque la imagen se guarda en
 * `{empresa}/{coleccion}/{id}/`. En el formulario de alta el botón aparece
 * deshabilitado y lo dice, en vez de fallar al tocarlo.
 */
export default function CampoImagen({
  label = "Imagen",
  coleccion,
  idFila,
  valor,
  onChange,
}: {
  label?: string;
  coleccion: "evento" | "moto" | "encuentro" | "producto";
  /** `null` en el formulario de alta: todavía no hay fila donde colgar el archivo. */
  idFila: string | null;
  valor: string;
  onChange: (url: string) => void;
}) {
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function subir(file: File) {
    if (!idFila) return;
    setSubiendo(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("archivo", file);
      fd.append("coleccion", coleccion);
      fd.append("id", idFila);
      const r = await fetchWithSupabaseSession("/api/web/imagen", { method: "POST", body: fd });
      const j = (await r.json()) as { success?: boolean; data?: { url?: string }; error?: string };
      if (!j.success || !j.data?.url) throw new Error(j.error ?? "No se pudo subir la imagen.");
      onChange(j.data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al subir.");
    } finally {
      setSubiendo(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>

      <div className="flex flex-wrap items-start gap-3">
        {valor ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={valor}
              alt=""
              className="h-20 w-20 rounded-xl border border-slate-200 object-cover"
            />
            <button
              type="button"
              onClick={() => onChange("")}
              aria-label="Quitar imagen"
              className="absolute -right-2 -top-2 rounded-full border border-slate-300 bg-white p-1 text-slate-500 shadow-sm transition-colors hover:text-red-600"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-slate-300 text-slate-300">
            <ImageUp className="h-6 w-6" />
          </div>
        )}

        <div className="min-w-[240px] flex-1 space-y-2">
          <input
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
            placeholder="https://… o subí un archivo"
            value={valor}
            onChange={(e) => onChange(e.target.value)}
          />

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void subir(f);
              }}
            />
            <button
              type="button"
              disabled={!idFila || subiendo}
              onClick={() => input.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {subiendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageUp className="h-3.5 w-3.5" />}
              {subiendo ? "Subiendo…" : "Subir imagen"}
            </button>
            <span className="text-[11px] text-slate-400">
              {idFila ? "JPG, PNG, WebP o AVIF · hasta 8 MB" : "Guardá primero para poder subir un archivo"}
            </span>
          </div>

          {error && <div className="text-xs text-red-600">{error}</div>}
        </div>
      </div>
    </div>
  );
}
