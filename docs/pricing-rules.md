# Pricing Rules

## Discount precedence

SYM POS applies discounts in a fixed, enforced order so the same item cannot be over-discounted by competing promotion paths:

1. **Item-level discount** — an explicit server/cashier markdown for a line item. Legacy `lineDiscount` values are treated as item-level discounts when `itemDiscount` is not present.
2. **Combo discount** — an automatic bundle or set-menu adjustment. This is capped against the remaining line value after item-level discounts.
3. **Happy-hour discount** — an automatic time-window adjustment. This is capped against the remaining line value after item-level and combo discounts.
4. **Bill-level promotion** — fixed or percentage discounts applied to the bill/split subtotal after all item, combo, and happy-hour discounts have been applied.

Every discount is capped by the remaining eligible base at the step where it is applied. For example, a line with a 10.00 gross value and a 7.00 item discount can receive at most 3.00 of combo/happy-hour discount combined. Bill-level promotions are then capped by the remaining taxable subtotal.

## Bill-level tax toggle

Tax is controlled at the bill level by `taxMode`:

- `taxable`: calculate tax from the bill/split taxable subtotal using `taxRate`.
- `tax_exempt`: force bill tax to `0.00` and expose `taxRate` as `0` in the final calculation breakdown.

When the bill-level tax path is used, legacy item `lineTax` values are ignored to avoid mixing item-level and bill-level tax calculations. The calculation path is:

```text
line gross = round(quantity × unit price)
line net = line gross - item discount - combo discount - happy-hour discount
bill taxable subtotal = sum(line net) - bill-level promotions
bill tax = taxable subtotal × tax rate, or 0.00 when tax_exempt
bill total due = taxable subtotal + bill tax
```

## Rounding strategy

All monetary fields use a two-decimal, round-half-up-to-cent strategy at each monetary step:

- line gross values are rounded after multiplying quantity by unit price;
- each discount amount is rounded before it is capped and applied;
- percentage bill promotions are calculated from the current remaining subtotal and rounded before capping;
- tax is rounded once from the final taxable subtotal;
- totals are rounded after aggregation.

The API exposes the strategy as `round-half-up-to-cent-at-each-monetary-step` in every final calculation breakdown so the billing UI and printed receipt can show the exact calculation contract.

## Exposed calculation breakdown

Billing responses include `calculationBreakdown` with:

- subtotal;
- item-level, combo, happy-hour, bill-level, and total discounts;
- taxable subtotal;
- tax mode and tax rate;
- tax total;
- total due;
- applied bill-level promotions;
- per-line gross, discounts, net-before-bill-discount, tax, and line total;
- rounding strategy.

The same structure is embedded in the printed receipt payload to keep the on-screen final calculation and printed receipt totals reconciled.
