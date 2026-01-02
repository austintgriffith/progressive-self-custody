import { formatUnits } from "viem";

// To be used in JSON.stringify when a field might be bigint

// https://wagmi.sh/react/faq#bigint-serialization
export const replacer = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

/**
 * Format USDC balance with at least 2 decimal places
 * e.g., 0.9 becomes 0.90, 1 becomes 1.00, 0.123 stays 0.123
 */
export const formatUsdc = (balance: bigint, decimals: number = 6): string => {
  const formatted = formatUnits(balance, decimals);
  const parts = formatted.split(".");
  const decimalPart = parts[1] || "";

  if (decimalPart.length < 2) {
    return parts[0] + "." + decimalPart.padEnd(2, "0");
  }
  return formatted;
};

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const isZeroAddress = (address: string) => address === ZERO_ADDRESS;

// Treat any dot-separated string as a potential ENS name
const ensRegex = /.+\..+/;
export const isENS = (address = "") => ensRegex.test(address);
