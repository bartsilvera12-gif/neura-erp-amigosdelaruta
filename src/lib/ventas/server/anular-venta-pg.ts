import "server-only";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";

/**
 * Anulación de una venta: devuelve el stock y la marca como anulada.
 *
 * Todo en una transacción. Si algo falla a mitad, el stock no queda a medio
 * devolver: o se revierte la venta entera o no se toca nada.
 *
 * Lo que NO hace, a propósito: anular una venta cuyo documento electrónico ya
 * llegó a la SET. Un documento aprobado no se borra, se cancela ante la SET o
 * se corrige con una nota de crédito. Esa comprobación vive en la ruta, que es
 * la que sabe leer `factura_electronica`.
 */

export type AnularVentaResultado = {
  numeroControl: string;
  itemsDevueltos: number;
  facturaAnuladaId: string | null;
};

export async function anularVentaPg(params: {
  schema: string;
  empresaId: string;
  ventaId: string;
  motivo: string;
  /** Factura del ERP a marcar anulada junto con la venta, si corresponde. */
  facturaId: string | null;
  anuladaPor: string | null;
}): Promise<AnularVentaResultado> {
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool no disponible.");

  const ventasT = quoteSchemaTable(params.schema, "ventas");
  const itemsT = quoteSchemaTable(params.schema, "ventas_items");
  const prodT = quoteSchemaTable(params.schema, "productos");
  const movT = quoteSchemaTable(params.schema, "movimientos");
  const facT = quoteSchemaTable(params.schema, "facturas");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    /*
     * `FOR UPDATE`: bloquea la venta mientras dura la anulación. Sin esto, dos
     * pestañas anulando la misma venta devolverían el stock dos veces.
     */
    const vQ = await client.query<{ numero_control: string; estado: string }>(
      `SELECT numero_control, estado FROM ${ventasT}
        WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
      [params.ventaId, params.empresaId]
    );
    const venta = vQ.rows[0];
    if (!venta) throw new Error("La venta no existe.");
    if (venta.estado === "anulada") throw new Error("La venta ya fue anulada.");

    const itemsQ = await client.query<{
      producto_id: string;
      producto_nombre: string;
      sku: string;
      cantidad: number | string;
    }>(
      `SELECT producto_id, producto_nombre, sku, cantidad
         FROM ${itemsT} WHERE venta_id = $1::uuid AND empresa_id = $2::uuid`,
      [params.ventaId, params.empresaId]
    );

    const ahora = new Date().toISOString();

    for (const it of itemsQ.rows) {
      const cant = Number(it.cantidad) || 0;
      if (cant <= 0) continue;

      const pQ = await client.query<{ stock_actual: number | string; costo_compra: number | string | null }>(
        `SELECT stock_actual, costo_compra FROM ${prodT}
          WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
        [it.producto_id, params.empresaId]
      );
      const prod = pQ.rows[0];
      // Un producto borrado después de la venta no frena la anulación: la venta
      // se anula igual y ese ítem simplemente no tiene stock al que volver.
      if (!prod) continue;

      const nuevoStock = (Number(prod.stock_actual) || 0) + cant;
      await client.query(
        `UPDATE ${prodT} SET stock_actual = $1 WHERE id = $2::uuid AND empresa_id = $3::uuid`,
        [nuevoStock, it.producto_id, params.empresaId]
      );

      /*
       * El movimiento va como `origen = 'venta'` porque la restricción de la
       * tabla sólo admite compra / venta / ajuste_manual / inventario_inicial.
       * Es el reverso de esta venta y conserva el `venta_id`, así que la
       * trazabilidad queda; la referencia aclara que es una anulación.
       */
      await client.query(
        `
        INSERT INTO ${movT} (
          empresa_id, producto_id, producto_nombre, producto_sku,
          tipo, cantidad, costo_unitario, origen, referencia, fecha, venta_id
        ) VALUES (
          $1, $2, $3, $4,
          'ENTRADA', $5, $6, 'venta', $7, $8::timestamptz, $9
        )
        `,
        [
          params.empresaId,
          it.producto_id,
          it.producto_nombre,
          it.sku,
          cant,
          Number(prod.costo_compra) || 0,
          `${venta.numero_control} (anulación)`,
          ahora,
          params.ventaId,
        ]
      );
    }

    await client.query(
      `UPDATE ${ventasT}
          SET estado = 'anulada',
              anulada_at = $1::timestamptz,
              motivo_anulacion = $2,
              anulada_por = $3::uuid
        WHERE id = $4::uuid AND empresa_id = $5::uuid`,
      [ahora, params.motivo, params.anuladaPor, params.ventaId, params.empresaId]
    );

    let facturaAnuladaId: string | null = null;
    if (params.facturaId) {
      /*
       * La factura se anula con la venta. Llega acá sólo si la ruta ya
       * comprobó que su documento electrónico no fue aceptado por la SET: si
       * lo hubiera sido, anularla sería negar un documento que existe.
       */
      await client.query(
        `UPDATE ${facT} SET estado = 'Anulado', saldo = 0, updated_at = $1::timestamptz
          WHERE id = $2::uuid AND empresa_id = $3::uuid`,
        [ahora, params.facturaId, params.empresaId]
      );
      facturaAnuladaId = params.facturaId;
    }

    await client.query("COMMIT");
    return {
      numeroControl: venta.numero_control,
      itemsDevueltos: itemsQ.rows.length,
      facturaAnuladaId,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
