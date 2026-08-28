# Delta for product-search

## ADDED Requirements

### Requirement: Suggestion keyboard navigation

The product search suggestions on `/sell` MUST support full keyboard navigation: the Down/Up arrow keys MUST move the highlighted suggestion (without leaving the input), the highlighted row MUST be visually distinct, and Enter MUST add the highlighted suggestion (product, or the selected variant when the row resolves to one) to the cart. Navigation MUST stop at the first/last suggestion instead of wrapping. Escape MUST dismiss the suggestion list without adding anything.

#### Scenario: Arrow keys move the highlight

- GIVEN the user typed a query with 3 matching suggestions and the list is visible
- WHEN the user presses ArrowDown twice
- THEN the third suggestion is highlighted
- AND pressing ArrowDown again keeps the highlight on the last suggestion

#### Scenario: Enter adds the highlighted suggestion

- GIVEN a suggestion is highlighted via arrow keys
- WHEN the user presses Enter
- THEN that product (or variant) is added to the cart exactly once
- AND the query input is cleared and ready for the next scan

#### Scenario: Escape dismisses without adding

- GIVEN the suggestion list is visible
- WHEN the user presses Escape
- THEN the list closes and the cart is unchanged

### Requirement: Exact-barcode-first ordering

The backend search endpoint (`GET /products/search`) MUST rank matches in this order: exact barcode match first, then exact name match, then partial matches (name/SKU/any barcode containing the term). An exact barcode match MUST outrank any name-based match regardless of alphabetical name order.

#### Scenario: Exact barcode beats name match

- GIVEN product A has barcode "777000000001" and product B is named "777-x" (no barcode containing "777000000001")
- WHEN the user queries "777000000001"
- THEN product A is returned first

#### Scenario: Exact name beats partial match

- GIVEN product A is named "Coca Cola 500ml" and product B is named "Coca Cola 500ml Zero"
- WHEN the user queries the exact name "Coca Cola 500ml"
- THEN product A is ranked before product B

### Requirement: Variant barcode matching

The search MUST match queries against product-variant barcodes in addition to product-level barcodes, product name, and SKU. A query that exactly matches a variant barcode MUST return the parent product with enough data for the frontend to resolve the matching variant.

#### Scenario: Variant barcode resolves its product

- GIVEN a product with two variants and variant 2 has barcode "888000000002"
- WHEN the user queries "888000000002"
- THEN the parent product is returned as a match
- AND the result exposes the variant (with its barcodes) so the highlighted row can add variant 2, not the base product

#### Scenario: Product-level barcode still matches

- GIVEN a product with a product-level barcode and no variants
- WHEN the user queries that barcode
- THEN the product is returned as an exact barcode match

### Requirement: Scan-miss empty state

When a scan or query matches no active product, the search MUST keep a visible, non-destructive empty state (no-results message in place of the list). It MUST NOT clear the input, add anything to the cart, or raise an error toast.

#### Scenario: Unknown barcode shows empty state

- GIVEN the search input contains a query with no matches
- WHEN the search completes
- THEN a visible "no results" empty state is shown
- AND the input keeps its value so the operator can correct it

### Requirement: Live search threshold

The suggestion search MUST fire live while typing from 2 or more characters, matching current behavior.

#### Scenario: Short query does not search

- GIVEN the input contains a single character
- WHEN the user pauses typing
- THEN no search request is issued and no suggestion list is shown
