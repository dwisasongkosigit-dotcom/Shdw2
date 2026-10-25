export function matchesMonthRange(value: string | null | undefined, fromMonth: string, toMonth: string) {
  if (fromMonth && toMonth && fromMonth > toMonth) return false;
  if (!fromMonth && !toMonth) return true;
  if (!value) return false;

  const month = value.slice(0, 7);
  return (!fromMonth || month >= fromMonth) && (!toMonth || month <= toMonth);
}
