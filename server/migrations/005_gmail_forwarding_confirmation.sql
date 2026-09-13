-- Gmail's forwarding-address confirmation email lands at the alias itself
-- (there's no human inbox there to read it), so the backend has to catch it
-- and hand the confirm link back to the user through the app instead. This
-- column is where that link is staged until the frontend has shown it.
--
-- Additive only, idempotent -- safe to re-run.

alter table inbound_addresses
  add column if not exists confirmation_link text;
