const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "LEAD - <title> <d> <Mon> <YYYY>": the shape lead_crm's parseWorkshopForm reads.
export function workshopFormName(title: string, date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `LEAD - ${title.trim()} ${d} ${MON[m - 1]} ${y}`;
}
