const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "LEAD - <title> <d> <Mon> <YYYY>": the shape lead_crm's parseWorkshopForm reads.
export function isRealDate(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export function workshopFormName(title: string, date: string): string {
  if (!isRealDate(date)) throw new RangeError(`invalid date: ${date}`);
  const [y, m, d] = date.split("-").map(Number);
  return `LEAD - ${title.trim()} ${d} ${MON[m - 1]} ${y}`;
}
