/**
 * Caché en memoria stale-while-revalidate, para no esperar a la API de ML en
 * cada navegación del panel:
 *
 *   más nuevo que `fresco`    se devuelve tal cual
 *   más nuevo que `maxViejo`  se devuelve igual, y se recarga en segundo plano
 *   más viejo, o no está      se espera la carga
 *
 * Un solo `cargar` por clave a la vez (dos pestañas o un precargado más el clic
 * no duplican el pedido). Los errores no se guardan: el que espera recibe el
 * error, y si falla un refresco de fondo queda el valor anterior. Guarda hasta
 * `max` claves; pasado eso se va la menos usada.
 */
export interface OpcionesCache {
  fresco: number;
  maxViejo: number;
  max: number;
}

export function crearCache<T>({ fresco, maxViejo, max }: OpcionesCache) {
  const entradas = new Map<string, { at: number; value: T }>();
  const enCurso = new Map<string, Promise<T>>();

  function cargar(clave: string, cargador: () => Promise<T>): Promise<T> {
    let pedido = enCurso.get(clave);
    if (!pedido) {
      pedido = cargador()
        .then((value) => {
          entradas.delete(clave);
          entradas.set(clave, { at: Date.now(), value });
          if (entradas.size > max) entradas.delete(entradas.keys().next().value!);
          return value;
        })
        .finally(() => enCurso.delete(clave));
      enCurso.set(clave, pedido);
    }
    return pedido;
  }

  return {
    /** `forzar`: ignora lo guardado (el botón "Actualizar"). */
    async obtener(clave: string, cargador: () => Promise<T>, { forzar = false } = {}): Promise<T> {
      const hit = forzar ? undefined : entradas.get(clave);
      const edad = hit ? Date.now() - hit.at : Infinity;
      if (hit && edad < maxViejo) {
        // Al final: es la más usada.
        entradas.delete(clave);
        entradas.set(clave, hit);
        if (edad >= fresco) cargar(clave, cargador).catch((err) => console.error('[cache] refresco', clave, err));
        return hit.value;
      }
      return cargar(clave, cargador);
    },
    limpiar: () => entradas.clear(),
  };
}
