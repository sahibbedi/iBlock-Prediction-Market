import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatGies(amount: number | undefined | null) {
  if (amount == null) return "0 GIES";
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " GIES";
}

export function formatProb(price: number | undefined | null) {
  if (price == null) return "0%";
  return (price * 100).toFixed(1) + "%";
}

export function formatDateTime(isoString: string | undefined | null) {
  if (!isoString) return "N/A";
  return format(new Date(isoString), "MMM d, yyyy HH:mm");
}

export function truncateHash(hash: string | undefined | null) {
  if (!hash) return "N/A";
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}
