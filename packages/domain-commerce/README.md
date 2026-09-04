# @shop/domain-commerce

Facade package re-exporting commerce domain modules from `@shop/api`.
Use this import path in worker and future services instead of reaching into
`@shop/api/domain/*` directly. Physical extraction into this package can proceed
incrementally without breaking callers.
