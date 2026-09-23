const dateFmt = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Argentina/Buenos_Aires',
});

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '';
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

export function formatPrice(price: number | null | undefined, currency: string | null | undefined): string {
  if (price == null) return '';
  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: currency ?? 'ARS',
      maximumFractionDigits: 0,
    }).format(price);
  } catch {
    return `${currency ?? ''} ${price}`;
  }
}

export const ML_STATUS_LABEL: Record<string, string> = {
  UNANSWERED: 'Sin responder',
  ANSWERED: 'Respondida',
  CLOSED_UNANSWERED: 'Cerrada',
  UNDER_REVIEW: 'En revisión',
  BANNED: 'Bloqueada',
  DELETED: 'Eliminada',
  DISABLED: 'Deshabilitada',
};

/** Convierte "2026-09-01" (input date) a ISO inclusive al inicio/fin del día en hora AR. */
export function dayToIso(day: string | null, end = false): string | undefined {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  return new Date(`${day}T${end ? '23:59:59.999' : '00:00:00.000'}-03:00`).toISOString();
}
