# Delta for Print Configuration

## REMOVED Requirements

### Requirement: Client regeneration after OpenAPI changes

(Previously: "After adding the settings print fields to the OpenAPI shape, the frontend
client MUST be regenerated with `bash ./scripts/generate-client.sh` and the frontend
typecheck MUST pass.")

(Reason: same as the removal in `post-sale-actions` — it records a build step that is
already done rather than behaviour the system must keep exhibiting. Keeping it in two
capabilities also meant two copies of the same process rule drifting apart from the
project index.)

(Migration: the regenerated client for the print-settings contract is already committed
under `frontend/src/client/`; the print-settings behaviour itself stays fully specified
by the remaining requirements of this capability. No consumer or data migration
follows.)
