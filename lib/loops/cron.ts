// Minimal cron eşleştirici: "dakika saat ayıngünü ay haftanıngünü"
// Destek: "*", tek sayı, virgülle liste (örn. "1,3,5"). dow: 0=Pazar..6=Cumartesi.
export function cronMatches(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [mi, ho, dom, mo, dow] = parts;

  const f = (field: string, val: number): boolean =>
    field === "*" ||
    field.split(",").some((p) => {
      const n = Number(p);
      return Number.isInteger(n) && n === val;
    });

  return (
    f(mi, date.getMinutes()) &&
    f(ho, date.getHours()) &&
    f(dom, date.getDate()) &&
    f(mo, date.getMonth() + 1) &&
    f(dow, date.getDay())
  );
}
