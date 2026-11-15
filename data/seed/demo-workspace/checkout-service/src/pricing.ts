export interface Item {
  sku: string;
  quantity: number;
  unitPrice: number;
}

export async function priceCart(items: Item[]): Promise<number> {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}
