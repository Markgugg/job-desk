import { describe, expect, it } from "vitest";
import { priceCart } from "./pricing";

describe("priceCart", () => {
  it("adds line items", async () => {
    expect(await priceCart([{ sku: "a", quantity: 2, unitPrice: 5 }])).toBe(10);
  });
});
